import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const USER_ID_KEY = 'dreamary_user_id';

const NATIVE_USER_ID_KEY = 'dreamary_guest_identity_v1';
const NATIVE_SECRET_PREFIX = 'dreamary_guest_secret_v1_';

const pendingUserOperations = new Map<string, Promise<void>>();

function queueUserOperation(userId: string, operation: () => Promise<void>): Promise<void> {
  const previous = pendingUserOperations.get(userId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  pendingUserOperations.set(userId, next);
  void next.finally(() => {
    if (pendingUserOperations.get(userId) === next) pendingUserOperations.delete(userId);
  }).catch(() => undefined);
  return next;
}

function getPreferences(): typeof Preferences | null {
  return Capacitor.isNativePlatform() ? Preferences : null;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const item of document.cookie.split(';')) {
    const value = item.trim();
    if (value.startsWith(prefix)) return value.slice(prefix.length) || null;
  }
  return null;
}

function setCookie(name: string, value: string, days: number) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/`;
}

function secretKey(userId: string) {
  return `${NATIVE_SECRET_PREFIX}${userId}`;
}

/**
 * Restore the guest identity before application screens start reading data.
 * Existing localStorage/cookie state always wins so this cannot replace an
 * active identity after login, logout, or a completed migration.
 */
export async function hydrateGuestIdentity(): Promise<void> {
  const preferences = getPreferences();
  if (!preferences || typeof window === 'undefined') return;

  const localId = localStorage.getItem(USER_ID_KEY) || getCookie(USER_ID_KEY);
  if (localId) {
    await preferences.set({ key: NATIVE_USER_ID_KEY, value: localId });
    if (!localStorage.getItem(USER_ID_KEY)) localStorage.setItem(USER_ID_KEY, localId);
    if (!getCookie(USER_ID_KEY)) setCookie(USER_ID_KEY, localId, 365);
    return;
  }

  const stored = (await preferences.get({ key: NATIVE_USER_ID_KEY })).value;
  if (!stored) return;
  localStorage.setItem(USER_ID_KEY, stored);
  setCookie(USER_ID_KEY, stored, 365);
}

export async function readGuestSecret(userId: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const localSecret = localStorage.getItem(`dreamary_guest_secret_${userId}`);
  const preferences = getPreferences();
  if (!preferences) return localSecret;
  if (localSecret) {
    await preferences.set({ key: secretKey(userId), value: localSecret });
    return localSecret;
  }
  const stored = (await preferences.get({ key: secretKey(userId) })).value;
  if (stored) localStorage.setItem(`dreamary_guest_secret_${userId}`, stored);
  return stored || null;
}

export async function persistGuestSecret(userId: string, secret: string): Promise<void> {
  await queueUserOperation(userId, async () => {
    const preferences = getPreferences();
    if (preferences) await preferences.set({ key: secretKey(userId), value: secret });
  });
}

export async function persistGuestIdentity(userId: string): Promise<void> {
  await queueUserOperation(userId, async () => {
    const preferences = getPreferences();
    if (preferences) await preferences.set({ key: NATIVE_USER_ID_KEY, value: userId });
  });
}

export async function removeGuestPersistence(userId: string): Promise<void> {
  await queueUserOperation(userId, async () => {
    const preferences = getPreferences();
    if (!preferences) return;
    await Promise.all([
      preferences.remove({ key: NATIVE_USER_ID_KEY }),
      preferences.remove({ key: secretKey(userId) }),
    ]);
  });
}
