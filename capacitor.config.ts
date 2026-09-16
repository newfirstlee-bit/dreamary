import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';
import type {} from '@capawesome/capacitor-live-update';
import { nativeOtaConfig } from './scripts/ota-native-config.cjs';

const config: CapacitorConfig = {
  appId: 'com.dreamary.app',
  appName: '드림어리',
  webDir: 'out',
  plugins: {
    LiveUpdate: {
      ...nativeOtaConfig(process.cwd()),
      // Self-hosted checks run after ready(); no paid cloud auto-update calls.
      autoUpdateStrategy: 'none',
      readyTimeout: 15000,
      autoBlockRolledBackBundles: true,
      autoDeleteBundles: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    SplashScreen: {
      launchAutoHide: true,
      androidScaleType: "CENTER_CROP",
    },
    SystemBars: {
      // Android 15+ edge-to-edge: expose the real system bar insets to CSS.
      insetsHandling: "css",
    },
    CapacitorHttp: {
      // Do not globally patch fetch/XHR. Firestore WebChannel uses streaming
      // responses that CapacitorHttp buffers, which leaves writes uncommitted.
      enabled: false,
    },
    Keyboard: {
      resize: KeyboardResize.None,
      resizeOnFullScreen: true,
    }
  },
  server: {
    iosScheme: 'https',
    androidScheme: 'https'
  }
};

export default config;
