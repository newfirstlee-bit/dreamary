import type { Config } from "@netlify/functions";
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { connect } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';
import {
  buildDiaryPushCandidates,
  candidatesNeedNameTemplateRebuild,
  getFirebaseAdminServices,
  getNextKst8Pm,
  getTodayKstDateString,
  pickDiaryPushCandidate,
  toAdminTimestamp,
  type DiaryPushCandidate,
} from '../shared/push-shared.mts';

export const config: Config = {
  // Netlify cron is UTC. 11:00 UTC = 20:00 Korea/Japan time.
  schedule: '0 11 * * *',
};

const SEND_LIMIT = 200;
const APNS_JWT_TTL_MS = 45 * 60 * 1000;

let cachedApnsJwt: { token: string; createdAt: number } | null = null;

function getCopy(locale: string, candidate?: DiaryPushCandidate | null) {
  if (locale === 'ja') {
    return {
      title: '交換日記を書けます',
      body: '今日のテーマに合わせて日記を書いてみましょう。',
    };
  }

  if (candidate) {
    return {
      title: `${candidate.nextTopicOrder}번째 주제가 도착했어요!`,
      body: candidate.nextTopicContent,
    };
  }

  return {
    title: '교환일기를 쓸 수 있어요',
    body: '오늘의 주제에 맞춰 일기를 작성해보세요.',
  };
}

function isInvalidTokenError(code?: string) {
  return code === 'messaging/registration-token-not-registered'
    || code === 'messaging/invalid-registration-token'
    || code === 'messaging/invalid-argument';
}

function normalizeApnsPrivateKey(raw: string) {
  return raw.replace(/\\n/g, '\n');
}

async function getApnsJwt() {
  if (cachedApnsJwt && Date.now() - cachedApnsJwt.createdAt < APNS_JWT_TTL_MS) {
    return cachedApnsJwt.token;
  }

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const rawPrivateKey = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !rawPrivateKey) {
    throw new Error('APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY are required for iOS push');
  }

  const privateKey = await importPKCS8(normalizeApnsPrivateKey(rawPrivateKey), 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(privateKey);

  cachedApnsJwt = { token, createdAt: Date.now() };
  return token;
}

