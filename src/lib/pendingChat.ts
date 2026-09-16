import type { ChatMessage } from './db';
export interface PendingChat { text: string; owner: string; character: string; id: string; createdAt: number; phase?: 'preparing' | 'requested' }
export function readPendingChat(owner: string, character: string): PendingChat | null {
  try {
    const value = JSON.parse(localStorage.getItem(`chat_pending_${owner}_${character}`) || 'null');
    return value?.owner === owner && value?.character === character && typeof value.text === 'string'
      && typeof value.id === 'string' && Number.isFinite(value.createdAt) ? value : null;
  } catch { return null; }
}
export function pendingReply(messages: ChatMessage[], pending: PendingChat): ChatMessage | undefined {
  return messages.find(m => m.userId === pending.owner && m.characterId === pending.character
    && m.role === 'assistant' && m.requestId === pending.id);
}
