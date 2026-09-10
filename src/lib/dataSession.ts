import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth, dataAuth } from './firebase';
import { getUserId } from './auth';
import { apiPostJson } from './api';

let activeIdentity = '';
let queue: Promise<unknown> = Promise.resolve();
export const dataIdentity = () => `${auth.currentUser ? 'login' : 'guest'}:${getUserId()}`;

export async function ensureDataSession() {
  if (typeof window === 'undefined') throw new Error('서버는 Firebase Admin을 사용해야 합니다.');
  const identity = dataIdentity();
  if (activeIdentity === identity && dataAuth.currentUser) return identity;
  const task = queue.catch(() => {}).then(async () => {
    if (identity !== dataIdentity()) throw new Error('사용자가 변경되었습니다. 다시 시도해주세요.');
    if (activeIdentity === identity && dataAuth.currentUser) return;
    activeIdentity = '';
    await signOut(dataAuth);
    const userId = getUserId();
    const response = await apiPostJson<{ customToken: string }>('/api/data/session', { userId }, { readTimeout: 15000 });
    if (identity !== dataIdentity()) throw new Error('사용자가 변경되었습니다. 다시 시도해주세요.');
    await signInWithCustomToken(dataAuth, response.customToken);
    if (identity !== dataIdentity()) {
      await signOut(dataAuth);
      throw new Error('사용자가 변경되었습니다. 다시 시도해주세요.');
    }
    activeIdentity = identity;
  });
  queue = task;
  await task;
  return identity;
}
