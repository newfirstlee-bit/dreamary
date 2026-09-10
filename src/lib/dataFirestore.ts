// Public SDK constructors/types stay unchanged. Only remote operations wait for
// the matching data credential. No auth checks are implemented in page components.
export * from 'firebase/firestore';
import * as sdk from 'firebase/firestore';
import { dataIdentity, ensureDataSession } from './dataSession';

function guarded<T extends (...args: any[]) => Promise<any>>(operation: T): T {
  return (async (...args: Parameters<T>) => {
    if (operation === sdk.getDocsFromServer && args[0]?.path === 'topics') return operation(...args);
    const identity = await ensureDataSession();
    if (identity !== dataIdentity()) throw new Error('사용자가 변경되었습니다. 다시 시도해주세요.');
    const value = await operation(...args);
    if (identity !== dataIdentity()) throw new Error('이전 사용자의 응답을 폐기했습니다.');
    return value;
  }) as T;
}
// Application-level owner-keyed caches remain the offline/instant UI path.
// Never return a previous data-auth user's SDK disk/memory cache after switching.
export const getDoc = guarded(sdk.getDocFromServer) as typeof sdk.getDoc;
export const getDocs = guarded(sdk.getDocsFromServer) as typeof sdk.getDocs;
export const getCountFromServer = guarded(sdk.getCountFromServer);
export const setDoc = guarded(sdk.setDoc);
export const updateDoc = guarded(sdk.updateDoc);
export const deleteDoc = guarded(sdk.deleteDoc);
export const runTransaction = guarded(sdk.runTransaction);
export const onSnapshot: typeof sdk.onSnapshot = ((...args: any[]) => {
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  const index = typeof args[1] === 'function' || args[1]?.next ? 1 : 2;
  const observer = args[index];
  const onError = typeof observer === 'function' ? args[index + 1] : observer?.error;
  ensureDataSession().then(identity => {
    if (cancelled || identity !== dataIdentity()) return;
    const next = (snapshot: any) => {
      if (cancelled || identity !== dataIdentity() || snapshot.metadata.fromCache) return;
      if (typeof observer === 'function') observer(snapshot);
      else observer?.next?.(snapshot);
    };
    const subscriptionArgs = args.slice(0, index);
    subscriptionArgs.push(next, onError);
    unsubscribe = (sdk.onSnapshot as (...values: any[]) => () => void)(...subscriptionArgs);
  }).catch(error => { if (!cancelled) onError?.(error); });
  return () => { cancelled = true; unsubscribe?.(); };
}) as typeof sdk.onSnapshot;
