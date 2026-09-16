import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore, type DocumentReference } from 'firebase-admin/firestore';
import type { Messaging } from 'firebase-admin/messaging';
import { getTodayKstDateString, getNextKst8Pm, pickDiaryPushCandidate, candidatesNeedNameTemplateRebuild } from './pushShared';
import { getCopy, isInvalidTokenError, sendApnsNotification } from './pushDelivery';

const milliseconds = (value: any) => (typeof value === 'number' ? value : value?.toMillis?.()) || 0;
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('delivery_timeout')), ms); })]); }
  finally { clearTimeout(timer!); }
}

export async function processDiaryPushTarget(db: Firestore, messaging: Messaging, ref: DocumentReference, now = new Date()) {
  const token = randomUUID(), today = getTodayKstDateString(now), leaseEnd = now.getTime() + 90000;
  const target = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref), data = snapshot.data();
    const account = await tx.get(db.collection('accountStates').doc(ref.id));
    if (account.exists) { if (snapshot.exists) tx.update(ref, { enabled: false }); return null; }
    if (!data?.enabled || milliseconds(data.nextNotifyAt) > now.getTime() || (data.leaseUntil || 0) > now.getTime()) return null;
    tx.update(ref, { leaseToken: token, leaseUntil: leaseEnd, nextNotifyAt: Timestamp.fromMillis(leaseEnd) });
    return data;
  });
  if (!target) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0, retry = false, moreDevices = false;
  let deviceCursor = target.deviceCursorDate === today ? target.deviceCursor || '' : '';
  try {
    const candidate = pickDiaryPushCandidate(target.candidates, today);
    const hasCandidates = Object.keys(target.candidates || {}).length > 0;
    const skip = !candidate && (hasCandidates || target.lastDiaryDate === today);
    if (!skip) {
      // No candidate rebuild / diary / topic queries in the delivery worker.
      const copy = getCopy(target.locale, candidatesNeedNameTemplateRebuild(target.candidates) ? null : candidate);
      let query = db.collection('pushDevices').where('uid', '==', ref.id).where('diaryPushEnabled', '==', true).orderBy('__name__').limit(5);
      if (deviceCursor) query = query.startAfter(deviceCursor);
      const devices = await query.get();
      moreDevices = devices.size === 5;
      await Promise.all(devices.docs.map(async device => {
        const data = device.data();
        if (data.lastDeliveryDate === today || !data.pushToken) return;
        let ok = false, invalid = false;
        try {
          if (data.platform === 'ios') {
            const result = await sendApnsNotification({ token: data.pushToken, ...copy, deliveryKey: 'diary-' + today });
            ok = result.success; invalid = result.invalidToken;
          } else if (data.platform === 'android') {
            await withDeadline(messaging.send({ token: data.pushToken, notification: copy,
              data: { type: 'diary_available', url: '/diary', deliveryId: 'diary-' + today, characterId: candidate?.characterId || '' },
              android: { collapseKey: 'diary-' + today, notification: { channelId: 'diary', sound: 'default', tag: 'diary-' + today } },
            }), 8000);
            ok = true;
          } else invalid = true;
        } catch (error) { invalid = isInvalidTokenError((error as { code?: string }).code); }
        // Never overwrite a refreshed token or re-enable an opted-out device.
        await db.runTransaction(async tx => {
          const current = await tx.get(device.ref);
          if (!current.exists || current.data()?.pushToken !== data.pushToken) return;
          if (ok) tx.update(device.ref, { lastDeliveryDate: today });
          else if (invalid) tx.update(device.ref, { diaryPushEnabled: false, osPermission: 'invalid_token' });
        });
        if (ok) sent++; else if (!invalid) { failed++; retry = true; }
      }));
      if (!retry) deviceCursor = moreDevices ? devices.docs[devices.size - 1].id : '';
    }
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (!current.exists || current.data()?.leaseToken !== token) return;
      const attempts = target.retryDate === today ? (target.retryCount || 0) + 1 : 1;
      const backoff = Math.min(3600000, 60000 * 2 ** Math.min(attempts, 6));
      // Preserve a later schedule written by diary completion.
      const next = Math.max(milliseconds(current.data()?.nextNotifyAt) === leaseEnd ? 0 : milliseconds(current.data()?.nextNotifyAt),
        retry ? Date.now() + backoff : moreDevices ? Date.now() + 1000 : getNextKst8Pm(new Date()).getTime());
      tx.update(ref, { leaseUntil: 0, nextNotifyAt: Timestamp.fromMillis(next), retryDate: today,
        retryCount: retry ? attempts : 0, deviceCursor, deviceCursorDate: today, lastSendSuccessCount: sent, lastSendFailureCount: failed,
        ...(sent ? { lastNotifiedDate: today } : {}), updatedAt: Timestamp.now() });
    });
  } catch {
    // Lease is recoverable by a subsequent scheduled run.
    failed++; console.error(JSON.stringify({ event: 'diary_push_target_failed' }));
  }
  return { sent, failed };
}

export async function drainDiaryPushQueue(db: Firestore, messaging: Messaging, budgetMs = 18000) {
  const deadline = Date.now() + budgetMs;
  let targets = 0, sent = 0, failed = 0;
  while (Date.now() < deadline) {
    const page = await db.collection('diaryPushTargets').where('enabled', '==', true)
      .where('nextNotifyAt', '<=', Timestamp.now()).orderBy('nextNotifyAt', 'asc').limit(5).get();
    if (page.empty) break;
    const results = await Promise.allSettled(page.docs.map(doc => processDiaryPushTarget(db, messaging, doc.ref)));
    for (const result of results) {
      targets++;
      if (result.status === 'fulfilled') { sent += result.value.sent; failed += result.value.failed; } else failed++;
    }
  }
  return { targets, sent, failed, budgetExhausted: Date.now() >= deadline };
}
