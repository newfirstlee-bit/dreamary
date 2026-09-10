import { createRemoteJWKSet, jwtVerify } from 'jose';

// Shared by Next and Netlify. No Firestore reads; only Google's public signing
// keys are cached. Never accept a project, key URL or UID from an unverified JWT.
const signingKeys = createRemoteJWKSet(new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 3600000 });

export class DiaryAuthenticationError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 409 | 429 | 503, message: string) {
    super(message);
  }
}

export function projectId(): string {
  try {
    const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
    const id = account.project_id || process.env.GOOGLE_CLOUD_PROJECT;
    if (typeof id === 'string' && id.length > 0) return id;
  } catch { /* Do not log credentials or parser errors. */ }
  throw new DiaryAuthenticationError(503, '인증 서버 설정을 확인해주세요.');
}

/** Strict Firebase guard.
 * A missing token MUST NOT fall back to trusting body.userId or a guest UUID.
 * Like verifyIdToken() without checkRevoked, this does not check revocation.
 */
export async function requireDiaryLogin(req: Request, claimedUserId: unknown): Promise<string> {
  const authorization = req.headers.get('Authorization') || '';
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match || match[1].length > 16384) {
    throw new DiaryAuthenticationError(401, '로그인 정보를 확인해주세요.');
  }
  const id = projectId();
  let uid: string;
  try {
    const { payload, protectedHeader } = await jwtVerify(match[1], signingKeys, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${id}`,
      audience: id,
      requiredClaims: ['exp', 'iat', 'sub', 'auth_time'],
    });
    const now = Math.floor(Date.now() / 1000);
    if (payload.dreamaryGuest === true || !protectedHeader.kid || typeof payload.sub !== 'string' ||
        !payload.sub || payload.sub.length > 128 ||
        typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > now ||
        typeof payload.auth_time !== 'number' || !Number.isFinite(payload.auth_time) || payload.auth_time > now) {
      throw new DiaryAuthenticationError(401, '로그인 정보가 유효하지 않습니다.');
    }
    uid = payload.sub;
  } catch (error) {
    if (error instanceof DiaryAuthenticationError) throw error;
    const code = (error as { code?: string })?.code;
    if (code === 'ERR_JWKS_TIMEOUT' || !(typeof code === 'string' && code.startsWith('ERR_'))) {
      throw new DiaryAuthenticationError(503, '인증 확인이 지연되고 있습니다. 다시 시도해주세요.');
    }
    throw new DiaryAuthenticationError(401, '로그인 정보가 유효하지 않습니다. 다시 로그인해주세요.');
  }
  if (uid !== claimedUserId) {
    throw new DiaryAuthenticationError(403, '이 일기에 접근할 권한이 없습니다.');
  }
  return uid;
}
