"use client";

import { getUserId } from './auth';

interface AdStats {
  date: string;
  diaryCount: number;
  chatCount: number;
}

interface ChatAdStats {
  date: string;
  chatCount: number;
}

const todayKey = () => new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

export const getAdStats = (): AdStats => {
  const userId = getUserId();
  const key = `dreamary_ad_stats_${userId}`;
  const today = todayKey();
  
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
  console.warn('trackChatAndCheckAd() is deprecated. Use shouldShowChatAd() before send and recordSuccessfulChatTurn() after AI reply success.');
  return shouldShowChatAd();
};

const getChatAdStats = (): ChatAdStats => {
  const userId = getUserId();
  const key = `dreamary_chat_ad_stats_v2_${userId}`;
  const today = todayKey();

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const stats = JSON.parse(raw) as ChatAdStats;
      if (stats.date === today) return stats;
    }
  } catch (e) {
    console.error(e);
  }

  return { date: today, chatCount: 0 };
};

const saveChatAdStats = (stats: ChatAdStats) => {
  const userId = getUserId();
  const key = `dreamary_chat_ad_stats_v2_${userId}`;
  localStorage.setItem(key, JSON.stringify(stats));
};

export const shouldShowChatAd = (): boolean => {
  if (typeof window !== 'undefined' && localStorage.getItem('dev_force_ads') === 'true') {
    return true;
  }

  const stats = getChatAdStats();
  const nextChatCount = stats.chatCount + 1;
  return nextChatCount >= 3 && nextChatCount % 3 === 0;
};

export const recordSuccessfulChatTurn = () => {
  const stats = getChatAdStats();
  saveChatAdStats({ ...stats, chatCount: stats.chatCount + 1 });
};
