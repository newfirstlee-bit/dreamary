import { getUserId } from '@/lib/auth';
import { useAuth } from '@/components/AuthContext';
import { useEffect, useReducer } from 'react';

export function useUserId() {
  const { user, status } = useAuth();
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => {
    window.addEventListener('dreamary-guest-identity-changed', refresh);
    return () => window.removeEventListener('dreamary-guest-identity-changed', refresh);
  }, []);

  if (status === 'authenticated' && user) {
    return user.uid;
  }

  if (typeof window !== 'undefined') {
    if (status === 'checking') {
      return localStorage.getItem('last_active_user_id') || getUserId();
    }
    return getUserId();
  }

  return null;
}
