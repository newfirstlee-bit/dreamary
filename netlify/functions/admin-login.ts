import { securityErrorResponse } from '../../src/lib/server/guestIdentity';
import { adminDb } from '../../src/lib/firebase-admin';
import { consumeOperation, readJsonBody } from '../../src/lib/server/operationalGuard';
import type { Config } from "@netlify/functions";
import { corsHeaders } from '../shared/cors';
import { createAdminSession } from '../../src/lib/server/adminSession';
import { createHash, timingSafeEqual } from 'node:crypto';

export const config: Config = {
  path: "/api/admin/login", rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: ['ip', 'domain'] }
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
    const { password } = await readJsonBody(req, 2048);
    if (!adminDb) throw new Error('Admin DB unavailable');
    await consumeOperation(adminDb, 'admin-login', createHash('sha256').update(req.headers.get('x-nf-client-connection-ip') || 'unidentified-network').digest('hex'), 30);
    const expected = process.env.ADMIN_PASSWORD;
    if (expected && typeof password === 'string' && timingSafeEqual(
      createHash('sha256').update(password).digest(), createHash('sha256').update(expected).digest())) {
      const token = await createAdminSession();
      const res = new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      res.headers.append('Set-Cookie', `admin_auth=${token}; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }
    return new Response(JSON.stringify({ success: false, error: '비밀번호가 일치하지 않습니다.' }), { status: 401, headers: corsHeaders });
  } catch (err) {
    return securityErrorResponse(err, corsHeaders);
  }
}
