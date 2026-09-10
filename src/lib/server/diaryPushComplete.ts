import { FieldValue } from 'firebase-admin/firestore';
import {
  buildDiaryPushCandidates, corsHeaders, getFirebaseAdminServices,
  getTodayKstDateString, getTomorrowKst8Pm, toAdminTimestamp, verifyFirebaseIdTokenRest,
} from './pushShared';

/** Shared by Next dev and Netlify production; never rebuild every pair on completion. */
export async function handleDiaryPushComplete(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders, status: 204 });
  if (req.method !== 'POST') return new Response(null, { headers: corsHeaders, status: 405 });
  try {
    const authorization = req.headers.get('authorization') || '';
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken) return new Response(JSON.stringify({ error: '로그인 확인이 필요합니다.' }), { status: 401, headers: corsHeaders });
    const uid = await verifyFirebaseIdTokenRest(idToken);
    const body = await req.json();
    const characterId = typeof body?.characterId === 'string' ? body.characterId : '';
    const dateString = typeof body?.dateString === 'string' ? body.dateString : '';
    const locale = body?.locale === 'ja' ? 'ja' : 'ko';
    if (!characterId || characterId.includes('/') || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return new Response(JSON.stringify({ error: '일기 정보가 필요합니다.' }), { status: 400, headers: corsHeaders });
    }

    const { firestore } = getFirebaseAdminServices();
    const targetRef = firestore.collection('diaryPushTargets').doc(uid);
    const target = await targetRef.get();
    if (!target.exists || target.data()?.enabled !== true) {
      return new Response(JSON.stringify({ success: true, skipped: true }), { headers: corsHeaders });
    }

    const candidates = await buildDiaryPushCandidates(firestore, uid, locale, getTodayKstDateString(), characterId);
    if (!Object.keys(candidates).length) {
      return new Response(JSON.stringify({ error: '알림 대상 페어 또는 주제를 찾을 수 없습니다.' }), { status: 400, headers: corsHeaders });
    }
    await firestore.runTransaction(async transaction => {
      const current = await transaction.get(targetRef);
      // A user may disable notifications while candidates are being calculated.
      if (!current.exists || current.data()?.enabled !== true) return;
      transaction.set(targetRef, {
        uid, locale, latestCharacterId: characterId, lastDiaryDate: dateString,
        candidates: { ...(current.data()?.candidates || {}), ...candidates },
        nextNotifyAt: toAdminTimestamp(getTomorrowKst8Pm()),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error) {
    console.error('Push Diary Complete Error:', error);
    // Leave existing candidates intact on failure, identically in dev and production.
    return new Response(JSON.stringify({ error: '일기 알림 상태 갱신 중 오류가 발생했습니다.' }), { status: 500, headers: corsHeaders });
  }
}
