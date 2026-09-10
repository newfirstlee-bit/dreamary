"use client";

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const AUTH_RESTORE_TIMEOUT_MS = 5000;

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  status: 'checking' | 'authenticated' | 'guest';
  syncAuthUser: (currentUser: User | null) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  status: 'checking',
  syncAuthUser: () => undefined,
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthContextType['status']>('checking');

  const applyAuthState = useCallback((currentUser: User | null) => {
    setError(null);
    setUser(currentUser);
    setStatus(currentUser ? 'authenticated' : 'guest');
    setLoading(false);

    if (typeof window !== 'undefined' && currentUser) {
      localStorage.setItem('last_active_user_id', currentUser.uid);
    }
  }, []);

  useEffect(() => {
    let authStateReceived = false;

    const receiveAuthState = (currentUser: User | null) => {
      authStateReceived = true;
      applyAuthState(currentUser);
    };

    // The listener remains active after the fallback, so a late restored session still wins.
    const unsubscribe = onAuthStateChanged(
      auth,
      receiveAuthState,
      (authError) => {
        console.warn('Firebase auth state restore failed; continuing with local guest identity.', authError);
        receiveAuthState(auth.currentUser);
      }
    );

    // WKWebView can occasionally leave Firebase session restoration pending indefinitely.
    // Guest mode must remain usable even when that callback never arrives.
    const restoreTimer = window.setTimeout(() => {
      if (!authStateReceived) receiveAuthState(auth.currentUser);
    }, AUTH_RESTORE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(restoreTimer);
      unsubscribe();
    };
  }, [applyAuthState]);

  return (
    <AuthContext.Provider value={{ user, loading, error, status, syncAuthUser: applyAuthState }}>
      {children}
    </AuthContext.Provider>
  );
}
