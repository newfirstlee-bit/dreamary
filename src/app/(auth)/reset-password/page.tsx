"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [id, setId] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setSuccess(false);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, email })
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error?.startsWith('auth.') ? t(data.error) : (data.error || t('auth.resetFailed')));
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
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
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>{t('auth.resetPassword')}</h1>
      </header>

      {!success ? (
        <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>{t('auth.id')}</label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={t('auth.resetPasswordIdHint')}
              required
              style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>{t('auth.findIdEmailLabel')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.findIdEmailHint')}
              required
              style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none' }}
            />
          </div>

          {error && <div style={{ color: 'red', fontSize: '0.9rem' }}>{error}</div>}

          <button
            type="submit"
            disabled={loading || !id || !email}
            style={{ 
              marginTop: '10px', padding: '16px', borderRadius: '12px', border: 'none', 
              backgroundColor: loading || !id || !email ? 'var(--gray-300)' : 'var(--point-color)', 
              color: 'white', fontSize: '1.1rem', fontWeight: 'bold', cursor: loading || !id || !email ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? t('auth.sending') : t('auth.issueTempPassword')}
          </button>
        </form>
      ) : (
        <div style={{ textAlign: 'center', marginTop: '40px' }}>
          <div style={{ fontSize: '3rem', marginBottom: '20px' }}>🔑</div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 'bold', marginBottom: '10px' }}>{t('auth.tempPasswordIssued')}</h2>
          <p style={{ color: 'var(--gray-600)', marginBottom: '30px', lineHeight: '1.5' }} dangerouslySetInnerHTML={{ __html: t('auth.tempPasswordDesc') }} />
          <button
            onClick={() => router.push('/login')}
            style={{ 
              width: '100%', padding: '16px', borderRadius: '12px', border: 'none', 
              backgroundColor: 'var(--point-color)', color: 'white', fontSize: '1.1rem', fontWeight: 'bold', cursor: 'pointer'
            }}
          >
            {t('auth.goToLogin')}
          </button>
        </div>
      )}
    </div>
  );
}
