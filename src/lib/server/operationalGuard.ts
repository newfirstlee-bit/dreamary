import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction, DocumentReference } from 'firebase-admin/firestore';
import { DiaryAuthenticationError } from './diaryAuthentication';
import { secretHash } from './guestIdentity';

export function envLimit(name: string, fallback: number, maximum = 1000000) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}
export async function readJsonBody(req: Request, maximum = 65536) {
  const reader = req.body?.getReader();
  if (!reader) throw new DiaryAuthenticationError(400, '요청 내용이 필요합니다.');
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new DiaryAuthenticationError(413, '요청 내용이 너무 큽니다.'); }
      text += decoder.decode(value, { stream: true });
    }
    const parsed = JSON.parse(text + decoder.decode());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DiaryAuthenticationError(400, '요청 형식을 확인해주세요.');
    return parsed;
  } catch (error) {
    if (error instanceof DiaryAuthenticationError) throw error;
    throw new DiaryAuthenticationError(400, '요청 형식을 확인해주세요.');
  } finally { reader.releaseLock(); }
}

export function validateAiInput(character: unknown, profile: unknown, messages?: unknown) {
  for (const value of [character, profile]) {
    if (value != null && (typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 12000))
      throw new DiaryAuthenticationError(400, '캐릭터 설정이 너무 길거나 형식이 올바르지 않습니다.');
  }
  if (messages !== undefined && (!Array.isArray(messages) || messages.length > 10 || messages.some(m =>
      !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 4000)))
    throw new DiaryAuthenticationError(400, '채팅은 최근 10개, 메시지당 4,000자까지 전송할 수 있습니다.');
}

export async function consumeOperation(db: Firestore, scope: string, identity: string, maximum: number) {
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  const ref = db.collection('operationUsage').doc(secretHash(scope + ':' + identity));
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref), data = snapshot.data();
    const count = data?.day === day ? data.count || 0 : 0;
    if (count >= maximum) throw new DiaryAuthenticationError(429, '오늘 이용 한도에 도달했습니다. 내일 다시 시도해주세요.');
    tx.set(ref, { uid: identity, scope, day, count: count + 1, expiresAt: new Date(now + 7 * 86400000) });
  });
}

export type AiPermit = Awaited<ReturnType<typeof reserveAiRequest>>;
// Worst-case generation attempts are reserved, including the diary language retry.
// Shard budgets add up to the global ceiling; unused shard capacity is not borrowed.
export async function reserveAiRequest(db: Firestore, uid: string, key: string, attempts = 1, resultRef?: DocumentReference) {
  if (process.env.AI_GENERATION_ENABLED === 'false') throw new DiaryAuthenticationError(503, '답장 생성을 잠시 점검하고 있습니다. 저장된 기록은 계속 확인할 수 있습니다.');
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), minute = Math.floor(now / 60000);
  const hash = secretHash(uid), shard = parseInt(hash.slice(0, 8), 16) % 16;
  const globalMaximum = envLimit('AI_DAILY_ATTEMPT_LIMIT', 1000);
  const shardMaximum = Math.floor(globalMaximum / 16) + (shard < globalMaximum % 16 ? 1 : 0);
  const requestRef = db.collection('aiRequests').doc(secretHash(uid + ':' + key));
  const userRef = db.collection('operationUsage').doc('ai_' + hash);
  const globalRef = db.collection('operationUsage').doc(`global_${shard}`);
  const token = randomUUID(), until = now + 55000;
  const savedRecord = await db.runTransaction(async tx => {
    const saved = resultRef ? await tx.get(resultRef) : null;
    if (saved?.exists) return saved.data();
    const [request, user, global] = await Promise.all([tx.get(requestRef), tx.get(userRef), tx.get(globalRef)]);
    const r = request.data(), u = user.data(), g = global.data();
    if (r?.status === 'complete') throw new DiaryAuthenticationError(409, '이미 처리된 요청입니다. 화면을 새로 열어주세요.');
    if ((r?.until || 0) > now || (u?.activeUntil || 0) > now)
      throw new DiaryAuthenticationError(409, '답장을 생성 중입니다. 잠시 후 다시 확인해주세요.');
    const active = (Array.isArray(g?.active) ? g.active : []).filter((slot: { until: number }) => slot.until > now);
    const concurrentMaximum = envLimit('AI_GLOBAL_CONCURRENCY_LIMIT', 32);
    const shardConcurrentMaximum = Math.floor(concurrentMaximum / 16) + (shard < concurrentMaximum % 16 ? 1 : 0);
    if (active.length >= shardConcurrentMaximum) throw new DiaryAuthenticationError(429, '답장 요청이 몰리고 있습니다. 잠시 후 다시 시도해주세요.');
    const globalCount = g?.day === day ? g.count || 0 : 0;
    const daily = u?.day === day ? u.daily || 0 : 0;
    const recent = u?.minute === minute ? u.recent || 0 : 0;
    if (daily + attempts > envLimit('AI_USER_DAILY_ATTEMPT_LIMIT', 100) || recent >= envLimit('AI_USER_MINUTE_LIMIT', 6) ||
        globalCount + attempts > shardMaximum)
      throw new DiaryAuthenticationError(429, '현재 답장 생성 이용 한도에 도달했습니다. 잠시 후 또는 내일 다시 시도해주세요.');
    const expiresAt = new Date(now + 7 * 86400000);
    tx.set(userRef, { uid, day, daily: daily + attempts, minute, recent: recent + 1, activeUntil: until, token, expiresAt });
    tx.set(globalRef, { day, count: globalCount + attempts, active: [...active, { token, until }], expiresAt });
    tx.set(requestRef, { uid, token, until, status: 'running', expiresAt });
  });
  const signal = AbortSignal.timeout(45000);
  return { requestRef, userRef, globalRef, token, until, signal, startedAt: now, savedRecord };
}
export async function assertAiPermit(tx: Transaction, permit: AiPermit) {
  const current = await tx.get(permit.requestRef);
  if (current.data()?.token !== permit.token || Date.now() >= permit.until)
    throw new DiaryAuthenticationError(409, '답장 처리 시간이 초과되었습니다. 다시 시도해주세요.');
}
export async function finishAiRequest(db: Firestore, permit: AiPermit, success: boolean) {
  try {
    await db.runTransaction(async tx => {
      const [request, user, global] = await Promise.all([tx.get(permit.requestRef), tx.get(permit.userRef), tx.get(permit.globalRef)]);
      if (global.exists) tx.update(permit.globalRef, { active: (global.data()?.active || []).filter((slot: { token: string; until: number }) => slot.token !== permit.token && slot.until > Date.now()) });
      if (request.data()?.token === permit.token) tx.update(permit.requestRef, { status: success ? 'complete' : 'failed', until: 0, ...(success ? { expiresAt: null } : {}) });
      if (user.data()?.token === permit.token) tx.update(permit.userRef, { activeUntil: 0 });
    });
  } finally {
    console.log(JSON.stringify({ event: 'ai_request_finished', success, durationMs: Date.now() - permit.startedAt }));
  }
}
