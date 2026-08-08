import type { Config } from "@netlify/functions";
import { corsHeaders } from './cors';

export const config: Config = {
  path: "/api/admin/logout"
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  const res = new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  // In a real function, you might use a cookie header. For simplicity in Netlify Functions V2:
  res.headers.append('Set-Cookie', 'admin_auth=; Path=/; Max-Age=0');
  return res;
}
