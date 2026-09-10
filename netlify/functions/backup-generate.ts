import type { Config } from '@netlify/functions';
import { randomInt } from 'node:crypto';
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from './cors';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
import { requireDataOwner, assertGuestActive, secretHash, securityErrorResponse } from '../../src/lib/server/guestIdentity';

export const config: Config = { path: '/api/backup/generate' };
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
  try {
    const { sourceUUID } = await req.json();
    const owner = await requireDataOwner(req, sourceUUID);
    if (owner.kind !== 'guest') throw new DiaryAuthenticationError(403, '비로그인 데이터만 백업할 수 있습니다.');
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
    const day = new Date().toISOString().slice(0, 10);
    const usage = adminDb.collection('backupCodeUsage').doc(owner.uid + '_' + day);
    // Codes are bearer credentials: only store digests, never log codes.
    const codeRef = adminDb.collection('guestBackupCodes').doc(secretHash(code));
    await adminDb.runTransaction(async transaction => {
      await assertGuestActive(adminDb!, owner, transaction);
      const [used, collision] = await Promise.all([transaction.get(usage), transaction.get(codeRef)]);
      if ((used.data()?.count || 0) >= 3) throw new DiaryAuthenticationError(429, '하루 발급 한도(3회)를 초과했습니다.');
      if (collision.exists) throw new DiaryAuthenticationError(409, '백업 코드를 다시 발급해주세요.');
      transaction.set(usage, { sourceUUID: owner.uid, count: (used.data()?.count || 0) + 1, date: day });
      transaction.create(codeRef, { sourceUUID: owner.uid, credentialHash: owner.hash,
        expiresAt: Date.now() + 86400000, createdAt: Date.now(), usedByUserId: null });
    });
    return Response.json({ code }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
