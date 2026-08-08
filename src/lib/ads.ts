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

function openWithWindowFallback(): boolean {
  const opened = window.open(AD_URL, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.href = AD_URL;
    return true;
  }
  return true;
}

export const showAd = async (onComplete: (result: AdOpenResult) => void) => {
  let completed = false;
  const completeOnce = (result: AdOpenResult) => {
    if (completed) return;
    completed = true;
    onComplete(result);
  };

  try {
    const adReachable = await canReachAdNetwork();
    if (!adReachable) {
      completeOnce({
        didOpen: false,
        status: 'blocked',
        message: '광고 차단 설정이 감지됐어요. 개인 DNS 또는 광고 차단 앱을 해제한 뒤 다시 시도해주세요.',
      });
      return;
    }

    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import('@capacitor/browser');
      let didOpen = false;
      logAdDiagnostic('ad', 'ad_open_started', { mode: 'native_browser' });
      const removeFinishedListener = await new Promise<(() => void) | undefined>((resolve) => {
        let cleanup: (() => void) | undefined;
        const timer = window.setTimeout(resolve, NATIVE_AD_FALLBACK_MS);
        Browser.addListener('browserFinished', () => {
          window.clearTimeout(timer);
          resolve(cleanup);
        })
          .then(handle => {
            cleanup = () => handle.remove();
          })
          .catch(() => {
            window.clearTimeout(timer);
            resolve(cleanup);
          });

        Browser.open({
          url: AD_URL,
          presentationStyle: 'fullscreen',
          toolbarColor: '#FFFFFF',
        }).then(() => {
          didOpen = true;
          logAdDiagnostic('ad', 'ad_open_succeeded', { mode: 'native_browser' });
        }).catch(error => {
          logAdDiagnostic('ad', 'ad_open_failed', { mode: 'native_browser' }, error);
          window.clearTimeout(timer);
          resolve(cleanup);
        });
      });
      removeFinishedListener?.();
      completeOnce(didOpen
        ? { didOpen: true, status: 'opened' }
        : { didOpen: false, status: 'open_failed', message: '광고 페이지를 열지 못했어요. 잠시 후 다시 시도해주세요.' }
      );
      return;
    }

    logAdDiagnostic('ad', 'ad_open_started', { mode: 'web_window' });
    const didOpen = openWithWindowFallback();
    logAdDiagnostic('ad', didOpen ? 'ad_open_succeeded' : 'ad_open_failed', { mode: 'web_window' });
    completeOnce(didOpen
      ? { didOpen: true, status: 'opened' }
      : { didOpen: false, status: 'open_failed', message: '광고 페이지를 열지 못했어요. 잠시 후 다시 시도해주세요.' }
    );
  } catch (error) {
    logAdDiagnostic('ad', 'ad_open_failed', { mode: 'primary' }, error);
    try {
      const didOpen = openWithWindowFallback();
      logAdDiagnostic('ad', didOpen ? 'ad_open_succeeded' : 'ad_open_failed', { mode: 'web_fallback' });
      completeOnce(didOpen
        ? { didOpen: true, status: 'opened' }
        : { didOpen: false, status: 'open_failed', message: '광고 페이지를 열지 못했어요. 잠시 후 다시 시도해주세요.' }
      );
    } catch (fallbackError) {
      logAdDiagnostic('ad', 'ad_open_failed', { mode: 'web_fallback' }, fallbackError);
      completeOnce({
        didOpen: false,
        status: 'open_failed',
        message: '광고 페이지를 열지 못했어요. 잠시 후 다시 시도해주세요.',
      });
    }
  }
};
