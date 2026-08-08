"use client";

interface DraftData {
  text: string;
  savedAt: number;
}

const DRAFT_PREFIX = 'dreamary_draft_';
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
export type DraftScope = 'diary' | 'chat';

const getDraftKey = (characterId: string, scope: DraftScope) => `${DRAFT_PREFIX}${scope}_${characterId}`;

export const saveDraft = (characterId: string, text: string, scope: DraftScope = 'diary') => {
  if (typeof window === 'undefined') return;
  const data: DraftData = {
    text,
    savedAt: Date.now()
  };
  localStorage.setItem(getDraftKey(characterId, scope), JSON.stringify(data));
};

export const loadDraft = (characterId: string, scope: DraftScope = 'diary'): string | null => {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(getDraftKey(characterId, scope));
  if (!raw) return null;
  
  try {
    const data = JSON.parse(raw) as DraftData;
    if (Date.now() - data.savedAt > MAX_AGE_MS) {
      clearDraft(characterId, scope);
      return null;
    }
    return data.text;
  } catch (e) {
    return null;
  }
};

export const clearDraft = (characterId: string, scope: DraftScope = 'diary') => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(getDraftKey(characterId, scope));
};
