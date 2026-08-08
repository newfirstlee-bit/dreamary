import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { Character, UserProfile } from '@/lib/db';
import { apiFetch, getApiUrl } from '@/lib/api';

interface InitialPingParams {
  character: Character;
  userProfile: UserProfile | null;
  userId: string;
}

export interface InitialPingResult {
  reply: string;
  savedId?: string;
}

const inFlightPings = new Map<string, Promise<InitialPingResult>>();
const REQUEST_TIMEOUT_MS = 30000;
export const INITIAL_PING_EVENT = 'dreamary:initial-ping-state';

type InitialPingEventStatus = 'started' | 'completed' | 'failed';

interface InitialPingEventDetail {
  status: InitialPingEventStatus;
  userId: string;
  characterId: string;
  reply?: string;
  savedId?: string;
}

function getPingKey(userId: string, characterId: string): string {
  return `${userId}:${characterId}`;
}

function emitInitialPingEvent(detail: InitialPingEventDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<InitialPingEventDetail>(INITIAL_PING_EVENT, { detail }));
}

export function isInitialPingPending(userId: string, characterId: string): boolean {
  return inFlightPings.has(getPingKey(userId, characterId));
}

function parseResponseData(data: unknown): Record<string, unknown> {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

async function sendInitialPing(params: InitialPingParams): Promise<InitialPingResult> {
  const payload = {
    character: params.character,
    userProfile: params.userProfile,
    messages: [],
    isFirstPing: true,
    userId: params.userId,
    requestId: `initial-ping:${params.userId}:${params.character.id}`,
  };

  let status: number;
  let data: Record<string, unknown>;

  if (Capacitor.isNativePlatform()) {
    // This is an explicit one-shot JSON request. It avoids WebView CORS without
    // globally patching fetch/XHR, so Firestore WebChannel remains untouched.
    const response = await CapacitorHttp.post({
      url: getApiUrl('/api/chat'),
      headers: { 'Content-Type': 'application/json' },
      data: payload,
      connectTimeout: 15000,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
    status = response.status;
    data = parseResponseData(response.data);
  } else {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      status = response.status;
      data = parseResponseData(await response.json().catch(() => ({})));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
  if (status < 200 || status >= 300 || !reply) {
    const message = typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new Error(`초기 메시지 생성 실패: ${message}`);
  }

  return {
    reply,
    savedId: typeof data.savedId === 'string' ? data.savedId : undefined,
  };
}

/**
 * Call only after Firestore confirms that this character has no chat messages.
 * The database is the source of truth; a stale local hasPinged flag must never
 * suppress recovery after a failed network request.
 */
export function ensureInitialPing(params: InitialPingParams): Promise<InitialPingResult> {
  const key = getPingKey(params.userId, params.character.id);
  const existing = inFlightPings.get(key);
  if (existing) return existing;

  if (typeof window !== 'undefined') {
    localStorage.removeItem(`hasPinged_${params.character.id}`);
  }

  const request = (async () => {
    emitInitialPingEvent({
      status: 'started',
      userId: params.userId,
      characterId: params.character.id,
    });

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await sendInitialPing(params);
        if (typeof window !== 'undefined') {
          localStorage.setItem(`hasPinged_${params.character.id}`, 'true');
        }
        emitInitialPingEvent({
          status: 'completed',
          userId: params.userId,
          characterId: params.character.id,
          reply: result.reply,
          savedId: result.savedId,
        });
        return result;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    emitInitialPingEvent({
      status: 'failed',
      userId: params.userId,
      characterId: params.character.id,
    });
    throw lastError instanceof Error ? lastError : new Error('초기 메시지 생성에 실패했습니다.');
  })().finally(() => {
    inFlightPings.delete(key);
  });

  inFlightPings.set(key, request);
  return request;
}
