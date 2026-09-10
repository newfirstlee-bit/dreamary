import type { Config } from '@netlify/functions';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from '../shared/cors';
import { measurePhase } from '../../src/lib/performanceTrace';
import { requireDataOwner, assertGuestActive, securityErrorResponse } from '../../src/lib/server/guestIdentity';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
import { currentDiaryDate } from '../../src/lib/server/diaryDate';

export const config: Config = { path: '/api/diary/edit' };
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
  try {
    const payload = await req.json();
    const owner = await requireDataOwner(req, payload.userId);
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    const { diaryId, action, field } = payload;
    if (typeof diaryId !== 'string' || !diaryId || diaryId.includes('/') || diaryId.length > 512 ||
        (action !== 'update' && action !== 'delete')) throw new DiaryAuthenticationError(400, '일기 정보를 확인해주세요.');
    const content = typeof payload.content === 'string' ? payload.content.trim().slice(0, 4000) : '';
    if (action === 'update' && ((field !== 'userEntry' && field !== 'charReply') || !content)) {
      throw new DiaryAuthenticationError(400, '수정할 내용을 확인해주세요.');
    }
    const today = action === 'delete' ? currentDiaryDate(payload.timezoneOffsetMinutes) : '';
    const ref = adminDb.collection('diaries').doc(diaryId);
    await measurePhase('diary.edit', action === 'delete' ? 'delete' : 'save', () => adminDb!.runTransaction(async transaction => {
      await assertGuestActive(adminDb!, owner, transaction);
      const snapshot = await transaction.get(ref);
      // Same response for missing/not-owned documents; no existence oracle.
      if (!snapshot.exists || snapshot.data()?.userId !== owner.uid) throw new DiaryAuthenticationError(403, '일기 접근 권한을 확인해주세요.');
      if (action === 'delete') {
        if (snapshot.data()?.dateString !== today) throw new DiaryAuthenticationError(400, '당일 일기만 삭제할 수 있습니다.');
        transaction.delete(ref);
      } else {
        transaction.update(ref, { [field]: content, updatedAt: FieldValue.serverTimestamp() });
      }
    }));
    return Response.json({ success: true }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
