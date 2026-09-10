"use client";

import { Bell, BookOpen, Loader2, StickyNote } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/lib/i18n';

export type DiaryPushSheetMode = 'offer' | 'login' | 'permissionDenied' | 'enabled' | 'error';

interface DiaryPushOptInSheetProps {
  isOpen: boolean;
  mode: DiaryPushSheetMode;
  loading?: boolean;
  onClose: () => void;
  onPrimary: () => void;
}

export default function DiaryPushOptInSheet({
  isOpen,
  mode,
  loading = false,
  onClose,
  onPrimary,
}: DiaryPushOptInSheetProps) {
  const { t } = useLocale();
  if (!isOpen || typeof document === 'undefined') return null;

  const copy = {
    offer: {
      title: t('push.diary.title'),
      desc: t('push.diary.desc'),
      primary: t('push.diary.primary'),
      secondary: t('common.cancel'),
      icon: <Bell size={30} color="var(--point-color)" />,
    },
    login: {
      title: t('push.diary.loginTitle'),
      desc: t('push.diary.loginDesc'),
      primary: t('push.diary.loginPrimary'),
      secondary: t('common.later'),
      icon: <BookOpen size={30} color="var(--point-color)" />,
    },
    permissionDenied: {
      title: t('push.diary.permissionTitle'),
      desc: t('push.diary.permissionDesc'),
      primary: t('push.diary.settingsPrimary'),
      secondary: t('common.cancel'),
      icon: <Bell size={30} color="var(--point-color)" />,
    },
    enabled: {
      title: t('push.diary.enabledTitle'),
      desc: t('push.diary.enabledDesc'),
      primary: t('common.confirm'),
      secondary: t('common.cancel'),
      icon: <Bell size={30} color="var(--point-color)" />,
    },
    error: {
      title: t('push.diary.errorTitle'),
      desc: t('push.diary.errorDesc'),
      primary: t('common.confirm'),
      secondary: t('common.cancel'),
      icon: <Bell size={30} color="var(--point-color)" />,
    },
  }[mode];

  const isTerminal = mode === 'enabled' || mode === 'permissionDenied' || mode === 'error';
  const illustration = (
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '22px' }}>
      <div
        style={{
          width: '112px',
          height: '92px',
          borderRadius: '28px',
          background: 'linear-gradient(135deg, #F5F0FF 0%, #FFFFFF 100%)',
          border: '1px solid #E8DFFF',
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
        }}
      >
        <div style={{ position: 'absolute', left: '20px', top: '18px', transform: 'rotate(-8deg)' }}>
          <StickyNote size={38} color="#B69CFF" />
        </div>
        <div style={{ position: 'absolute', right: '20px', bottom: '18px', transform: 'rotate(7deg)' }}>
          {copy.icon}
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div
      className="global-overlay diary-push-opt-in-overlay"
      role="dialog"
      aria-modal="true"
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.35)',
      }}
      onClick={loading ? undefined : onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          maxHeight: 'calc(var(--app-viewport-height, 100vh) - var(--safe-top) - 24px)',
          overflowY: 'auto',
          backgroundColor: '#fff',
          borderTopLeftRadius: '24px',
          borderTopRightRadius: '24px',
          padding: '22px 20px calc(var(--safe-bottom) + 18px)',
          boxShadow: '0 -8px 30px rgba(0,0,0,0.12)',
        }}
        onClick={event => event.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 8px', textAlign: 'center', fontSize: '1.25rem', lineHeight: 1.35, color: 'var(--gray-900)' }}>
          {copy.title}
        </h2>
        <p style={{ margin: '0 0 16px', textAlign: 'center', fontSize: '0.95rem', lineHeight: 1.5, color: 'var(--gray-600)' }}>
          {copy.desc}
        </p>
        {illustration}

        {isTerminal ? (
          <button
            type="button"
            onClick={onPrimary}
            style={{
              width: '100%',
              border: 'none',
              borderRadius: '14px',
              padding: '15px',
              backgroundColor: 'var(--point-color)',
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {copy.primary}
          </button>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 7fr', gap: '10px' }}>
            <button
              type="button"
              onClick={loading ? undefined : onClose}
              disabled={loading}
              style={{
                border: 'none',
                borderRadius: '14px',
                padding: '15px 8px',
                backgroundColor: 'var(--gray-100)',
                color: 'var(--gray-700)',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {copy.secondary}
            </button>
            <button
              type="button"
              onClick={loading ? undefined : onPrimary}
              disabled={loading}
              style={{
                border: 'none',
                borderRadius: '14px',
                padding: '15px 8px',
                backgroundColor: loading ? '#6F37F5' : 'var(--point-color)',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {loading ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> : copy.primary}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
