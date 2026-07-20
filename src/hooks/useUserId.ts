import { useState, useEffect } from 'react';
import { getUserId } from '@/lib/auth';
import { auth } from '@/lib/firebase';

export function useUserId() {
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);

  useEffect(() => {
    // 1. Firebase Auth 상태 변화 구독
    // 로그인이 완료되거나, 로그인 정보가 없다는 것이 확정될 때 콜백이 실행됨
    const unsubAuth = auth.onAuthStateChanged((user) => {
      // 2. 이 시점에는 Auth 상태가 확정되었으므로 getUserId()가 정확한 값을 반환함
      // (user가 있으면 auth.currentUser.uid를, 없으면 localStorage 익명 ID를 반환)
      const uid = getUserId();
      setResolvedUserId(uid);
    });

    // Cleanup subscription
    return () => unsubAuth();
  }, []);

  return resolvedUserId;
}
