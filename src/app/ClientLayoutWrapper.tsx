"use client";

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import BottomNav from "@/components/BottomNav";
import { getUserId } from '@/lib/auth';
import { initMixpanel, identifyUser, trackEvent, registerLanguage } from '@/lib/mixpanel';
import AdBlockModal from '@/components/AdBlockModal';
import { LocaleProvider, getLocale } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { AuthProvider } from '@/components/AuthContext';

export default function ClientLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');
  const hideBottomNav = ['/login', '/register', '/find-id', '/reset-password'].includes(pathname || '');

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
        {children}
        {!hideBottomNav && <BottomNav />}
      </LocaleProvider>
    </AuthProvider>
  );
}
