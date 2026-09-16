import { Capacitor } from '@capacitor/core';
import { apiFetch, apiPostJson } from './api';
export interface ChatReply { reply: string; savedId: string }
// Native JSON avoids WebView streaming transport problems. Web retains live
// streaming, with a deadline covering the response body as well as headers.
export async function sendChatRequest(payload: Record<string, unknown>, onChunk: (text: string, id: string) => void): Promise<ChatReply> {
  if (Capacitor.isNativePlatform()) return apiPostJson('/api/chat', { ...payload, preferJsonResponse: true }, { readTimeout: 70000 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70000);
  try {
    const response = await apiFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    if (response.headers.get('Content-Type')?.includes('application/json')) {
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || '채팅 전송에 실패했습니다.');
      return result;
    }
    if (!response.ok || !response.body) throw new Error('채팅 전송에 실패했습니다.');
    const savedId = response.headers.get('X-Message-Id') || '';
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let reply = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        onChunk(reply, savedId);
      }
      reply += decoder.decode();
      return { reply, savedId };
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } finally { clearTimeout(timer); }
}
