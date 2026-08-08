import { useState, useEffect } from 'react';
import { getUserId } from '@/lib/auth';
import { useAuth } from '@/components/AuthContext';

export function useUserId() {
  const { user, status } = useAuth();
  const [activeUserId, setActiveUserId] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'guest') setActiveUserId(getUserId());
    if (status === 'authenticated' && user) setActiveUserId(user.uid);
  }, [status, user]);

  if (status === 'checking') {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('last_active_user_id') || getUserId();
    }
    return null;
  }
  return user?.uid || activeUserId;
}
