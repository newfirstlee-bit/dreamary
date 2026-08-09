import { getUserId } from '@/lib/auth';
import { useAuth } from '@/components/AuthContext';

export function useUserId() {
  const { user, status } = useAuth();

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
