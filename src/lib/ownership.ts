import { Character, completeOwnershipMigration, getCharactersByUser, prepareOwnershipMigration } from './db';
import { clearUserCache } from './appCache';
import { copyRecentCharacterOrder } from './characterOrder';
import { getStoredGuestUserId } from './auth';

export async function getCharactersWithGuestRecovery(
  currentUserId: string,
  isAuthenticated: boolean
): Promise<Character[]> {
  const characters = await getCharactersByUser(currentUserId);
  if (characters.length > 0 || !isAuthenticated) return characters;

  const guestUserId = getStoredGuestUserId();
  if (!guestUserId || guestUserId === currentUserId) return characters;

  try {
    // Signed-in Firestore credentials cannot read the old guest's documents.
    // Prove both identities to the server first; read only the resulting UID.
    const migration = await prepareOwnershipMigration(guestUserId);
    await completeOwnershipMigration(migration, currentUserId);
    copyRecentCharacterOrder(guestUserId, currentUserId);
    clearUserCache(guestUserId);
    clearUserCache(currentUserId);

    return await getCharactersByUser(currentUserId);
  } catch (error) {
    console.warn('Guest ownership recovery skipped:', error);
    return characters;
  }
}
