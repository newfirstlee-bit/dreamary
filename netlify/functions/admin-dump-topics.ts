import type { Config } from "@netlify/functions";
import { readAdminTopics } from '../../src/lib/server/adminTopics';
import { isAdminRequest } from '../../src/lib/server/adminSession';
import { corsHeaders } from './cors';

export const config: Config = {
  path: "/api/admin/dump-topics"
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    if (!await isAdminRequest(req)) return new Response(null, { status: 401 });
    const topics = await readAdminTopics();
    return new Response(JSON.stringify(topics), { headers: corsHeaders });
  } catch (error) {
    console.error('Dump Topics Error:', error);
    return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500, headers: corsHeaders });
  }
}
