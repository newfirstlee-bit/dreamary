import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from './cors';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
import { isGuestId, secretHash, sameHash, issueGuestSession, securityErrorResponse } from '../../src/lib/server/guestIdentity';

export const config: Config = { path: '/api/guest/session' };
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
  try {
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    const { userId, secret } = await req.json();
    if (!isGuestId(userId) || typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) {
      throw new DiaryAuthenticationError(400, '비로그인 인증정보가 필요합니다.');
    }
    const hash = secretHash(secret);
    // Validate signing configuration before persisting a binding.
    const token = await issueGuestSession(userId, hash);
    const ref = adminDb.collection('guestCredentials').doc(userId);
    const initial = await ref.get();
    if (initial.exists) {
      if (initial.data()?.retired || !sameHash(initial.data()?.secretHash, hash)) throw new DiaryAuthenticationError(403, '이미 다른 인증키에 연결되었거나 사용이 종료된 ID입니다.');
      return Response.json({ token, expiresAt: Date.now() + 15 * 60 * 1000 }, {
        headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
      });
    }
    if (!initial.exists) {
      // UUID format is not evidence that a Firebase account does not own it.
      const { getAuth } = await import('firebase-admin/auth');
      try {
        await getAuth().getUser(userId);
        throw new DiaryAuthenticationError(403, '로그인 계정은 비로그인 인증으로 연결할 수 없습니다.');
      } catch (error) {
        if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
      }
    }
    await adminDb.runTransaction(async transaction => {
      const current = await transaction.get(ref);
      if (current.exists) {
        if (current.data()?.retired || !sameHash(current.data()?.secretHash, hash)) throw new DiaryAuthenticationError(403, '이미 다른 인증키에 연결되었거나 사용이 종료된 ID입니다.');
        // Permit same-key token renewal to resume an interrupted migration.
        // Data APIs still reject migrationTarget; migration pins the target UID.
        return;
      }
      // An explicit, expiring pre-launch exception, never NODE_ENV based.
      const deadline = Date.parse(process.env.GUEST_LEGACY_CLAIM_UNTIL || '');
      const legacyAllowed = Number.isFinite(deadline) && Date.now() < deadline;
      if (!legacyAllowed) {
        const snapshots = await Promise.all(['characters', 'diaries', 'chatMessages'].map(name =>
          transaction.get(adminDb!.collection(name).where('userId', '==', userId).limit(1))));
        if (snapshots.some(snapshot => !snapshot.empty)) {
          throw new DiaryAuthenticationError(403, '기존 비로그인 데이터의 연결 기간이 종료되었습니다. 관리자에게 문의해주세요.');
        }
      }
      transaction.create(ref, { secretHash: hash, createdAt: Date.now(), legacyClaim: legacyAllowed });
    });
    return Response.json({ token, expiresAt: Date.now() + 15 * 60 * 1000 }, {
      headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
    });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
