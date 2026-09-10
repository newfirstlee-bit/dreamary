"use client";

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import BottomNav from "@/components/BottomNav";
import { getUserId } from '@/lib/auth';
import { initMixpanel, identifyUser, trackEvent, registerLanguage } from '@/lib/mixpanel';
import AdBlockModal from '@/components/AdBlockModal';
import { LocaleProvider, getLocale } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { AuthProvider } from '@/components/AuthContext';
import { useAuth } from '@/components/AuthContext';
import { useNativeNavigation } from '@/hooks/useNativeNavigation';
import { Capacitor } from '@capacitor/core';
import { shouldShowBottomNav } from '@/lib/navigation';
import {
  attachDiaryPushOpenHandler,
  checkDiaryPushPermission,
  clearDiaryPushBadgeAndDeliveredNotifications,
  isDiaryPushLocallyEnabled,
  isDiaryPushSupported,
  registerDiaryPush,
} from '@/lib/diaryPush';

function DiaryPushTokenRefresh() {
  const { user, status } = useAuth();

  useEffect(() => {
    if (!isDiaryPushSupported() || status !== 'authenticated' || !user) return;
    if (!isDiaryPushLocallyEnabled(user.uid)) return;

    const refreshKey = `dreamary_push_token_refreshed_${user.uid}`;
    if (window.sessionStorage.getItem(refreshKey) === 'true') return;
    window.sessionStorage.setItem(refreshKey, 'true');

    let cancelled = false;

    const refreshTokenIfEnabled = async () => {
      try {
        const permission = await checkDiaryPushPermission();

        if (cancelled || permission.receive !== 'granted') return;

        await registerDiaryPush({
          user,
          ownerId: user.uid,
          locale: getLocale(),
        });
      } catch (error) {
        console.warn('Diary push token refresh skipped:', error);
      }
    };

    refreshTokenIfEnabled();

    return () => {
      cancelled = true;
    };
  }, [status, user]);

  return null;
}

function AnalyticsIdentity({ isAdmin, pathname }: { isAdmin: boolean; pathname: string | null }) {
  const { user, status } = useAuth();

  useEffect(() => {
    if (isAdmin || typeof window === 'undefined') return;
    if (window.localStorage.getItem('block_analytics') === 'true') return;
    if (status === 'checking') return;

    const userId = user?.uid || getUserId();
    if (!userId) return;

    identifyUser(userId);

    if ((window as any).clarity) {
      const authStatus = user ? 'authenticated' : 'guest';
      (window as any).clarity('identify', userId);
      (window as any).clarity('set', 'dreamary_user_id', userId);
      (window as any).clarity('set', 'dreamary_auth_status', authStatus);
      if (pathname) {
        (window as any).clarity('set', 'dreamary_path', pathname);
      }
    }
  }, [isAdmin, pathname, status, user]);

  return null;
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.matches('input, textarea, [contenteditable="true"]');
}

