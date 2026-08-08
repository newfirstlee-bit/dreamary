"use client";

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

interface NativeNavigationOptions {
  pathname?: string | null;
  navigateBack?: () => void;
  navigateHome?: () => void;
}

const MAIN_TAB_PATHS = new Set(['/diary', '/chat', '/mypage']);

function normalizePath(pathname?: string | null): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.matches('input, textarea, select, [contenteditable="true"]');
}

export function useNativeNavigation(options: NativeNavigationOptions = {}) {
  const { pathname, navigateBack, navigateHome } = options;

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // 네이티브 앱에서는 body에 클래스를 추가하여 CSS에서 safe area 처리
    document.body.classList.add('is-native-app');
    document.body.classList.add(`is-${Capacitor.getPlatform()}-app`);

    // Native apps draw the web background behind the status bar so patterned pages continue into the notch/status area.
    const setupStatusBar = async () => {
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        const platform = Capacitor.getPlatform();
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setOverlaysWebView({ overlay: true });
        if (platform === 'android') {
          await StatusBar.setBackgroundColor({ color: '#00000000' });
        }
      } catch (err) {
        console.warn('StatusBar setup skipped:', err);
      }
    };

    setupStatusBar();

    return () => {
      document.body.classList.remove('is-native-app');
      document.body.classList.remove('is-ios-app');
      document.body.classList.remove('is-android-app');
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const goHome = () => {
      try {
        sessionStorage.setItem('has_redirected_to_diary', 'true');
      } catch {
        // sessionStorage may be unavailable in rare WebView states. Navigation can continue safely.
      }
      if (navigateHome) {
        navigateHome();
      } else {
        window.location.assign('/');
      }
    };

    const goBack = () => {
      if (navigateBack && window.history.length > 1) {
        navigateBack();
        return;
      }
      goHome();
    };

    const handleBackNavigation = (exitOnRoot: boolean) => {
      const currentPath = normalizePath(pathname ?? window.location.pathname);

      if (currentPath === '/') {
        if (exitOnRoot && Capacitor.getPlatform() === 'android') {
          import('@capacitor/app')
            .then(({ App }) => App.exitApp())
            .catch(error => console.warn('App exit skipped:', error));
        }
        return;
      }

      if (MAIN_TAB_PATHS.has(currentPath)) {
        goHome();
        return;
      }

      goBack();
    };

    let removeBackButtonListener: (() => void) | undefined;

    if (Capacitor.getPlatform() === 'android') {
      import('@capacitor/app')
        .then(({ App }) => {
          App.addListener('backButton', () => {
            handleBackNavigation(true);
          }).then(handle => {
            removeBackButtonListener = () => handle.remove();
          });
        })
        .catch(error => console.warn('Android back button setup skipped:', error));
    }

    const swipeStart = {
      active: false,
      x: 0,
      y: 0,
      time: 0,
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      if (document.body.classList.contains('is-keyboard-open')) return;
      if (isEditableElement(event.target as Element | null) || isEditableElement(document.activeElement)) return;

      const touch = event.touches[0];
      if (touch.clientX > 28) return;

      swipeStart.active = true;
      swipeStart.x = touch.clientX;
      swipeStart.y = touch.clientY;
      swipeStart.time = Date.now();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!swipeStart.active) return;
      swipeStart.active = false;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const deltaX = touch.clientX - swipeStart.x;
      const deltaY = touch.clientY - swipeStart.y;
      const elapsed = Date.now() - swipeStart.time;
      const isBackSwipe = deltaX >= 80 && Math.abs(deltaY) <= 70 && deltaX > Math.abs(deltaY) * 1.5 && elapsed <= 700;

      if (isBackSwipe) {
        handleBackNavigation(false);
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      removeBackButtonListener?.();
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pathname, navigateBack, navigateHome]);
}
