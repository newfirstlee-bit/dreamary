"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookOpen, MessageCircle, User } from 'lucide-react';

export default function BottomNav() {
  const pathname = usePathname();
  
  // Hide bottom nav on onboarding and specific pages
  if (pathname === '/onboarding' || pathname.startsWith('/mypage/edit-pairname') || pathname.startsWith('/home-settings') || pathname.startsWith('/chat/') || pathname.startsWith('/admin') || pathname.startsWith('/mypage/edit-character') || pathname.startsWith('/mypage/edit-user')) return null;

  const navItems = [
    { name: '홈', path: '/', icon: Home },
    { name: '일기', path: '/diary', icon: BookOpen },
    { name: '채팅', path: '/chat', icon: MessageCircle },
    { name: '마이페이지', path: '/mypage', icon: User },
  ];

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: '480px',
      height: '65px',
      backgroundColor: 'rgba(255, 255, 255, 0.75)',
      backdropFilter: 'blur(15px)',
      borderTop: '1px solid rgba(255, 255, 255, 0.4)',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      zIndex: 1000,
      boxShadow: '0 -2px 10px rgba(0,0,0,0.02)'
    }}>
      {navItems.map((item) => {
        const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
        const color = isActive ? 'var(--point-color)' : 'var(--text-muted)';
        const Icon = item.icon;
        
        return (
          <Link key={item.path} href={item.path} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color, width: '25%' }}>
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
