import type { Config } from "@netlify/functions";
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from './cors';

export const config: Config = {
  path: "/api/auth/check-id"
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    if (!adminDb) {
      return new Response(JSON.stringify({ error: '서버 설정이 완료되지 않았습니다.' }), { status: 500, headers: corsHeaders });
    }

    const { id } = await req.json();
    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing ID' }), { status: 400, headers: corsHeaders });
    }

    const snapshot = await adminDb.collection('accounts').where('id', '==', id).get();

    return new Response(JSON.stringify({ exists: !snapshot.empty }), { headers: corsHeaders });
  } catch (error) {
    console.error('Check ID Error:', error);
    return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500, headers: corsHeaders });
  }
}
