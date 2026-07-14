"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, BookOpen, MessageCircle, User } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function BottomNav() {
  const pathname = usePathname();
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const { t } = useLocale();

  useEffect(() => {
    if (window.visualViewport) {
      const handleResize = () => {
        // If the visual viewport is significantly smaller than the window innerHeight, keyboard is likely up
        if (window.visualViewport) {
          setIsKeyboardOpen(window.visualViewport.height < window.innerHeight - 100);
        }
      };
      window.visualViewport.addEventListener('resize', handleResize);
      handleResize();
      return () => window.visualViewport?.removeEventListener('resize', handleResize);
    }
  }, []);
  
  // Hide bottom nav on onboarding, specific pages, or when keyboard is open
  if (isKeyboardOpen || pathname === '/onboarding' || pathname.startsWith('/mypage/edit-pairname') || pathname.startsWith('/home-settings') || pathname.startsWith('/chat/') || pathname.startsWith('/admin') || pathname.startsWith('/mypage/edit-character') || pathname.startsWith('/mypage/edit-user')) return null;

  const navItems = [
    { name: t('nav.home'), path: '/', icon: Home },
    { name: t('nav.diary'), path: '/diary', icon: BookOpen },
    { name: t('nav.chat'), path: '/chat', icon: MessageCircle },
    { name: t('nav.mypage'), path: '/mypage', icon: User },
  ];

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: '480px',
      height: 'calc(65px + env(safe-area-inset-bottom))',
      backgroundColor: 'rgba(255, 255, 255, 0.75)',
      backdropFilter: 'blur(15px)',
      borderTop: '1px solid rgba(255, 255, 255, 0.4)',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      zIndex: 1000,
      paddingBottom: 'env(safe-area-inset-bottom)',
      boxShadow: '0 -2px 10px rgba(0,0,0,0.02)'
    }}>
      {navItems.map((item) => {
        const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
        const color = isActive ? 'var(--point-color)' : 'var(--text-muted)';
        const Icon = item.icon;
        
        return (
          <Link key={item.path} href={item.path} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textDecoration: 'none', color, width: '25%', touchAction: 'manipulation' }}>
            <Icon size={24} color={color} />
            <span style={{ fontSize: '0.7rem', marginTop: '4px', fontWeight: isActive ? 'bold' : 'normal' }}>
              {item.name}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
