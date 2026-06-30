"use client";

import { getUserId } from './auth';

interface AdStats {
  date: string;
  diaryCount: number;
  chatCount: number;
}

export const getAdStats = (): AdStats => {
  const userId = getUserId();
  const key = `dreamary_ad_stats_${userId}`;
  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }); // YYYY. MM. DD. format
  
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const stats = JSON.parse(raw) as AdStats;
      if (stats.date === today) {
        return stats;
      }
    }
  } catch (e) {
    console.error(e);
  }
  
  // Return fresh stats if date mismatched or parsing failed
  return { date: today, diaryCount: 0, chatCount: 0 };
};

export const saveAdStats = (stats: AdStats) => {
  const userId = getUserId();
  const key = `dreamary_ad_stats_${userId}`;
  localStorage.setItem(key, JSON.stringify(stats));
};

export const trackDiaryAndCheckAd = (): boolean => {
  if (typeof window !== 'undefined' && localStorage.getItem('dev_force_ads') === 'true') {
    return true;
  }

  const stats = getAdStats();
  stats.diaryCount += 1;
  saveAdStats(stats);
  
  // Diary: 1st time, then every 3rd time (1, 4, 7, 10...)
  if (stats.diaryCount === 1) return true;
  if (stats.diaryCount > 1 && (stats.diaryCount - 1) % 3 === 0) return true;
  return false;
};

export const trackChatAndCheckAd = (): boolean => {
  if (typeof window !== 'undefined' && localStorage.getItem('dev_force_ads') === 'true') {
    return true;
  }

  const stats = getAdStats();
  stats.chatCount += 1;
  saveAdStats(stats);
  
  // Chat: 3rd time, then every 3rd time (3, 6, 9...)
  if (stats.chatCount >= 3 && stats.chatCount % 3 === 0) return true;
  return false;
};
