import { Capacitor } from '@capacitor/core';
import { logAdDiagnostic } from './adDiagnostics';

const AD_URL = 'https://www.effectivecpmnetwork.com/rk8wuv0t?key=d9c3569d98ad59723168cace64459dd2';
const NATIVE_AD_FALLBACK_MS = 90000;
const AD_PROBE_TIMEOUT_MS = 5000;

export interface AdOpenResult {
  didOpen: boolean;
  status: 'opened' | 'blocked' | 'open_failed';
  message?: string;
}

async function canReachAdNetwork(): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AD_PROBE_TIMEOUT_MS);

  try {
    await fetch(`${AD_URL}&probe=${Date.now()}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch (error) {
    logAdDiagnostic('ad', 'ad_block_suspected', { mode: 'preflight_probe' }, error);
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

async function openWebAdWindow(): Promise<AdOpenResult> {
  const opened = window.open('about:blank', '_blank');
  if (!opened) {
    return {
      didOpen: false,
      status: 'open_failed',
      message: '광고 페이지를 열지 못했어요. 팝업 차단을 해제한 뒤 다시 시도해주세요.',
    };
  }

  try {
    opened.opener = null;
  } catch {
    // Some browsers disallow mutating opener. The important part is that the
    // current Dreamary tab is never navigated away from the writing screen.
  }

  const adReachable = await canReachAdNetwork();
  if (!adReachable) {
    try {
      opened.close();
    } catch {
      // Ignore close failures.
    }
    return {
      didOpen: false,
      status: 'blocked',
      message: '광고 차단 설정이 감지됐어요. 개인 DNS 또는 광고 차단 앱을 해제한 뒤 다시 시도해주세요.',
    };
  }

  if (opened.closed) {
    return {
      didOpen: false,
      status: 'open_failed',
      message: '광고 페이지가 닫혔어요. 다시 시도해주세요.',
    };
  }

  opened.location.replace(AD_URL);
  return { didOpen: true, status: 'opened' };
}

export const showAd = async (onComplete: (result: AdOpenResult) => void) => {
  let completed = false;
  const completeOnce = (result: AdOpenResult) => {
    if (completed) return;
    completed = true;
    onComplete(result);
  };

  try {
    if (Capacitor.isNativePlatform()) {
      const adReachable = await canReachAdNetwork();
      if (!adReachable) {
        completeOnce({
          didOpen: false,
          status: 'blocked',
          message: '광고 차단 설정이 감지됐어요. 개인 DNS 또는 광고 차단 앱을 해제한 뒤 다시 시도해주세요.',
        });
        return;
      }

      const { Browser } = await import('@capacitor/browser');
      const { App } = await import('@capacitor/app');
      let didOpen = false;
      let leftApp = false;
      logAdDiagnostic('ad', 'ad_open_started', { mode: 'native_browser' });
      await new Promise<void>(async (resolve) => {
        let settled = false;
        const removers: Array<() => void> = [];
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          removers.forEach(remove => remove());
          resolve();
        };
        const timer = window.setTimeout(finish, NATIVE_AD_FALLBACK_MS);

        try {
          const browserHandle = await Browser.addListener('browserFinished', finish);
          removers.push(() => browserHandle.remove());
        } catch {
          // App lifecycle listener below still detects returning from a Custom Tab.
        }

        try {
          const appHandle = await App.addListener('appStateChange', ({ isActive }) => {
            if (!isActive) {
              leftApp = true;
              return;
            }
            if (leftApp) finish();
          });
          removers.push(() => appHandle.remove());
        } catch {
          // browserFinished and the bounded fallback remain available.
        }

        try {
          await Browser.open({
            url: AD_URL,
            presentationStyle: 'fullscreen',
            toolbarColor: '#FFFFFF',
          });
          didOpen = true;
          logAdDiagnostic('ad', 'ad_open_succeeded', { mode: 'native_browser' });
        } catch (error) {
          logAdDiagnostic('ad', 'ad_open_failed', { mode: 'native_browser' }, error);
          finish();
        }
      });
      completeOnce(didOpen
        ? { didOpen: true, status: 'opened' }
        : { didOpen: false, status: 'open_failed', message: '광고 페이지를 열지 못했어요. 잠시 후 다시 시도해주세요.' }
      );
      return;
    }

    logAdDiagnostic('ad', 'ad_open_started', { mode: 'web_window' });
    const webResult = await openWebAdWindow();
    logAdDiagnostic('ad', webResult.didOpen ? 'ad_open_succeeded' : 'ad_open_failed', { mode: 'web_window', status: webResult.status });
    completeOnce(webResult);
  } catch (error) {
    logAdDiagnostic('ad', 'ad_open_failed', { mode: 'primary' }, error);
    completeOnce({
      didOpen: false,
      status: 'open_failed',
      message: '광고 페이지를 열지 못했어요. 잠시 후 다시 시도해주세요.',
    });
  }
};
