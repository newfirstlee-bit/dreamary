import type { Config } from "@netlify/functions";
import { corsHeaders } from '../shared/cors';
import { createAdminSession } from '../../src/lib/server/adminSession';
import { createHash, timingSafeEqual } from 'node:crypto';

export const config: Config = {
  path: "/api/admin/login"
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
    const { password } = await req.json();
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
    return new Response(JSON.stringify({ success: false, error: 'Server Error' }), { status: 500, headers: corsHeaders });
  }
}
