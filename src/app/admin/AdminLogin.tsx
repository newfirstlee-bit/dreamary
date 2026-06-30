"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (res.ok) {
        router.push('/admin');
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error);
      }
    } catch (err) {
      setError('로그인 중 오류가 발생했습니다.');
    }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: '400px', width: '100%', backgroundColor: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '30px', textAlign: 'center', color: 'var(--point-color)' }}>어드민 로그인</h1>
      <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호를 입력하세요"
          style={{ padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)', outline: 'none', fontSize: '1rem' }}
        />
        {error && <p style={{ color: 'red', fontSize: '0.85rem' }}>{error}</p>}
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '15px', borderRadius: '8px', backgroundColor: 'var(--point-color)', color: 'white', border: 'none', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer' }}
        >
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
