import { SignJWT, jwtVerify } from 'jose';

function key() {
  const secret = process.env.ADMIN_SESSION_SECRET || '';
  if (!/^[a-f0-9]{64,}$/i.test(secret) || secret.length % 2) throw new Error('Admin session is not configured');
  return Buffer.from(secret, 'hex');
}
export async function createAdminSession() {
  return new SignJWT({ role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer('dreamary-admin').setAudience('dreamary-admin-api').setIssuedAt().setExpirationTime('1h').sign(key());
}
export async function validAdminSession(token: string | undefined) {
  try {
    if (!token) return false;
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'],
      issuer: 'dreamary-admin', audience: 'dreamary-admin-api', requiredClaims: ['iat', 'exp'], maxTokenAge: '1h' });
    return payload.role === 'admin';
  } catch { return false; }
}
export function isAdminRequest(req: Request) {
  const token = (req.headers.get('cookie') || '').split(';').map(part => part.trim())
    .find(part => part.startsWith('admin_auth='))?.slice('admin_auth='.length);
  return validAdminSession(token);
}
