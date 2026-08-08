import type { Config } from "@netlify/functions";
import { getTopics } from '../../src/lib/db';
import { corsHeaders } from './cors';

export const config: Config = {
  path: "/api/admin/dump-topics"
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const topics = await getTopics();
    return new Response(JSON.stringify(topics), { headers: corsHeaders });
  } catch (error) {
    console.error('Dump Topics Error:', error);
    return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500, headers: corsHeaders });
  }
}
