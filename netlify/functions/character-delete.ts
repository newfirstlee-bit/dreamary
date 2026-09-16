import { readJsonBody } from '../../src/lib/server/operationalGuard';
import { enqueueDataJob, advanceDataJob } from '../../src/lib/server/dataJobs';
import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from '../shared/cors';
import { requireDataOwner, assertGuestActive, securityErrorResponse } from '../../src/lib/server/guestIdentity';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
export const config: Config = { path: '/api/character/delete' };
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const { userId, characterId } = await readJsonBody(req, 2048);
    const owner = await requireDataOwner(req, userId);
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    if (typeof characterId !== 'string' || !characterId || characterId.includes('/')) throw new DiaryAuthenticationError(400, '캐릭터 정보가 필요합니다.');
    const ref = adminDb.collection('characters').doc(characterId);
    const job = await enqueueDataJob(adminDb, 'character-delete', owner.uid, characterId, '', async (tx, exists) => {
      await assertGuestActive(adminDb!, owner, tx);
      const character = await tx.get(ref);
      if (!character.exists) return;
      if (character.data()?.userId !== owner.uid) throw new DiaryAuthenticationError(403, '삭제 권한이 없습니다.');
      if (!exists) tx.update(ref, { deleting: true });
    });
    const done = await advanceDataJob(adminDb, job);
    return Response.json({ done }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
