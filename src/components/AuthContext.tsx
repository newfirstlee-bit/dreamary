"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const AUTH_RESTORE_TIMEOUT_MS = 2000;

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  status: 'checking' | 'authenticated' | 'guest';
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, error: null, status: 'checking' });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthContextType['status']>('checking');

  useEffect(() => {
    let authStateReceived = false;

    const applyAuthState = (currentUser: User | null) => {
      authStateReceived = true;
      setError(null);
      setUser(currentUser);
      setStatus(currentUser ? 'authenticated' : 'guest');
      setLoading(false);
      
      if (typeof window !== 'undefined') {
        const authId = currentUser ? currentUser.uid : null;
        if (authId) {
          localStorage.setItem('last_active_user_id', authId);
        }
      }
    };

    // The listener remains active after the fallback, so a late restored session still wins.
    const unsubscribe = onAuthStateChanged(
      auth,
      applyAuthState,
      (authError) => {
        console.warn('Firebase auth state restore failed; continuing with local guest identity.', authError);
        applyAuthState(auth.currentUser);
      }
    );

    // WKWebView can occasionally leave Firebase session restoration pending indefinitely.
    // Guest mode must remain usable even when that callback never arrives.
    const restoreTimer = window.setTimeout(() => {
      if (!authStateReceived) applyAuthState(auth.currentUser);
    }, AUTH_RESTORE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(restoreTimer);
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, status }}>
      {children}
    </AuthContext.Provider>
  );
}
