import { Character } from './db';

export function getRecentCharacterIds(userId: string | null | undefined): string[] {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(`recentChars_${userId}`) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRecentCharacterIds(userId: string | null | undefined, ids: string[]) {
  if (typeof window === 'undefined' || !userId) return;
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  localStorage.setItem(`recentChars_${userId}`, JSON.stringify(uniqueIds));
}

export function touchRecentCharacter(userId: string | null | undefined, characterId: string) {
  if (!characterId) return;
  const history = getRecentCharacterIds(userId);
  saveRecentCharacterIds(userId, [characterId, ...history.filter(id => id !== characterId)]);
}

export function copyRecentCharacterOrder(sourceUserId: string | null | undefined, targetUserId: string | null | undefined) {
  if (!sourceUserId || !targetUserId || sourceUserId === targetUserId) return;
  const sourceIds = getRecentCharacterIds(sourceUserId);
  if (sourceIds.length > 0) saveRecentCharacterIds(targetUserId, sourceIds);
}

export function sortCharactersByRecent<T extends Character>(characters: T[], userId: string | null | undefined): T[] {
  const history = getRecentCharacterIds(userId);
  return [...characters].sort((a, b) => {
    const idxA = history.indexOf(a.id);
    const idxB = history.indexOf(b.id);
    if (idxA !== -1 || idxB !== -1) {
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    }
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}
