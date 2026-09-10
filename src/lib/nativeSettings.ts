import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeSettingsPlugin {
  openAppNotificationSettings(): Promise<{ opened: boolean }>;
  getNotificationStatus(): Promise<{
    supported?: boolean;
    enabled: boolean;
    authorizationStatus?: string;
  }>;
}

const NativeSettings = registerPlugin<NativeSettingsPlugin>('NativeSettings');

export async function openAppNotificationSettings() {
  if (!Capacitor.isNativePlatform()) return false;

  if (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios') {
    try {
      await NativeSettings.openAppNotificationSettings();
    } catch (error) {
      if (Capacitor.getPlatform() === 'ios' && typeof window !== 'undefined') {
        window.location.href = 'app-settings:';
        return true;
      }
      throw error;
    }
    return true;
  }

  return false;
}

export async function getNativeNotificationStatus() {
  if (!Capacitor.isNativePlatform()) {
    return { supported: false, enabled: false, authorizationStatus: 'web' };
  }

  try {
    const status = await NativeSettings.getNotificationStatus();
    return {
      supported: status.supported !== false,
      enabled: Boolean(status.enabled),
      authorizationStatus: status.authorizationStatus || 'unknown',
    };
  } catch {
    return { supported: false, enabled: false, authorizationStatus: 'unknown' };
  }
}
