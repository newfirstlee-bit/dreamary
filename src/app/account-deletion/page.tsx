'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { apiPostJson } from '@/lib/api';
import { clearUserCache } from '@/lib/appCache';
import { invalidateCharacterStore } from '@/store/useAppStore';
import styles from './page.module.css';
import { Capacitor } from '@capacitor/core';

const TERMS_URL = 'https://pickled-shovel-787.notion.site/3b5278d76e0580768273f5e88a09c3fe';
const PRIVACY_URL = 'https://pickled-shovel-787.notion.site/3b5278d76e0580ba9269f3ed205b37f6';

export default function AccountDeletionPage() {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState('');

  const handleAuthenticate = async (event: FormEvent) => {
    event.preventDefault();
    if (!id.trim() || !password) return;

    setError('');
    setIsAuthenticating(true);
    try {
      await signInWithEmailAndPassword(auth, `${id.trim()}@dreamary.internal`, password);
      setPassword('');
      setShowConfirm(true);
    } catch (authError) {
      console.error('Account deletion authentication failed:', authError);
      setError('아이디 또는 비밀번호를 확인해주세요.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const cancelDeletion = async () => {
    if (isDeleting) return;
    setShowConfirm(false);
    await signOut(auth).catch(() => undefined);
  };

  const confirmDeletion = async () => {
    const user = auth.currentUser;
    if (!user || isDeleting) {
      setError('로그인 확인이 필요합니다. 다시 시도해주세요.');
      setShowConfirm(false);
      return;
    }

    setIsDeleting(true);
    setError('');
    try {
      const token = await user.getIdToken(true);
      await apiPostJson('/api/account/delete', { uid: user.uid }, {
        headers: { Authorization: `Bearer ${token}` },
        readTimeout: 120000,
      });
      clearUserCache(user.uid);
      invalidateCharacterStore(user.uid);
      await signOut(auth).catch(() => undefined);
      setShowConfirm(false);
      setDeleted(true);
    } catch (deleteError: any) {
      console.error('Account deletion failed:', deleteError);
      setError(deleteError?.message || '계정 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      setShowConfirm(false);
      await signOut(auth).catch(() => undefined);
    } finally {
      setIsDeleting(false);
    }
  };

  if (deleted) {
    return (
      <main className={`app-container full-page status-surface-white ${styles.page}`}>
        <section className={styles.success}>
          <div className={styles.successIcon} aria-hidden="true">✓</div>
          <h1>계정 삭제가 완료되었습니다</h1>
          <p>Dreamary 계정과 계정에 연결된 캐릭터 설정, 채팅 및 일기 데이터가 삭제되었습니다.</p>
          <Link className={styles.homeLink} href="/">Dreamary 홈으로</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-container full-page status-surface-white ${styles.page}`}>
      <div className={styles.scrollArea}>
        <p className={styles.brand}>Dreamary · 드리머리</p>
        <h1 className={styles.title}>계정 및 데이터 삭제</h1>
        <p className={styles.description}>
          앱을 삭제한 뒤에도 이 페이지에서 Dreamary 계정 삭제를 요청하고 즉시 완료할 수 있습니다.
          본인 확인을 위해 가입한 아이디와 비밀번호를 입력해주세요.
        </p>

        <section className={styles.notice} aria-labelledby="deletion-scope-title">
          <h2 id="deletion-scope-title" className={styles.noticeTitle}>삭제되는 정보</h2>
          <ul className={styles.noticeList}>
            <li>로그인 계정 및 계정 정보</li>
            <li>생성한 캐릭터와 페어 설정</li>
            <li>채팅 및 교환일기 내용</li>
            <li>계정에 연결된 신고 및 백업 코드 정보</li>
          </ul>
        </section>

        <form className={styles.form} onSubmit={handleAuthenticate}>
          <div className={styles.field}>
            <label htmlFor="account-id">아이디</label>
            <input
              id="account-id"
              autoComplete="username"
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder="Dreamary 아이디"
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="account-password">비밀번호</label>
            <input
              id="account-password"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="비밀번호"
              required
            />
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button
            className={styles.deleteButton}
            type="submit"
            disabled={isAuthenticating || !id.trim() || !password}
          >
            {isAuthenticating ? '본인 확인 중...' : '계정 삭제 계속하기'}
          </button>
        </form>

        <nav className={styles.links} aria-label="관련 문서">
          <a href={TERMS_URL} onClick={(e) => {
            e.preventDefault();
            if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
              import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: TERMS_URL })).catch(() => window.open(TERMS_URL, '_system'));
            } else {
              window.open(TERMS_URL, '_blank', 'noopener,noreferrer');
            }
          }}>서비스 이용약관</a>
          <a href={PRIVACY_URL} onClick={(e) => {
            e.preventDefault();
            if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
              import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: PRIVACY_URL })).catch(() => window.open(PRIVACY_URL, '_system'));
            } else {
              window.open(PRIVACY_URL, '_blank', 'noopener,noreferrer');
            }
          }}>개인정보처리방침</a>
          <a href="mailto:seaweed8927@gmail.com">문의하기</a>
        </nav>
      </div>

      {showConfirm && (
        <>
          <button className={styles.backdrop} aria-label="닫기" onClick={cancelDeletion} />
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <h2 id="delete-title">탈퇴 시 모든 데이터가 삭제돼요</h2>
            <p>모든 대화, 페어 설정이 삭제되며 복구할 수 없습니다.</p>
            <div className={styles.modalButtons}>
              <button className={styles.modalDelete} onClick={confirmDeletion} disabled={isDeleting}>
                {isDeleting ? '처리 중' : '탈퇴'}
              </button>
              <button className={styles.modalCancel} onClick={cancelDeletion} disabled={isDeleting}>
                취소하기
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
