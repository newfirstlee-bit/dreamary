import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { DiaryAuthenticationError, projectId, requireDiaryLogin } from './diaryAuthentication';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

export const isGuestId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function sameHash(a: unknown, b: string) {
  return typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) &&
    timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
function sessionKey() {
  const value = process.env.GUEST_SESSION_SECRET || '';
  if (!/^[a-f0-9]{64,}$/i.test(value) || value.length % 2 !== 0) {
    throw new DiaryAuthenticationError(503, '비로그인 인증 서버 설정이 필요합니다.');
  }
  return Buffer.from(value, 'hex');
}
export type DataOwner = { uid: string; kind: 'firebase' | 'guest'; hash?: string };
export async function issueGuestSession(uid: string, hash: string) {
  return new SignJWT({ scope: 'guest-data', credentialHash: hash })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(uid)
    .setIssuer('dreamary-guest').setAudience(projectId()).setIssuedAt()
    .setExpirationTime('15m').sign(sessionKey());
}
export async function verifyGuestSession(token: string): Promise<DataOwner> {
  const key = sessionKey();
  const audience = projectId();
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'], issuer: 'dreamary-guest', audience,
      requiredClaims: ['exp', 'iat', 'sub'], maxTokenAge: '15m',
    });
    if (!isGuestId(payload.sub) || payload.scope !== 'guest-data' ||
        typeof payload.credentialHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.credentialHash)) throw new Error();
    return { uid: payload.sub, kind: 'guest', hash: payload.credentialHash };
  } catch {
    throw new DiaryAuthenticationError(401, '비로그인 인증이 만료되었거나 유효하지 않습니다. 다시 시도해주세요.');
  }
}
export async function requireDataOwner(req: Request, claimed: unknown): Promise<DataOwner> {
  const header = req.headers.get('Authorization') || '';
  if (header.startsWith('Guest ')) {
    const owner = await verifyGuestSession(header.slice(6));
    if (owner.uid !== claimed) throw new DiaryAuthenticationError(403, '데이터 소유자가 일치하지 않습니다.');
    return owner;
  }
  return { uid: await requireDiaryLogin(req, claimed), kind: 'firebase' };
}
type Reader = Pick<Transaction, 'get'>;
export async function assertGuestActive(db: Firestore, owner: DataOwner, transaction?: Reader) {
  if (owner.kind !== 'guest') return;
  const ref = db.collection('guestCredentials').doc(owner.uid);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || !sameHash(data?.secretHash, owner.hash!) || data?.migrationTarget || data?.retired) {
    throw new DiaryAuthenticationError(403, '비로그인 데이터가 이전 중이거나 인증키가 유효하지 않습니다.');
  }
}
export function securityErrorResponse(error: unknown, headers: Record<string, string>) {
  const known = error instanceof DiaryAuthenticationError;
  return new Response(JSON.stringify({ error: known ? error.message : '요청 처리에 실패했습니다. 다시 시도해주세요.' }), {
    status: known ? error.status : 500,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