export default function ClientLayoutWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const navigateHome = useCallback(() => router.push('/'), [router]);
  const navigateBack = useCallback(() => router.back(), [router]);
  useNativeNavigation({ pathname, navigateHome, navigateBack });

  const isAdmin = pathname?.startsWith('/admin');
  const isBottomNavRoute = shouldShowBottomNav(pathname);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    const nativePlatform = Capacitor.getPlatform();
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    let maximumViewportHeight = viewport?.height ?? window.innerHeight;

    const applyKeyboardState = (keyboardOpen: boolean) => {
      setIsKeyboardOpen(keyboardOpen);
      document.body.classList.toggle('is-keyboard-open', keyboardOpen);
    };

    const setKeyboardHeight = (height: number) => {
      document.documentElement.style.setProperty('--keyboard-height', `${Math.max(0, Math.round(height))}px`);
    };

    const setKeyboardScrollHeight = (height: number) => {
      document.documentElement.style.setProperty('--keyboard-scroll-height', `${Math.max(0, Math.round(height))}px`);
    };

    const updateViewport = () => {
      const viewportHeight = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-viewport-height', `${Math.round(viewportHeight)}px`);

      const hasEditableFocus = isEditableElement(document.activeElement);
      if (!hasEditableFocus) {
        maximumViewportHeight = Math.max(maximumViewportHeight, viewportHeight);
      }

      const viewportIsReduced = viewportHeight < maximumViewportHeight - 100;
      if (viewportIsReduced) {
        const viewportKeyboardHeight = window.innerHeight - viewportHeight - (viewport?.offsetTop ?? 0);
        setKeyboardScrollHeight(viewportKeyboardHeight);
        if (!Capacitor.isNativePlatform()) {
          setKeyboardHeight(viewportKeyboardHeight);
        }
      } else if (!hasEditableFocus) {
        setKeyboardHeight(0);
        setKeyboardScrollHeight(0);
      }
      applyKeyboardState(hasEditableFocus || viewportIsReduced);
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isEditableElement(event.target as Element | null)) return;
      if (blurTimer) clearTimeout(blurTimer);
      applyKeyboardState(true);
      window.requestAnimationFrame(updateViewport);
    };

    const handleFocusOut = () => {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(updateViewport, 200);
    };

    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    let removeKeyboardWillShow: (() => void) | undefined;
    let removeKeyboardDidShow: (() => void) | undefined;
    let removeKeyboardWillHide: (() => void) | undefined;
    let removeKeyboardDidHide: (() => void) | undefined;

    if (Capacitor.isNativePlatform()) {
      import('@capacitor/keyboard')
        .then(({ Keyboard }) => {
          Keyboard.addListener('keyboardWillShow', info => {
            // Android resizes the WebView itself. Lifting again by the reported
            // keyboard height moves the CTA twice and clips it near the top.
            setKeyboardHeight(nativePlatform === 'ios' ? info.keyboardHeight : 0);
            setKeyboardScrollHeight(info.keyboardHeight);
            applyKeyboardState(true);
          }).then(handle => { removeKeyboardWillShow = () => handle.remove(); });
          Keyboard.addListener('keyboardDidShow', info => {
            setKeyboardHeight(nativePlatform === 'ios' ? info.keyboardHeight : 0);
            setKeyboardScrollHeight(info.keyboardHeight);
            applyKeyboardState(true);
          }).then(handle => { removeKeyboardDidShow = () => handle.remove(); });
          Keyboard.addListener('keyboardWillHide', () => {
            setKeyboardHeight(0);
            setKeyboardScrollHeight(0);
            applyKeyboardState(false);
          }).then(handle => { removeKeyboardWillHide = () => handle.remove(); });
          Keyboard.addListener('keyboardDidHide', () => {
            setKeyboardHeight(0);
            setKeyboardScrollHeight(0);
            applyKeyboardState(false);
          }).then(handle => { removeKeyboardDidHide = () => handle.remove(); });
        })
        .catch(error => console.warn('Keyboard listener setup skipped:', error));
    }

    return () => {
      if (blurTimer) clearTimeout(blurTimer);
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      removeKeyboardWillShow?.();
      removeKeyboardDidShow?.();
      removeKeyboardWillHide?.();
      removeKeyboardDidHide?.();
      document.body.classList.remove('is-keyboard-open');
      document.documentElement.style.removeProperty('--app-viewport-height');
      document.documentElement.style.removeProperty('--keyboard-height');
      document.documentElement.style.removeProperty('--keyboard-scroll-height');
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('is-full-page-route', !isBottomNavRoute);
    return () => document.body.classList.remove('is-full-page-route');
  }, [isBottomNavRoute]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    attachDiaryPushOpenHandler(url => {
      if (url === '/') router.push('/');
      else router.push(url.startsWith('/') ? url : '/diary');
    })
      .then(remove => { cleanup = remove; })
      .catch(error => console.warn('Push notification open handler skipped:', error));

    return () => cleanup?.();
  }, [router]);

  useEffect(() => {
    if (!isDiaryPushSupported()) return;

    clearDiaryPushBadgeAndDeliveredNotifications();

    let removeAppStateListener: (() => void) | undefined;
    import('@capacitor/app')
      .then(({ App }) => {
        App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) clearDiaryPushBadgeAndDeliveredNotifications();
        }).then(handle => {
          removeAppStateListener = () => handle.remove();
        });
      })
      .catch(error => console.warn('Push badge app-state listener skipped:', error));

    return () => removeAppStateListener?.();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('block_analytics=true')) {
      localStorage.setItem('block_analytics', 'true');
      alert(t('analytics.blocked'));
    }

    if (!isAdmin && localStorage.getItem('block_analytics') !== 'true') {
      initMixpanel();
      const userId = getUserId();
      if (userId) {
        identifyUser(userId);
      }
      // Register language for analytics
      const locale = getLocale();
      registerLanguage(locale);
      // Set Clarity custom tag
      if (typeof window !== 'undefined' && (window as any).clarity) {
        (window as any).clarity('set', 'language', locale);
      }
      trackEvent('App_Opened');
    }

    // Add native app class for global styles
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      document.body.classList.add('is-native-app');
    }
  }, [isAdmin]);

  if (isAdmin) {
    // For admin pages, just render children without any wrappers or bottom nav.
    // The admin layout will handle its own full-width structure.
    return (
      <div style={{ width: '100%', minHeight: '100vh', backgroundColor: '#f9f9f9', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999 }}>
        {children}
      </div>
    );
  }

  return (
    <AuthProvider>
      <LocaleProvider>
        <AdBlockModal />
        <DiaryPushTokenRefresh />
        <AnalyticsIdentity isAdmin={!!isAdmin} pathname={pathname} />
        {children}
        {isBottomNavRoute && !isKeyboardOpen && <BottomNav />}
      </LocaleProvider>
    </AuthProvider>
  );
}
