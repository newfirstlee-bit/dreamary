import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { measurePhase } from './performanceTrace';
import { diaryRequestHeaders } from './diaryRequestHeaders';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export const getApiUrl = (endpoint: string) => {
  let baseUrl = API_BASE_URL;
  if (!baseUrl && typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
    baseUrl = 'https://dreamary.netlify.app';
  }
  return `${baseUrl}${endpoint}`;
};

export const apiFetch = async (endpoint: string, options?: RequestInit) => {
  const versionHeaders = new Headers(options?.headers);
  versionHeaders.set('X-Client-Protocol', '1');
  options = { ...options, headers: versionHeaders };
  if (endpoint === '/api/chat' && typeof options?.body === 'string') {
    const data = JSON.parse(options.body);
    const headers = new Headers(options.headers);
    const proof = await diaryRequestHeaders(data);
    headers.set('Authorization', proof.Authorization);
    options = { ...options, headers };
  }
  return fetch(getApiUrl(endpoint), options);
};

interface ApiPostJsonOptions {
  headers?: Record<string, string>;
  readTimeout?: number;
  signal?: AbortSignal;
}

const postJson = async <T = any>(endpoint: string, data: unknown, options: ApiPostJsonOptions = {}): Promise<T> => {
  if (options.signal?.aborted) throw new Error('요청이 취소되었습니다.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Client-Protocol': '1', ...(options.headers || {}) };
  if (['/api/diary', '/api/diary/edit', '/api/backup/generate', '/api/backup/migrate', '/api/data/session', '/api/chat', '/api/chat/status', '/api/character/delete', '/api/character/create', '/api/chat/delete', '/api/images/upload', '/api/reports/create'].includes(endpoint)) {
    // Do not let an override supply a stale token belonging to another account.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'authorization') delete headers[key];
    }
    const payload = data as { sourceUUID?: string; uid?: string };
    const identity = endpoint === '/api/character/create' ? { userId: (data as { character: { userId: string } }).character.userId }
      : endpoint === '/api/backup/generate' ? { userId: payload.sourceUUID }
      : endpoint === '/api/backup/migrate' ? { userId: payload.uid } : data;
    Object.assign(headers, await diaryRequestHeaders(identity, endpoint === '/api/backup/migrate'));
    if (endpoint === '/api/diary' || endpoint === '/api/diary/edit') {
      data = { ...(data as Record<string, unknown>), timezoneOffsetMinutes: new Date().getTimezoneOffset() };
    }
  }

  if (typeof window !== 'undefined' && Capacitor.isNativePlatform() && !options.signal) {
    const response = await CapacitorHttp.post({
      url: getApiUrl(endpoint),
      headers,
      data,
      connectTimeout: 15000,
      readTimeout: options.readTimeout || 90000,
    });

    const rawData = response.data;
    let parsed: any = rawData;
    if (typeof rawData === 'string') {
      try {
        parsed = JSON.parse(rawData);
      } catch {
        parsed = {
          reply: rawData,
          savedId: response.headers?.['X-Message-Id'] || response.headers?.['x-message-id'] || '',
        };
      }
    }

    if (response.status < 200 || response.status >= 300 || parsed?.error) {
      throw new Error(parsed?.error || `API request failed: ${response.status}`);
    }
    return parsed as T;
  }

  if (options.signal?.aborted) throw new Error('요청이 취소되었습니다.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.readTimeout || 90000);
  try {
    const response = await apiFetch(endpoint, {
      method: 'POST', headers, body: JSON.stringify(data), signal: controller.signal,
    });
    const parsed = await response.json();
    if (!response.ok || parsed?.error) {
      throw new Error(parsed?.error || `API request failed: ${response.status}`);
    }
    return parsed as T;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
};

export const apiPostJson = <T = any>(endpoint: string, data: unknown, options: ApiPostJsonOptions = {}): Promise<T> => {
  const send = () => postJson<T>(endpoint, data, options);
  if (endpoint === '/api/diary') return measurePhase('diary.create', 'api', send);
  if (endpoint === '/api/diary/edit') return measurePhase('diary.edit', 'api', send);
  return send();
};
