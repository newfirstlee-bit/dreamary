const normalizeDiaryDocPart = (value: string) =>
  encodeURIComponent(value.trim())
    .replace(/\./g, '%2E')
    .replace(/%/g, '_');

export const getDiaryDailyDocId = (userId: string, characterId: string, dateString: string) =>
  `daily_${normalizeDiaryDocPart(userId)}_${normalizeDiaryDocPart(characterId)}_${normalizeDiaryDocPart(dateString)}`;
