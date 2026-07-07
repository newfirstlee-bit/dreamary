"use client";

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import BottomNav from "@/components/BottomNav";
import { getUserId } from '@/lib/auth';
import { initMixpanel, identifyUser, trackEvent } from '@/lib/mixpanel';
import AdBlockModal from '@/components/AdBlockModal';

export default function ClientLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('block_analytics=true')) {
      localStorage.setItem('block_analytics', 'true');
      alert('분석 도구(믹스패널/클래리티) 추적이 영구적으로 차단되었습니다.');
    }

    if (!isAdmin && localStorage.getItem('block_analytics') !== 'true') {
      initMixpanel();
      const userId = getUserId();
      if (userId) {
        identifyUser(userId);
      }
      trackEvent('App_Opened');
    }
  }, [isAdmin]);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
      <AdBlockModal />
      <div className="pc-banner-wrapper">
        <div className="pc-banner-left">
          {isDesktop && <iframe src="/ad_160x600.html" width={160} height={600} frameBorder="0" scrolling="no" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" style={{ border: 'none', overflow: 'hidden' }} />}
        </div>
        {children}
        <div className="pc-banner-right">
          {isDesktop && <iframe src="/ad_160x600.html" width={160} height={600} frameBorder="0" scrolling="no" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" style={{ border: 'none', overflow: 'hidden' }} />}
        </div>
      </div>
      <BottomNav />
    </>
  );
}
