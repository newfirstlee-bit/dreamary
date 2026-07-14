"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import Link from 'next/link';
import { Eye, EyeOff, ChevronLeft } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const email = `${id}@dreamary.internal`;
      await signInWithEmailAndPassword(auth, email, password);
      router.push('/mypage');
    } catch (err: any) {
      console.error(err);
      setError(t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--bg-color)' }}>
      <header style={{ marginBottom: '40px', marginTop: '20px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => router.back()} style={{ position: 'absolute', left: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>{t('auth.login')}</h1>
      </header>

      <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>{t('auth.id')}</label>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={t('auth.idPlaceholder')}
            required
            style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>{t('auth.password')}</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholder')}
              required
              style={{ width: '100%', padding: '15px', paddingRight: '45px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', display: 'flex', alignItems: 'center' }}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>

        {error && <div style={{ color: 'red', fontSize: '0.9rem' }}>{error}</div>}

        <button
          type="submit"
          disabled={loading || !id || !password}
          style={{ 
            marginTop: '20px', padding: '16px', borderRadius: '12px', border: 'none', 
            backgroundColor: loading || !id || !password ? 'var(--gray-300)' : 'var(--point-color)', 
            color: 'white', fontSize: '1.1rem', fontWeight: 'bold', cursor: loading || !id || !password ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? t('auth.loggingIn') : t('auth.login')}
        </button>
      </form>

      <div style={{ marginTop: '30px', display: 'flex', justifyContent: 'center', gap: '15px', fontSize: '0.9rem', color: 'var(--gray-600)' }}>
        <Link href="/find-id" style={{ textDecoration: 'none', color: 'inherit' }}>{t('auth.findId')}</Link>
        <span>|</span>
        <Link href="/reset-password" style={{ textDecoration: 'none', color: 'inherit' }}>{t('auth.resetPassword')}</Link>
        <span>|</span>
        <Link href="/register" style={{ textDecoration: 'none', color: 'inherit' }}>{t('auth.register')}</Link>
      </div>
    </div>
  );
}
