export const USER_ID_KEY = 'dreamary_user_id';

export function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function setCookie(name: string, value: string, days: number) {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + (value || "")  + expires + "; path=/";
}

function getCookie(name: string) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for(let i=0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

import { auth } from './firebase';

export function getUserId(): string {
  if (typeof window === 'undefined') return ''; // SSR 대응

  if (auth.currentUser) {
    return auth.currentUser.uid;
  }

  let userId = localStorage.getItem(USER_ID_KEY);
  let cookieUserId = getCookie(USER_ID_KEY);

  if (!userId && !cookieUserId) {
    const newId = generateUUID();
    localStorage.setItem(USER_ID_KEY, newId);
    setCookie(USER_ID_KEY, newId, 365);
    return newId;
  }

  // 동기화
  if (userId && !cookieUserId) {
    setCookie(USER_ID_KEY, userId, 365);
  } else if (!userId && cookieUserId) {
    localStorage.setItem(USER_ID_KEY, cookieUserId);
    userId = cookieUserId;
  }

  return userId || cookieUserId || '';
}
