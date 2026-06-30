"use client";

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export default function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    if (!confirm('로그아웃 하시겠습니까?')) return;
    
    await fetch('/api/admin/logout', { method: 'POST' });
    router.refresh(); // Refresh layout to check cookie again
  };

  return (
    <button
      onClick={handleLogout}
      style={{
        marginTop: 'auto',
        padding: '12px',
        borderRadius: '8px',
        backgroundColor: '#fff',
        color: 'var(--gray-600)',
        border: '1px solid var(--gray-300)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        fontWeight: 'bold',
        transition: 'background-color 0.2s',
      }}
    >
      <LogOut size={18} />
      <span>로그아웃</span>
    </button>
  );
}
