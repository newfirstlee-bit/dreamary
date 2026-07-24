'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

// --- Locale dictionaries ---
import ko from '@/locales/ko.json';
import ja from '@/locales/ja.json';

export type Locale = 'ko' | 'ja';

const dictionaries: Record<Locale, Record<string, string>> = { ko, ja };

const STORAGE_KEY = 'dreamary_locale';

// --- Core functions (non-React) ---

export function getLocale(): Locale {
  if (typeof window === 'undefined') return 'ko';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'ko' || stored === 'ja') return stored;

  // Auto-detect from browser language
  const browserLang = navigator.language || '';
  const detected: Locale = browserLang.startsWith('ja') ? 'ja' : 'ko';
  localStorage.setItem(STORAGE_KEY, detected);
  return detected;
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  // Dispatch custom event so all useLocale hooks react
  window.dispatchEvent(new CustomEvent('locale-changed', { detail: locale }));
}

export function t(key: string, locale?: Locale): string {
  const lang = locale ?? getLocale();
  const dict = dictionaries[lang] || dictionaries.ko;
  return dict[key] ?? dictionaries.ko[key] ?? key;
}

/** Get locale-appropriate date locale string */
export function getDateLocale(locale?: Locale): string {
  const lang = locale ?? getLocale();
  return lang === 'ja' ? 'ja-JP' : 'ko-KR';
}

/** Get locale-appropriate timezone */
export function getTimezone(locale?: Locale): string {
  const lang = locale ?? getLocale();
  return lang === 'ja' ? 'Asia/Tokyo' : 'Asia/Seoul';
}

/** Format date-relative time string for chat/diary with month+day fallback */
export function formatDateRelative(timestamp: number, locale?: Locale): string {
  const lang = locale ?? getLocale();
  const d = new Date(timestamp);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(getDateLocale(lang), { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  if (lang === 'ja') {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// --- React context & hook ---

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}>({
  locale: 'ko',
  setLocale: () => {},
  t: (key: string) => key,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ko');

  useEffect(() => {
    setLocaleState(getLocale());

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Locale;
      setLocaleState(detail);
    };
    window.addEventListener('locale-changed', handler);
    return () => window.removeEventListener('locale-changed', handler);
  }, []);

  const changeLocale = useCallback((l: Locale) => {
    setLocale(l);
    setLocaleState(l);
  }, []);

  const translate = useCallback(
    (key: string) => t(key, locale),
    [locale]
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale: changeLocale, t: translate }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
