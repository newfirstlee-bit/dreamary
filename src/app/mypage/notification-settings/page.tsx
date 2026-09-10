"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { useLocale } from '@/lib/i18n';
import {
  checkDiaryPushPermission,
  disableDiaryPush,
  fetchDiaryPushStatus,
  isDiaryPushLocallyEnabled,
  markDiaryPushLocallyEnabled,
  registerDiaryPush,
  requestDiaryPushPermission,
  savePendingDiaryPushOptIn,
} from '@/lib/diaryPush';
import { useUserId } from '@/hooks/useUserId';
import { openAppNotificationSettings } from '@/lib/nativeSettings';
import { Capacitor } from '@capacitor/core';

export default function NotificationSettingsPage() {
  const router = useRouter();
  const { t, locale } = useLocale();
  const { user, status, loading: authLoading } = useAuth();
  const userId = useUserId();
  const [isNativeApp, setIsNativeApp] = useState<boolean | null>(null);
  const ownerId = user?.uid || userId || '';
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [awaitingNotificationSettings, setAwaitingNotificationSettings] = useState(false);
  const [deviceNotificationsOff, setDeviceNotificationsOff] = useState(false);

  const shouldShowDeviceNotificationGuide = (permission: Awaited<ReturnType<typeof checkDiaryPushPermission>>) => {
    return permission.supported && permission.receive !== 'granted';
  };

  const refreshDevicePermission = async () => {
    const permission = await checkDiaryPushPermission();
    const isOff = shouldShowDeviceNotificationGuide(permission);
    setDeviceNotificationsOff(isOff);
    return permission;
  };

  useEffect(() => {
    setIsNativeApp(process.env.NEXT_PUBLIC_BUILD_TARGET === 'app' && Capacitor.isNativePlatform());
  }, []);

  useEffect(() => {
    if (isNativeApp === null) return;

    if (!isNativeApp) {
      router.replace('/mypage');
      return;
    }

    let cancelled = false;

    const loadStatus = async () => {
      if (authLoading) return;
      setMessage('');

      const cachedEnabled = ownerId ? isDiaryPushLocallyEnabled(ownerId) : false;
      setEnabled(cachedEnabled);
      setLoading(false);

      const permissionPromise = checkDiaryPushPermission();
      const remoteStatusPromise = user ? fetchDiaryPushStatus(user) : Promise.resolve(null);

      const permission = await permissionPromise;
      if (!cancelled) {
        setDeviceNotificationsOff(shouldShowDeviceNotificationGuide(permission));
      }

      const remoteStatus = await remoteStatusPromise;
      if (user && remoteStatus) {
        if (cancelled) return;
        setEnabled(remoteStatus.enabled);
        markDiaryPushLocallyEnabled(user.uid, remoteStatus.enabled);
      }
    };

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isNativeApp, ownerId, router, user]);

  useEffect(() => {
    if (!isNativeApp) return;

    let cancelled = false;
    let removeListener: (() => void) | undefined;

    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', async ({ isActive }) => {
        if (!isActive || cancelled) return;
        window.setTimeout(() => {
          if (!cancelled) refreshDevicePermission();
        }, 300);
      }).then(handle => {
        removeListener = () => handle.remove();
      });
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [isNativeApp]);

  const enableDiaryPush = async () => {
    if (!user) return;

    const result = await registerDiaryPush({
      user,
      ownerId: user.uid,
      locale,
    });

    if (result.ok) {
      setAwaitingNotificationSettings(false);
      setEnabled(true);
    } else if (result.reason === 'permission_denied') {
      setMessage(t('push.diary.permissionDesc'));
    } else {
      setMessage(t('push.diary.errorDesc'));
    }
  };

  const ensureDevicePermission = async () => {
    const permission = await refreshDevicePermission();
    if (!permission.supported) return false;
    if (permission.receive === 'granted') return true;

    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      const requested = await requestDiaryPushPermission();
      return requested.receive === 'granted';
    }

    setAwaitingNotificationSettings(true);
    setDeviceNotificationsOff(true);
    await openAppNotificationSettings().catch(() => undefined);
    return false;
  };

  const handleDeviceNotificationSettings = async () => {
    setMessage('');
    const permission = await refreshDevicePermission();
    if (!permission.supported) return;

    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      const requested = await requestDiaryPushPermission();
      setDeviceNotificationsOff(shouldShowDeviceNotificationGuide(requested));
      return;
    }

    if (permission.receive === 'granted') {
      setDeviceNotificationsOff(false);
      return;
    }

    setAwaitingNotificationSettings(true);
    await openAppNotificationSettings().catch(() => undefined);
  };

  useEffect(() => {
    if (!awaitingNotificationSettings || !user) return;

    let cancelled = false;
    let removeListener: (() => void) | undefined;

    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', async ({ isActive }) => {
        if (!isActive || cancelled) return;
        window.setTimeout(async () => {
          if (cancelled) return;
          const permission = await checkDiaryPushPermission();
          if (permission.receive === 'granted') {
            setDeviceNotificationsOff(false);
            setSaving(true);
            await enableDiaryPush();
            setSaving(false);
          } else {
            setDeviceNotificationsOff(shouldShowDeviceNotificationGuide(permission));
          }
        }, 300);
      }).then(handle => {
        removeListener = () => handle.remove();
      });
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [awaitingNotificationSettings, locale, t, user]);

  const toggleDiaryPush = async () => {
    if (!isNativeApp) return;
    if (saving || loading) return;
    setMessage('');

    if (!enabled && status !== 'authenticated') {
      savePendingDiaryPushOptIn();
      setMessage(t('push.settings.loginRequired'));
      window.setTimeout(() => router.push('/login?resumeDiaryPush=1'), 500);
      return;
    }

    if (!user) return;

    setSaving(true);
    try {
      if (enabled) {
        await disableDiaryPush({ user, ownerId: user.uid });
        setEnabled(false);
        return;
      }

      const hasDevicePermission = await ensureDevicePermission();
      if (hasDevicePermission) {
        await enableDiaryPush();
      }
    } catch (error) {
      console.error(error);
      setMessage(t('push.diary.errorDesc'));
    } finally {
      setSaving(false);
    }
  };

  if (!isNativeApp) return null;

  return (
    <div className="app-container full-page status-surface-white" style={{ backgroundColor: 'var(--gray-50)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          height: '52px',
          minHeight: '52px',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          backgroundColor: 'white',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          style={{ position: 'absolute', left: '12px', border: 'none', background: 'none', padding: '8px', display: 'flex', alignItems: 'center', color: 'var(--gray-800)', cursor: 'pointer' }}
          aria-label={t('common.cancel')}
        >
          <ChevronLeft size={26} />
        </button>
        <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--gray-900)' }}>
          {t('mypage.notificationSettings')}
        </h1>
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: '20px', paddingBottom: 'calc(24px + var(--safe-bottom))' }}>
        <section
          style={{
            padding: '16px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--gray-900)', fontWeight: 800 }}>
            {t('push.settings.diaryTitle')}
          </h2>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={loading || saving}
            onClick={toggleDiaryPush}
            style={{
              width: '54px',
              height: '32px',
              borderRadius: '999px',
              border: 'none',
              padding: '3px',
              backgroundColor: enabled ? 'var(--point-color)' : 'var(--gray-300)',
              cursor: loading || saving ? 'not-allowed' : 'pointer',
              flexShrink: 0,
              transition: 'background-color 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: enabled ? 'flex-end' : 'flex-start',
            }}
          >
            <span
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                backgroundColor: 'white',
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                transition: 'transform 0.2s',
              }}
            >
              {(loading || saving) && <Loader2 size={14} color="var(--point-color)" style={{ animation: 'spin 1s linear infinite' }} />}
            </span>
          </button>
        </section>

        {deviceNotificationsOff && (
          <section style={{ marginTop: '8px', padding: '14px 0' }}>
            <p style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.55, color: 'var(--gray-600)' }}>
              {t('push.settings.deviceOffGuide')}
            </p>
            <button
              type="button"
              onClick={handleDeviceNotificationSettings}
              style={{
                marginTop: '12px',
                width: '100%',
                border: 'none',
                borderRadius: '14px',
                padding: '14px',
                backgroundColor: 'var(--point-color)',
                color: '#fff',
                fontSize: '0.95rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t('push.settings.openDeviceSettings')}
            </button>
          </section>
        )}

        {message && (
          <div style={{ marginTop: '16px', padding: '13px 14px', borderRadius: '12px', backgroundColor: '#F5F0FF', color: 'var(--gray-800)', fontSize: '0.86rem', lineHeight: 1.45 }}>
            {message}
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: '@keyframes spin { 100% { transform: rotate(360deg); } }' }} />
    </div>
  );
}
