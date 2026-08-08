import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export const getApiUrl = (endpoint: string) => {
  let baseUrl = API_BASE_URL;
  if (!baseUrl && typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
    baseUrl = 'https://dreamary.netlify.app';
  }
  return `${baseUrl}${endpoint}`;
};

export const apiFetch = async (endpoint: string, options?: RequestInit) => {
  return fetch(getApiUrl(endpoint), options);
};

interface ApiPostJsonOptions {
  headers?: Record<string, string>;
  readTimeout?: number;
}

export const apiPostJson = async <T = any>(endpoint: string, data: unknown, options: ApiPostJsonOptions = {}): Promise<T> => {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
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

  const response = await apiFetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  const parsed = await response.json();
  if (!response.ok || parsed?.error) {
    throw new Error(parsed?.error || `API request failed: ${response.status}`);
  }
  return parsed as T;
};
