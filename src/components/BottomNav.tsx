"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookOpen, MessageCircle, User } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { shouldShowBottomNav } from '@/lib/navigation';

export default function BottomNav() {
  const pathname = usePathname();
  const { t } = useLocale();
  
  // Bottom navigation is rendered only for explicitly approved tab routes.
  if (!shouldShowBottomNav(pathname)) return null;

  const navItems = [
    { name: t('nav.home'), path: '/', icon: Home },
    { name: t('nav.diary'), path: '/diary', icon: BookOpen },
    { name: t('nav.chat'), path: '/chat', icon: MessageCircle },
    { name: t('nav.mypage'), path: '/mypage', icon: User },
  ];

  return (
    <nav className="bottom-nav" style={{
      position: 'fixed',
      bottom: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: '480px',
      height: 'var(--bottom-nav-height)',
      backgroundColor: '#FFFFFF',
      backdropFilter: 'none',
      borderTop: '1px solid rgba(0, 0, 0, 0.08)',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      paddingTop: 0,
      zIndex: 1000,
      paddingBottom: 'var(--bottom-ui-safe-gap)',
      boxShadow: '0 -2px 10px rgba(0,0,0,0.02)'
    }}>
      {navItems.map((item) => {
        const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
        const color = isActive ? 'var(--point-color)' : 'var(--text-muted)';
        const Icon = item.icon;
        
        return (
          <Link 
            key={item.path} 
            href={item.path} 
            prefetch={false}
            onClick={() => {
              if (typeof window !== 'undefined') {
                if (item.path === '/') {
                  sessionStorage.setItem('has_redirected_to_diary', 'true');
                }
              }
            }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textDecoration: 'none', color, width: '25%', touchAction: 'manipulation' }}
          >
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
