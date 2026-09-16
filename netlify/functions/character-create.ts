import { readJsonBody } from '../../src/lib/server/operationalGuard';
import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { MAX_PAIRS } from '../../src/lib/productLimits';
import { requireDataOwner, assertGuestActive, securityErrorResponse, secretHash } from '../../src/lib/server/guestIdentity';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
import { corsHeaders } from '../shared/cors';

export const config: Config = { path: '/api/character/create' };
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const { character, profile } = await readJsonBody(req, 32768);
    const owner = await requireDataOwner(req, character?.userId);
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    if (!character || typeof character.id !== 'string' || !/^[\w-]{1,128}$/.test(character.id) ||
        typeof character.name !== 'string' || !character.name.trim() || JSON.stringify(character).length > 20000 ||
        ['diaryOwnershipMigrated', 'deleting', 'chatClearing', 'chatEpoch'].some(key => key in character)) {
      throw new DiaryAuthenticationError(400, '페어 정보를 확인해주세요.');
    }
    const ref = adminDb.collection('characters').doc(character.id);
    if (profile !== undefined && (!profile || profile.id !== character.id || typeof profile.name !== 'string' || JSON.stringify(profile).length > 8000)) {
      throw new DiaryAuthenticationError(400, '유저 정보를 확인해주세요.');
    }
    const profileRef = adminDb.collection('users').doc(character.id);
    let savedCharacter = character;
    // A shared per-owner lock serializes concurrent creation from multiple devices.
    // Count from at most five actual documents; no counter drift after deletion.
    const lock = adminDb.collection('pairCreationLocks').doc(owner.uid);
    await adminDb.runTransaction(async transaction => {
      await assertGuestActive(adminDb!, owner, transaction);
      const existing = await transaction.get(ref);
      if (existing.exists) {
        if (existing.data()?.userId !== owner.uid || existing.data()?.deleting) throw new DiaryAuthenticationError(403, '페어 접근 권한이 없습니다.');
        savedCharacter = existing.data();
        if (profile) {
          const existingProfile = await transaction.get(profileRef);
          if (!existingProfile.exists) transaction.create(profileRef, profile);
        }
        return; // Same logical creation retried after a lost response.
      }
      const deleted = await transaction.get(adminDb!.collection('dataJobs').doc(secretHash(JSON.stringify(['character-delete', owner.uid, character.id, '']))));
      if (deleted.exists) throw new DiaryAuthenticationError(409, '삭제한 페어의 번호는 다시 사용할 수 없습니다. 새 페어로 등록해주세요.');
      const reservation = await transaction.get(lock);
      const pairs = await transaction.get(adminDb!.collection('characters').where('userId', '==', owner.uid).limit(MAX_PAIRS));
      if (pairs.size + (reservation.data()?.reserved || 0) >= MAX_PAIRS) throw new DiaryAuthenticationError(409, '페어는 최대 5개까지만 등록할 수 있습니다.');
      transaction.set(lock, { ...reservation.data(), reserved: reservation.data()?.reserved || 0, updatedAt: Date.now() });
      savedCharacter = { ...character, userId: owner.uid, createdAt: Date.now() };
      transaction.create(ref, savedCharacter);
      if (profile) transaction.set(profileRef, profile);
    });
    return Response.json({ success: true, character: savedCharacter }, { headers: corsHeaders });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
