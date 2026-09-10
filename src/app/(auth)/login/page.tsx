"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import Link from 'next/link';
import { Eye, EyeOff, ChevronLeft } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { trackEvent } from '@/lib/mixpanel';
import { completeOwnershipMigration, prepareOwnershipMigration } from '@/lib/db';
import { getStoredGuestUserId } from '@/lib/auth';
import { clearUserCache } from '@/lib/appCache';
import { copyRecentCharacterOrder } from '@/lib/characterOrder';
import { doc, setDoc } from '@/lib/dataFirestore';
import { invalidateCharacterStore } from '@/store/useAppStore';
import { getPendingDiaryPushOptIn } from '@/lib/diaryPush';
import { useAuth } from '@/components/AuthContext';
import { loginFailureKind, type LoginStage } from '@/lib/loginFailure';

export default function LoginPage() {
  const router = useRouter();
  const { syncAuthUser } = useAuth();
  const { t, locale } = useLocale();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    let stage: LoginStage = 'credentials';

    try {
      const email = `${id}@dreamary.internal`;
      const guestUserId = getStoredGuestUserId();

      // 로그인을 먼저 수행하여 UI 응답성 확보
      const credential = await signInWithEmailAndPassword(auth, email, password);
      stage = 'account-sync';
      // Firebase SDK 상태와 React 인증 상태를 라우팅 전에 동일하게 맞춘다.
      // WKWebView에서는 onAuthStateChanged 반영이 다음 화면보다 늦을 수 있다.
      syncAuthUser(credential.user);

      // 로그인 즉시 계정 문서 업데이트 및 캐시 초기화
      await setDoc(doc(db, 'accounts', credential.user.uid), { id, updatedAt: Date.now() }, { merge: true });
      if (guestUserId) clearUserCache(guestUserId);
      clearUserCache(credential.user.uid);
      invalidateCharacterStore();
      trackEvent('Login_Success');

      // 라우팅을 먼저 수행 (UI 즉시 전환)
      const pendingDiaryPush = getPendingDiaryPushOptIn();
      if (pendingDiaryPush) {
        const params = new URLSearchParams({ resumePushOptIn: 'true' });
        if (pendingDiaryPush.characterId) params.set('charId', pendingDiaryPush.characterId);
        router.push(`/diary?${params.toString()}`);
      } else {
        router.push('/mypage');
      }

      // Migration은 백그라운드에서 non-blocking 처리
      if (guestUserId && guestUserId !== credential.user.uid) {
        prepareOwnershipMigration(guestUserId)
          .then(migration => completeOwnershipMigration(migration, credential.user.uid))
          .then(() => {
            copyRecentCharacterOrder(guestUserId, credential.user.uid);
            clearUserCache(credential.user.uid);
            invalidateCharacterStore();
          })
          .catch(err => console.warn('Background ownership migration failed:', err));
      }
    } catch (err: any) {
      const kind = loginFailureKind(err, stage);
      console.error('[login] failure', { stage, kind });
      if (kind === 'network') {
        setError(locale === 'ja' ? 'ネットワーク接続を確認してからもう一度お試しください。' : '네트워크 연결을 확인한 뒤 다시 시도해주세요.');
      } else if (kind === 'rate-limit') {
        setError(locale === 'ja' ? '試行回数が多すぎます。しばらく待ってからお試しください。' : '시도 횟수가 너무 많습니다. 잠시 후 다시 시도해주세요.');
      } else if (kind === 'credentials') {
        setError(t('auth.loginFailed'));
      } else if (kind === 'account-sync') {
        setError(locale === 'ja' ? 'ログイン認証は完了しましたが、アカウント情報を読み込めませんでした。しばらくしてからもう一度お試しください。' : '로그인 인증은 완료됐지만 계정 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
      } else {
        setError(locale === 'ja' ? 'ログインサービスに接続できませんでした。しばらくしてからもう一度お試しください。' : '로그인 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container full-page auth-page" style={{ backgroundColor: 'var(--bg-color)' }}>
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
            onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
            placeholder={t('auth.idPlaceholder')}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', textTransform: 'lowercase' }}
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
