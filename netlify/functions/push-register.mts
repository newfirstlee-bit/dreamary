import { consumeOperation, readJsonBody } from '../../src/lib/server/operationalGuard';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
import type { Config } from "@netlify/functions";
import { FieldValue } from 'firebase-admin/firestore';
import { corsHeaders } from '../shared/cors';
import { buildDiaryPushCandidates, getFirebaseAdminServices, getNextKst8Pm, getTodayKstDateString, getTomorrowKst8Pm, sanitizeDocId, toAdminTimestamp, verifyFirebaseIdTokenRest } from '../shared/push-shared.mts';

export const config: Config = {
  path: "/api/push/register"
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const authorization = req.headers.get('authorization') || '';
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!idToken) {
      return new Response(JSON.stringify({ error: '로그인 확인이 필요합니다.' }), { status: 401, headers: corsHeaders });
    }

    const uid = await verifyFirebaseIdTokenRest(idToken);
    const body = await readJsonBody(req, 8192);
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
    const pushToken = typeof body?.pushToken === 'string' ? body.pushToken : '';
    const platform = body?.platform === 'ios' || body?.platform === 'android' ? body.platform : 'unknown';
    const characterId = typeof body?.characterId === 'string' ? body.characterId : '';
    const dateString = typeof body?.dateString === 'string' ? body.dateString : '';
    const locale = typeof body?.locale === 'string' ? body.locale : 'ko';

    if (!deviceId || deviceId.length > 128 || !pushToken || pushToken.length > 4096 || platform === 'unknown') {
      return new Response(JSON.stringify({ error: '푸시 토큰 정보가 필요합니다.' }), { status: 400, headers: corsHeaders });
    }

    const { firestore } = getFirebaseAdminServices();
    await consumeOperation(firestore, 'push-register', uid, 30);
    const state = await firestore.collection('accountStates').doc(uid).get();
    if (state.exists) throw new DiaryAuthenticationError(403, '탈퇴 처리 중인 계정입니다.');
    const todayDateString = getTodayKstDateString();
    let candidates = {};
    try {
      candidates = await buildDiaryPushCandidates(firestore, uid, locale, todayDateString);
    } catch (candidateError) {
      // Push registration must not fail just because the optional diary-topic
      // candidate cache could not be rebuilt. The cache is refreshed again when
      // a diary is completed when the user registers again.
      console.warn('Push candidate rebuild skipped during registration:', candidateError);
    }
    const safeDeviceId = sanitizeDocId(`${uid}_${deviceId}`);
    const deviceRef = firestore.collection('pushDevices').doc(safeDeviceId);
    const targetRef = firestore.collection('diaryPushTargets').doc(uid);

    await firestore.runTransaction(async transaction => {
      const [existing, target, active, deletionState] = await Promise.all([
        transaction.get(deviceRef), transaction.get(targetRef),
        transaction.get(firestore.collection('pushDevices').where('uid', '==', uid).where('diaryPushEnabled', '==', true).limit(5)),
        transaction.get(firestore.collection('accountStates').doc(uid)),
      ]);
      if (deletionState.exists) throw new DiaryAuthenticationError(403, '탈퇴 처리 중인 계정입니다.');
      if (!existing.data()?.diaryPushEnabled && active.size >= 5) throw new DiaryAuthenticationError(409, '알림은 최대 5개 기기에 등록할 수 있습니다. 다른 기기의 알림을 먼저 꺼주세요.');
      transaction.set(deviceRef, {
        id: safeDeviceId,
        uid,
        deviceId,
        platform,
        pushToken,
        locale,
        diaryPushEnabled: true,
        osPermission: 'granted',
        lastSeenAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.set(targetRef, {
        uid,
        enabled: true, deviceCursor: '',
        locale,
        latestCharacterId: characterId,
        lastDiaryDate: dateString || '',
        candidates,
        nextNotifyAt: toAdminTimestamp(dateString && dateString === todayDateString ? getTomorrowKst8Pm() : getNextKst8Pm()),
        lastRegisteredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error: any) {
    console.error('Push Register Error:', error);
    return new Response(JSON.stringify({ error: error?.message || '푸시 등록 중 오류가 발생했습니다.' }), { status: error instanceof DiaryAuthenticationError ? error.status : 500, headers: corsHeaders });
  }
}
