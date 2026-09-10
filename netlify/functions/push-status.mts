import type { Config } from "@netlify/functions";
import { corsHeaders } from './cors';
import { getFirebaseAdminServices, verifyFirebaseIdTokenRest } from './push-shared.mts';

export const config: Config = {
  path: "/api/push/status"
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const authorization = req.headers.get('authorization') || '';
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!idToken) {
      return new Response(JSON.stringify({ enabled: false }), { headers: corsHeaders });
    }

    const uid = await verifyFirebaseIdTokenRest(idToken);
    const { firestore } = getFirebaseAdminServices();
    const targetDoc = await firestore.collection('diaryPushTargets').doc(uid).get();
    const enabled = targetDoc.exists && targetDoc.data()?.enabled === true;

    return new Response(JSON.stringify({ enabled }), { headers: corsHeaders });
  } catch (error: any) {
    console.error('Push Status Error:', error);
    return new Response(JSON.stringify({ error: error?.message || '푸시 상태 확인 중 오류가 발생했습니다.' }), { status: 500, headers: corsHeaders });
  }
}
