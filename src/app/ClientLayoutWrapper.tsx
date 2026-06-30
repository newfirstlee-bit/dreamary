"use client";

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import BottomNav from "@/components/BottomNav";
import { getUserId } from '@/lib/auth';
import { initMixpanel, identifyUser, trackEvent } from '@/lib/mixpanel';

export default function ClientLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');

  useEffect(() => {
    if (!isAdmin) {
      initMixpanel();
      const userId = getUserId();
      if (userId) {
        identifyUser(userId);
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
    <>
      <div className="pc-banner-wrapper">
        <div className="pc-banner-left">
          <iframe src="/ad_160x600.html" width={160} height={600} frameBorder="0" scrolling="no" style={{ border: 'none', overflow: 'hidden' }} />
        </div>
        {children}
        <div className="pc-banner-right">
          <iframe src="/ad_160x600.html" width={160} height={600} frameBorder="0" scrolling="no" style={{ border: 'none', overflow: 'hidden' }} />
        </div>
      </div>
      <BottomNav />
    </>
  );
}
