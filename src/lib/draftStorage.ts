"use client";

interface DraftData {
  text: string;
  savedAt: number;
}

const DRAFT_PREFIX = 'dreamary_draft_';
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export const saveDraft = (characterId: string, text: string) => {
  if (typeof window === 'undefined') return;
  const data: DraftData = {
    text,
    savedAt: Date.now()
  };
  localStorage.setItem(DRAFT_PREFIX + characterId, JSON.stringify(data));
};

export const loadDraft = (characterId: string): string | null => {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(DRAFT_PREFIX + characterId);
  if (!raw) return null;
  
  try {
    const data = JSON.parse(raw) as DraftData;
    if (Date.now() - data.savedAt > MAX_AGE_MS) {
      clearDraft(characterId);
      return null;
    }
    return data.text;
  } catch (e) {
    return null;
  }
};

export const clearDraft = (characterId: string) => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DRAFT_PREFIX + characterId);
};
