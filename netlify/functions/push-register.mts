import type { Config } from "@netlify/functions";
import { FieldValue } from 'firebase-admin/firestore';
import { corsHeaders } from './cors';
import { buildDiaryPushCandidates, getFirebaseAdminServices, getNextKst8Pm, getTodayKstDateString, getTomorrowKst8Pm, sanitizeDocId, toAdminTimestamp, verifyFirebaseIdTokenRest } from './push-shared.mts';

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
    const body = await req.json();
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
    const pushToken = typeof body?.pushToken === 'string' ? body.pushToken : '';
    const platform = body?.platform === 'ios' || body?.platform === 'android' ? body.platform : 'unknown';
    const characterId = typeof body?.characterId === 'string' ? body.characterId : '';
    const dateString = typeof body?.dateString === 'string' ? body.dateString : '';
    const locale = typeof body?.locale === 'string' ? body.locale : 'ko';

    if (!deviceId || !pushToken) {
      return new Response(JSON.stringify({ error: '푸시 토큰 정보가 필요합니다.' }), { status: 400, headers: corsHeaders });
    }

    const { firestore } = getFirebaseAdminServices();
    const todayDateString = getTodayKstDateString();
    let candidates = {};
    try {
      candidates = await buildDiaryPushCandidates(firestore, uid, locale, todayDateString);
    } catch (candidateError) {
      // Push registration must not fail just because the optional diary-topic
      // candidate cache could not be rebuilt. The cache is refreshed again when
      // a diary is completed and by the scheduler fallback path.
      console.warn('Push candidate rebuild skipped during registration:', candidateError);
    }
    const safeDeviceId = sanitizeDocId(`${uid}_${deviceId}`);
    const deviceRef = firestore.collection('pushDevices').doc(safeDeviceId);
    const targetRef = firestore.collection('diaryPushTargets').doc(uid);

    await firestore.runTransaction(async transaction => {
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
        enabled: true,
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
    return new Response(JSON.stringify({ error: error?.message || '푸시 등록 중 오류가 발생했습니다.' }), { status: 500, headers: corsHeaders });
  }
}
