import { DiaryAuthenticationError } from './diaryAuthentication';

export function currentDiaryDate(offsetMinutes: unknown, now = Date.now()) {
  // Bound the caller's local timezone; never trust a caller-supplied 'today'.
  if (typeof offsetMinutes !== 'number' || !Number.isInteger(offsetMinutes) ||
      offsetMinutes < -840 || offsetMinutes > 720) {
    throw new DiaryAuthenticationError(400, '기기의 시간대 정보를 확인해주세요.');
  }
  return new Date(now - offsetMinutes * 60000).toISOString().slice(0, 10);
}
