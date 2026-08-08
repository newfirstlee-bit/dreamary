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
    const guestCharacters = await getCharactersByUser(guestUserId);
    if (guestCharacters.length === 0) return characters;

    const migration = await prepareOwnershipMigration(guestUserId);
    await completeOwnershipMigration(migration, currentUserId);
    copyRecentCharacterOrder(guestUserId, currentUserId);
    clearUserCache(guestUserId);
    clearUserCache(currentUserId);

    return guestCharacters.map(character => ({ ...character, userId: currentUserId }));
  } catch (error) {
    console.warn('Guest ownership recovery skipped:', error);
    return characters;
  }
}
