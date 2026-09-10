import { Capacitor } from '@capacitor/core';
import type { User } from 'firebase/auth';
import { apiPostJson } from './api';
import { getNativeNotificationStatus } from './nativeSettings';

const DEVICE_ID_KEY = 'dreamary_push_device_id';
const PENDING_OPT_IN_KEY = 'dreamary_diary_push_pending_opt_in';
const PROMPT_DISMISSED_PREFIX = 'dreamary_diary_push_dismissed_at_';
const ENABLED_PREFIX = 'dreamary_diary_push_enabled_';

const PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

type DiaryPushPromptState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

export interface DiaryPushRegistrationResult {
  ok: boolean;
  reason?: 'unsupported' | 'permission_denied' | 'missing_user' | 'token_error' | 'server_error';
  token?: string;
}

export interface DiaryPushPermissionResult {
  supported: boolean;
  receive: DiaryPushPromptState | 'unknown';
}

export function isDiaryPushSupported() {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

export async function clearDiaryPushBadgeAndDeliveredNotifications() {
  if (!isDiaryPushSupported()) return;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const pushNotifications = PushNotifications as unknown as {
      removeAllDeliveredNotifications?: () => Promise<void>;
    };
    await pushNotifications.removeAllDeliveredNotifications?.();
  } catch (error) {
    console.warn('Push delivered notifications clear skipped:', error);
  }
}

function safeLocalStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable in restricted WebViews.
  }
}

function safeLocalStorageRemove(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getDiaryPushDeviceId() {
  let deviceId = safeLocalStorageGet(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = randomId();
    safeLocalStorageSet(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function getDiaryPushOwnerKey(ownerId: string) {
  return ownerId || 'guest';
}

export function isDiaryPushLocallyEnabled(ownerId: string) {
  return safeLocalStorageGet(`${ENABLED_PREFIX}${getDiaryPushOwnerKey(ownerId)}`) === 'true';
}

export function markDiaryPushLocallyEnabled(ownerId: string, enabled: boolean) {
  const key = `${ENABLED_PREFIX}${getDiaryPushOwnerKey(ownerId)}`;
  if (enabled) safeLocalStorageSet(key, 'true');
  else safeLocalStorageRemove(key);
}

export function shouldShowDiaryPushPrompt(ownerId: string) {
  if (!isDiaryPushSupported()) return false;
  if (isDiaryPushLocallyEnabled(ownerId)) return false;

  const dismissedAt = Number(safeLocalStorageGet(`${PROMPT_DISMISSED_PREFIX}${getDiaryPushOwnerKey(ownerId)}`) || 0);
  if (dismissedAt && Date.now() - dismissedAt < PROMPT_COOLDOWN_MS) return false;
  return true;
}

export function dismissDiaryPushPrompt(ownerId: string) {
  safeLocalStorageSet(`${PROMPT_DISMISSED_PREFIX}${getDiaryPushOwnerKey(ownerId)}`, String(Date.now()));
}

export function savePendingDiaryPushOptIn(characterId?: string, dateString?: string) {
  safeLocalStorageSet(PENDING_OPT_IN_KEY, JSON.stringify({
    characterId: characterId || '',
    dateString: dateString || '',
    createdAt: Date.now(),
  }));
}

export function hasPendingDiaryPushOptIn() {
  return Boolean(safeLocalStorageGet(PENDING_OPT_IN_KEY));
}

export function getPendingDiaryPushOptIn(): { characterId?: string; dateString?: string } | null {
  const raw = safeLocalStorageGet(PENDING_OPT_IN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      characterId: typeof parsed?.characterId === 'string' ? parsed.characterId : undefined,
      dateString: typeof parsed?.dateString === 'string' ? parsed.dateString : undefined,
    };
  } catch {
    return {};
  }
}

export function consumePendingDiaryPushOptIn(): { characterId?: string; dateString?: string } | null {
  const pending = getPendingDiaryPushOptIn();
  safeLocalStorageRemove(PENDING_OPT_IN_KEY);
  return pending;
}

async function getIdToken(user: User | null): Promise<string | null> {
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

async function waitForPushToken(): Promise<string> {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let cleanupRegistration: (() => void) | undefined;
    let cleanupRegistrationError: (() => void) | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanupRegistration?.();
      cleanupRegistrationError?.();
      fn();
    };

    const timer = window.setTimeout(() => {
      settle(() => reject(new Error('PUSH_TOKEN_TIMEOUT')));
    }, 15000);

    PushNotifications.addListener('registration', token => {
      window.clearTimeout(timer);
      settle(() => resolve(token.value));
    }).then(handle => {
      cleanupRegistration = () => handle.remove();
    });

    PushNotifications.addListener('registrationError', error => {
      window.clearTimeout(timer);
      settle(() => reject(new Error(error.error || 'PUSH_TOKEN_ERROR')));
    }).then(handle => {
      cleanupRegistrationError = () => handle.remove();
    });

    PushNotifications.register().catch(error => {
      window.clearTimeout(timer);
      settle(() => reject(error));
    });
  });
}

export async function checkDiaryPushPermission(): Promise<DiaryPushPermissionResult> {
  if (!isDiaryPushSupported()) {
    return { supported: false, receive: 'unknown' };
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const permission = await PushNotifications.checkPermissions();
    const nativeStatus = await getNativeNotificationStatus();
    const receive = (permission.receive || 'unknown') as DiaryPushPermissionResult['receive'];
    const nativeAuthorizationStatus = nativeStatus.authorizationStatus || 'unknown';

    if (receive === 'prompt' || receive === 'prompt-with-rationale' || nativeAuthorizationStatus === 'prompt') {
      return { supported: true, receive: 'prompt' };
    }

    if (
      nativeAuthorizationStatus === 'granted' ||
      nativeAuthorizationStatus === 'provisional' ||
      nativeAuthorizationStatus === 'ephemeral'
    ) {
      return { supported: true, receive: 'granted' };
    }

    if (nativeAuthorizationStatus === 'denied') {
      return { supported: true, receive: 'denied' };
    }

    if (nativeStatus.supported && !nativeStatus.enabled) {
      return { supported: true, receive: 'denied' };
    }

    return {
      supported: true,
      receive,
    };
  } catch {
    return { supported: false, receive: 'unknown' };
  }
}

export async function requestDiaryPushPermission(): Promise<DiaryPushPermissionResult> {
  if (!isDiaryPushSupported()) {
    return { supported: false, receive: 'unknown' };
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.requestPermissions();
    return await checkDiaryPushPermission();
  } catch {
    return { supported: true, receive: 'denied' };
  }
}

export async function registerDiaryPush(options: {
  user: User | null;
  ownerId: string;
  characterId?: string;
  dateString?: string;
  locale: string;
  topicOrder?: number;
  topicContent?: string;
  topicId?: string;
}): Promise<DiaryPushRegistrationResult> {
  if (!isDiaryPushSupported()) return { ok: false, reason: 'unsupported' };
  if (!options.user) return { ok: false, reason: 'missing_user' };

  const idToken = await getIdToken(options.user);
  if (!idToken) return { ok: false, reason: 'missing_user' };

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const platform = Capacitor.getPlatform();

    if (platform === 'android') {
      await PushNotifications.createChannel({
        id: 'diary',
        name: options.locale === 'ja' ? '交換日記通知' : '교환일기 알림',
        description: options.locale === 'ja'
          ? '交換日記を書ける時間にお知らせします'
          : '교환일기를 쓸 수 있을 때 알려드립니다',
        importance: 4,
        visibility: 1,
        vibration: true,
      }).catch(() => undefined);
    }

    let permission = await checkDiaryPushPermission();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await requestDiaryPushPermission();
    }

    if (permission.receive !== 'granted') {
      return { ok: false, reason: 'permission_denied' };
    }

    const token = await waitForPushToken();

    try {
      await apiPostJson('/api/push/register', {
      deviceId: getDiaryPushDeviceId(),
      platform,
      pushToken: token,
      characterId: options.characterId || '',
      dateString: options.dateString || '',
      locale: options.locale,
      topicOrder: typeof options.topicOrder === 'number' ? options.topicOrder : null,
      topicContent: options.topicContent || '',
      topicId: options.topicId || '',
      }, {
        headers: { Authorization: `Bearer ${idToken}` },
        readTimeout: 30000,
      });
    } catch (error) {
      console.warn('Diary push server registration failed:', error);
      return { ok: false, reason: 'server_error' };
    }

    markDiaryPushLocallyEnabled(options.ownerId, true);
    return { ok: true, token };
  } catch (error) {
    console.warn('Diary push registration failed:', error);
    return { ok: false, reason: 'token_error' };
  }
}

