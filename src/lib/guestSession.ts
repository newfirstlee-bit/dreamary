import { apiPostJson } from './api';
import { getStoredGuestUserId } from './auth';

const pending = new Map<string, Promise<string>>();
const sessions = new Map<string, { token: string; expiresAt: number }>();
const keyFor = (uid: string) => `dreamary_guest_secret_${uid}`;

export function getGuestSession(userId: string): Promise<string> {
  if (!userId || getStoredGuestUserId() !== userId) return Promise.reject(new Error('현재 기기의 비로그인 ID가 아닙니다.'));
  const cached = sessions.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60000) return Promise.resolve(cached.token);
  const active = pending.get(userId);
  if (active) return active;
  const obtain = async () => {
    let secret = localStorage.getItem(keyFor(userId));
    if (!secret) {
      // Never Math.random. Persist before claiming, so a lost HTTP response is
      // recoverable by retrying with the same key. Never overwrite a rejected key.
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      secret = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(keyFor(userId), secret);
    }
    const result = await apiPostJson<{ token: string; expiresAt: number }>('/api/guest/session', { userId, secret }, { readTimeout: 15000 });
    if (!result.token || !Number.isFinite(result.expiresAt)) throw new Error('비로그인 인증 응답을 확인할 수 없습니다.');
    sessions.clear();
    sessions.set(userId, result);
    return result.token;
  };
  // Serialize first-key creation across browser tabs; native WebViews normally
  // have one JS context. Never replace a key merely because the server rejects it.
  const request = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(`dreamary-guest-${userId}`, obtain);
    }
    return await obtain();
  })().finally(() => pending.delete(userId));
  pending.set(userId, request);
  return request;
}
