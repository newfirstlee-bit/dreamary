import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from './cors';
import { DiaryAuthenticationError, requireDiaryLogin } from '../../src/lib/server/diaryAuthentication';
import { verifyGuestSession, isGuestId, sameHash, secretHash, securityErrorResponse } from '../../src/lib/server/guestIdentity';

export const config: Config = { path: '/api/backup/migrate' };
const PAGE_SIZE = 20;
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
  try {
    const payload = await req.json();
    const uid = await requireDiaryLogin(req, payload.uid);
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    let sourceUUID: string, hash: string;
    let codeDigest: string | null = null;
    if (payload.code !== undefined) {
      const code = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
      if (!/^[A-Z0-9]{8}$/.test(code)) throw new DiaryAuthenticationError(400, '올바른 백업 코드를 입력해주세요.');
      codeDigest = secretHash(code);
      const attemptsRef = adminDb.collection('guestBackupAttempts').doc(uid + '_' + new Date().toISOString().slice(0, 10));
      const codeRef = adminDb.collection('guestBackupCodes').doc(codeDigest);
      const codeData = await adminDb.runTransaction(async transaction => {
        const attempts = await transaction.get(attemptsRef);
        if ((attempts.data()?.count || 0) >= 10) throw new DiaryAuthenticationError(429, '코드 확인 횟수를 초과했습니다. 내일 다시 시도해주세요.');
        const snapshot = await transaction.get(codeRef);
        const data = snapshot.data();
        if (!data || (data.usedByUserId && data.usedByUserId !== uid) ||
            (!data.usedByUserId && !(data.expiresAt > Date.now()))) {
          transaction.set(attemptsRef, { uid, count: (attempts.data()?.count || 0) + 1 });
          return null;
        }
        return data;
      });
      if (!codeData) throw new DiaryAuthenticationError(403, '유효하지 않거나 만료된 백업 코드입니다.');
      sourceUUID = codeData.sourceUUID;
      hash = codeData.credentialHash;
    } else {
      const header = req.headers.get('X-Guest-Authorization') || '';
      if (!header.startsWith('Guest ')) throw new DiaryAuthenticationError(401, '비로그인 기기 인증이 필요합니다.');
      const guest = await verifyGuestSession(header.slice(6));
      if (guest.uid !== payload.sourceUUID) throw new DiaryAuthenticationError(403, '이전할 데이터 소유자가 일치하지 않습니다.');
      sourceUUID = guest.uid;
      hash = guest.hash!;
    }
    if (!isGuestId(sourceUUID) || sourceUUID === uid) throw new DiaryAuthenticationError(400, '이전할 비로그인 ID를 확인해주세요.');
    const credential = adminDb.collection('guestCredentials').doc(sourceUUID);
    const codeRef = codeDigest ? adminDb.collection('guestBackupCodes').doc(codeDigest) : null;
    // Pin one destination before changing data. Failure is resumable only by it.
    await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(credential);
      const data = snapshot.data();
      const codeSnapshot = codeRef ? await transaction.get(codeRef) : null;
      if (data?.retired || !sameHash(data?.secretHash, hash) || (data?.migrationTarget && data.migrationTarget !== uid)) {
        throw new DiaryAuthenticationError(403, '이미 다른 계정으로 이전되었거나 인증정보가 다릅니다.');
      }
      if (codeRef) {
        const code = codeSnapshot?.data();
        if (!code || (code.usedByUserId && code.usedByUserId !== uid) ||
            (!code.usedByUserId && !(code.expiresAt > Date.now()))) throw new DiaryAuthenticationError(403, '유효하지 않은 백업 코드입니다.');
        transaction.update(codeRef, { usedByUserId: uid });
      }
      if (!data?.migrationTarget) transaction.update(credential, { migrationTarget: uid, migrationState: 'pending' });
    });
    const done = await adminDb.runTransaction(async transaction => {
      const current = await transaction.get(credential);
      if (current.data()?.retired || current.data()?.migrationTarget !== uid) throw new DiaryAuthenticationError(403, '데이터 이전 권한이 없습니다.');
      if (current.data()?.migrationState === 'complete') return true;
      // Move characters LAST: until all diaries are transferred the target UID
      // must not be able to create a duplicate diary under its new daily ID.
      const names = ['diaries', 'chatMessages', 'characters'];
      const stage = current.data()?.migrationStage || 0;
      const snapshot = await transaction.get(adminDb!.collection(names[stage])
        .where('userId', '==', sourceUUID).limit(PAGE_SIZE));
      snapshot.docs.forEach(item => transaction.update(item.ref, {
        userId: uid, ...(stage === 2 ? { diaryOwnershipMigrated: true } : {}),
      }));
      const stageDone = snapshot.size < PAGE_SIZE;
      const complete = stage === 2 && stageDone;
      if (complete) transaction.update(credential, { migrationState: 'complete', completedAt: Date.now() });
      else if (stageDone) transaction.update(credential, { migrationStage: stage + 1 });
      return complete;
    });
    return Response.json({ success: true, done, sourceUUID }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
