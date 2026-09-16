import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { readJsonBody } from '../../src/lib/server/operationalGuard';
import { requireDataOwner, assertGuestActive, securityErrorResponse, secretHash } from '../../src/lib/server/guestIdentity';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
import { corsHeaders } from '../shared/cors';
export const config: Config = { path: '/api/chat/status' };
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const { userId, characterId, requestId } = await readJsonBody(req, 2048);
    const owner = await requireDataOwner(req, userId);
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    if (typeof characterId !== 'string' || !/^[\w-]{1,128}$/.test(characterId) ||
        typeof requestId !== 'string' || !/^[\w-]{1,128}$/.test(requestId)) throw new DiaryAuthenticationError(400, '전송 요청을 확인해주세요.');
    await assertGuestActive(adminDb, owner);
    const char = await adminDb.collection('characters').doc(characterId).get();
    if (char.data()?.userId !== owner.uid || char.data()?.deleting || char.data()?.chatClearing) throw new DiaryAuthenticationError(403, '채팅 접근 권한이 없습니다.');
    // Three fixed documents, no chat-history scans. Never return lease tokens.
    const [reply, request] = await Promise.all([
      adminDb.collection('chatMessages').doc('reply_' + secretHash(JSON.stringify([owner.uid, characterId, requestId]))).get(),
      adminDb.collection('aiRequests').doc(secretHash(owner.uid + ':chat:' + characterId + ':' + requestId)).get(),
    ]);
    const data = reply.data();
    if (reply.exists && data?.userId === owner.uid && data?.characterId === characterId) {
      return Response.json({ status: 'complete', reply: data }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
    }
    const state = request.data();
    const status = state?.status === 'running' && state.until > Date.now() ? 'running' : state ? 'failed' : 'missing';
    return Response.json({ status }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