async function sendApnsNotification(options: {
  token: string;
  title: string;
  body: string;
}) {
  const bundleId = process.env.APNS_BUNDLE_ID || process.env.IOS_BUNDLE_ID || 'com.repov.dreamary';
  const isSandbox = process.env.APNS_ENV === 'sandbox';
  const authority = isSandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const jwt = await getApnsJwt();

  return new Promise<{ success: boolean; invalidToken: boolean; status?: number; reason?: string }>((resolve) => {
    const client = connect(authority);
    let responseBody = '';
    let resolved = false;

    const finish = (result: { success: boolean; invalidToken: boolean; status?: number; reason?: string }) => {
      if (resolved) return;
      resolved = true;
      client.close();
      resolve(result);
    };

    client.on('error', error => {
      finish({ success: false, invalidToken: false, reason: error.message });
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${options.token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });

    req.setEncoding('utf8');
    req.on('response', headers => {
      const status = Number(headers[':status'] || 0);
      req.on('data', chunk => {
        responseBody += chunk;
      });
      req.on('end', () => {
        let reason = '';
        try {
          reason = JSON.parse(responseBody || '{}')?.reason || '';
        } catch {
          reason = responseBody;
        }
        finish({
          success: status >= 200 && status < 300,
          invalidToken: status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered',
          status,
          reason,
        });
      });
    });
    req.on('error', error => {
      finish({ success: false, invalidToken: false, reason: error.message });
    });
    req.end(JSON.stringify({
      aps: {
        alert: {
          title: options.title,
          body: options.body,
        },
        sound: 'default',
        badge: 1,
      },
      type: 'diary_available',
      url: '/diary',
    }));
  });
}

export default async function scheduledDiaryPushHandler() {
  const { firestore, messaging } = getFirebaseAdminServices();
  const now = new Date();
  const nowTimestamp = Timestamp.fromDate(now);
  const todayKst = getTodayKstDateString(now);

  const targetSnap = await firestore.collection('diaryPushTargets')
    .where('enabled', '==', true)
    .where('nextNotifyAt', '<=', nowTimestamp)
    .orderBy('nextNotifyAt', 'asc')
    .limit(SEND_LIMIT)
    .get();

  let targetCount = 0;
  let sentCount = 0;
  let tokenFailureCount = 0;

  for (const targetDoc of targetSnap.docs) {
    targetCount += 1;
    const target = targetDoc.data();
    const uid = target.uid || targetDoc.id;
    const locale = target.locale === 'ja' ? 'ja' : 'ko';
    let candidates = target.candidates && typeof target.candidates === 'object' ? target.candidates : null;

    if (candidatesNeedNameTemplateRebuild(candidates)) {
      const rebuiltCandidates = await buildDiaryPushCandidates(firestore, uid, locale, todayKst);
      if (Object.keys(rebuiltCandidates).length > 0) {
        candidates = rebuiltCandidates;
        await targetDoc.ref.set({
          candidates: rebuiltCandidates,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    const hasCandidates = candidates && typeof candidates === 'object' && Object.keys(candidates).length > 0;
    const selectedCandidate = pickDiaryPushCandidate(candidates, todayKst);
    const copy = getCopy(locale, selectedCandidate);

    if (!selectedCandidate && (hasCandidates || target.lastDiaryDate === todayKst)) {
      await targetDoc.ref.set({
        nextNotifyAt: toAdminTimestamp(getNextKst8Pm(now)),
        lastSkippedAt: FieldValue.serverTimestamp(),
        lastSkipReason: hasCandidates ? 'all_candidate_diaries_already_written_today' : 'diary_already_written_today',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      continue;
    }

    const deviceSnap = await firestore.collection('pushDevices')
      .where('uid', '==', uid)
      .where('diaryPushEnabled', '==', true)
      .get();

    const deviceDocs = deviceSnap.docs.filter(doc => typeof doc.data().pushToken === 'string' && doc.data().pushToken);
    const androidDeviceDocs = deviceDocs.filter(doc => doc.data().platform === 'android');
    const iosDeviceDocs = deviceDocs.filter(doc => doc.data().platform === 'ios');
    const androidTokens = androidDeviceDocs.map(doc => doc.data().pushToken as string);

    if (deviceDocs.length === 0) {
      await targetDoc.ref.set({
        nextNotifyAt: toAdminTimestamp(getNextKst8Pm(now)),
        lastSkippedAt: FieldValue.serverTimestamp(),
        lastSkipReason: 'no_device_token',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      continue;
    }

    let successCount = 0;
    let failureCount = 0;
    const cleanupBatch = firestore.batch();

    if (androidTokens.length > 0) {
      const response = await messaging.sendEachForMulticast({
        tokens: androidTokens,
        notification: copy,
        data: {
          type: 'diary_available',
          url: '/diary',
          uid,
          characterId: selectedCandidate?.characterId || '',
          topicId: selectedCandidate?.nextTopicId || '',
          topicOrder: selectedCandidate ? String(selectedCandidate.nextTopicOrder) : '',
        },
        android: {
          notification: {
            channelId: 'diary',
            sound: 'default',
            priority: 'high',
          },
        },
      });

      successCount += response.successCount;
      failureCount += response.failureCount;

      response.responses.forEach((item, index) => {
        if (!item.success && isInvalidTokenError(item.error?.code)) {
          cleanupBatch.set(androidDeviceDocs[index].ref, {
            diaryPushEnabled: false,
            osPermission: 'invalid_token',
            disabledAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      });
    }

    for (const iosDeviceDoc of iosDeviceDocs) {
      try {
        const result = await sendApnsNotification({
          token: iosDeviceDoc.data().pushToken,
          title: copy.title,
          body: copy.body,
        });
        if (result.success) {
          successCount += 1;
        } else {
          failureCount += 1;
          if (result.invalidToken) {
            cleanupBatch.set(iosDeviceDoc.ref, {
              diaryPushEnabled: false,
              osPermission: 'invalid_token',
              disabledAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              lastError: result.reason || '',
            }, { merge: true });
          }
        }
      } catch (error: any) {
        failureCount += 1;
        console.error('APNs send failed:', error?.message || error);
      }
    }

    sentCount += successCount;
    tokenFailureCount += failureCount;
    await cleanupBatch.commit();

    await targetDoc.ref.set({
      nextNotifyAt: toAdminTimestamp(getNextKst8Pm(now)),
      lastNotifiedAt: FieldValue.serverTimestamp(),
      lastNotifiedDate: todayKst,
      lastNotifiedCharacterId: selectedCandidate?.characterId || '',
      lastNotifiedTopicId: selectedCandidate?.nextTopicId || '',
      lastNotifiedTopicOrder: selectedCandidate?.nextTopicOrder || 0,
      lastSendSuccessCount: successCount,
      lastSendFailureCount: failureCount,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  console.log(JSON.stringify({
    event: 'diary_push_scheduler_done',
    targetCount,
    sentCount,
    tokenFailureCount,
  }));
}
