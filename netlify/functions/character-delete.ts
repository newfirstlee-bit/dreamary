import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from './cors';
import { requireDataOwner, assertGuestActive, securityErrorResponse } from '../../src/lib/server/guestIdentity';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
export const config: Config = { path: '/api/character/delete' };
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const { userId, characterId } = await req.json();
    const owner = await requireDataOwner(req, userId);
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    if (typeof characterId !== 'string' || !characterId || characterId.includes('/')) throw new DiaryAuthenticationError(400, '캐릭터 정보가 필요합니다.');
    const ref = adminDb.collection('characters').doc(characterId);
    const done = await adminDb.runTransaction(async transaction => {
      await assertGuestActive(adminDb!, owner, transaction);
      const character = await transaction.get(ref);
      if (!character.exists) return true;
      if (character.data()?.userId !== owner.uid) throw new DiaryAuthenticationError(403, '삭제 권한이 없습니다.');
      const snapshots = await Promise.all(['diaries', 'chatMessages'].map(name => transaction.get(
        adminDb!.collection(name).where('userId', '==', owner.uid).where('characterId', '==', characterId).limit(20))));
      snapshots.forEach(snapshot => snapshot.docs.forEach(item => transaction.delete(item.ref)));
      const complete = snapshots.every(snapshot => snapshot.size < 20);
      if (complete) {
        transaction.delete(adminDb!.collection('users').doc(characterId));
        transaction.delete(ref);
      } else transaction.update(ref, { deleting: true });
      return complete;
    });
    return Response.json({ done }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
