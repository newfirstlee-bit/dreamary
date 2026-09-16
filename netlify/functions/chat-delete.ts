import { readJsonBody } from '../../src/lib/server/operationalGuard';
import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { requireDataOwner, assertGuestActive, securityErrorResponse } from '../../src/lib/server/guestIdentity';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
import { enqueueDataJob, advanceDataJob } from '../../src/lib/server/dataJobs';
import { corsHeaders } from '../shared/cors';
export const config: Config = { path: '/api/chat/delete' };
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const { userId, characterId, requestId } = await readJsonBody(req, 2048);
    const owner = await requireDataOwner(req, userId);
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    if (typeof characterId !== 'string' || !characterId || characterId.includes('/')) throw new DiaryAuthenticationError(400, '페어를 확인해주세요.');
    if (typeof requestId !== 'string' || !/^[\w-]{1,128}$/.test(requestId)) throw new DiaryAuthenticationError(400, '삭제 요청을 확인해주세요.');
    const ref = adminDb.collection('characters').doc(characterId);
    const job = await enqueueDataJob(adminDb, 'chat-delete', owner.uid, characterId, requestId, async (tx, exists) => {
      await assertGuestActive(adminDb!, owner, tx);
      const character = await tx.get(ref);
      if (character.data()?.userId !== owner.uid || character.data()?.deleting) throw new DiaryAuthenticationError(403, '대화 삭제 권한이 없습니다.');
      if (!exists && character.data()?.chatClearing) throw new DiaryAuthenticationError(409, '대화 삭제가 이미 진행 중입니다. 잠시 후 다시 확인해주세요.');
      if (!exists) tx.update(ref, { chatClearing: true });
    });
    return Response.json({ done: await advanceDataJob(adminDb, job) }, { headers: corsHeaders });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
