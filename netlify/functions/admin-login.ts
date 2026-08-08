import type { Config } from "@netlify/functions";
import { corsHeaders } from './cors';

export const config: Config = {
  path: "/api/admin/login"
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const { password } = await req.json();
    if (password === process.env.ADMIN_PASSWORD) {
      const res = new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      res.headers.append('Set-Cookie', 'admin_auth=true; Path=/; Max-Age=604800; HttpOnly');
      return res;
    }
    return new Response(JSON.stringify({ success: false, error: '비밀번호가 일치하지 않습니다.' }), { status: 401, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: 'Server Error' }), { status: 500, headers: corsHeaders });
  }
}