export async function recordDiaryCompletedForPush(options: {
  user: User | null;
  characterId: string;
  dateString: string;
  locale: string;
  nextTopicOrder?: number;
  nextTopicContent?: string;
  nextTopicId?: string;
}) {
  if (!isDiaryPushSupported() || !options.user) return;
  const idToken = await getIdToken(options.user);
  if (!idToken) return;

  try {
    await apiPostJson('/api/push/diary-complete', {
      characterId: options.characterId,
      dateString: options.dateString,
      locale: options.locale,
      nextTopicOrder: typeof options.nextTopicOrder === 'number' ? options.nextTopicOrder : null,
      nextTopicContent: options.nextTopicContent || '',
      nextTopicId: options.nextTopicId || '',
    }, {
      headers: { Authorization: `Bearer ${idToken}` },
      readTimeout: 30000,
    });
  } catch (error) {
    // Push scheduling must never block diary writing.
    console.warn('Diary push completion sync skipped:', error);
  }
}

export async function fetchDiaryPushStatus(user: User | null): Promise<{ enabled: boolean }> {
  if (!user) return { enabled: false };
  const idToken = await getIdToken(user);
  if (!idToken) return { enabled: false };

  try {
    return await apiPostJson<{ enabled: boolean }>('/api/push/status', {}, {
      headers: { Authorization: `Bearer ${idToken}` },
      readTimeout: 30000,
    });
  } catch (error) {
    console.warn('Diary push status fetch skipped:', error);
    return { enabled: false };
  }
}

export async function disableDiaryPush(options: {
  user: User | null;
  ownerId: string;
}) {
  if (!options.user) return;
  const idToken = await getIdToken(options.user);
  if (!idToken) return;

  await apiPostJson('/api/push/disable', {
    deviceId: getDiaryPushDeviceId(),
  }, {
    headers: { Authorization: `Bearer ${idToken}` },
    readTimeout: 30000,
  });
  markDiaryPushLocallyEnabled(options.ownerId, false);
}

export async function attachDiaryPushOpenHandler(navigate: (url: string) => void) {
  if (!isDiaryPushSupported()) return () => undefined;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const handle = await PushNotifications.addListener('pushNotificationActionPerformed', action => {
    clearDiaryPushBadgeAndDeliveredNotifications();
    const data = action.notification?.data || {};
    const url = typeof data.url === 'string' ? data.url : '/diary';
    navigate(url || '/diary');
  });
  return () => handle.remove();
}
