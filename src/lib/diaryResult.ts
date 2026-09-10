import type { Diary } from './db';

export interface DiarySaveResponse {
  reply?: string;
  savedId?: string;
  created?: boolean;
  diary?: Diary;
}

/** Older servers omit diary; keep snapshot compatibility without inventing saved data. */
export function savedDiaryForView(response: DiarySaveResponse, userId: string, characterId: string, dateString: string): Diary | null {
  const diary = response.diary;
  if (!diary || !diary.id || diary.id !== response.savedId
    || diary.userId !== userId || diary.characterId !== characterId || diary.dateString !== dateString) return null;
  return diary;
}
