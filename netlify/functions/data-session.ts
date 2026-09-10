import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from './cors';
import { requireDataOwner, assertGuestActive, securityErrorResponse } from '../../src/lib/server/guestIdentity';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';

export const config: Config = { path: '/api/data/session' };
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
  try {
    const { userId } = await req.json();
    const owner = await requireDataOwner(req, userId);
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    await assertGuestActive(adminDb, owner);
    const { getAuth } = await import('firebase-admin/auth');
    const customToken = await getAuth().createCustomToken(owner.kind === 'guest' ? `guest:${owner.uid}` : owner.uid, {
      dreamaryOwner: owner.uid, dreamaryGuest: owner.kind === 'guest',
    });
    return Response.json({ customToken }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
