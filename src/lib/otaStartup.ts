export interface OtaStartupBridge {
  ready(): Promise<{ currentBundleId: string | null; previousBundleId: string | null; rollback: boolean }>;
}

// Capacitor plugins are proxies: returning one from an async function makes
// Promise resolution call the nonexistent native `then` method.
export function otaStartupBridge(plugin: OtaStartupBridge): OtaStartupBridge {
  return { ready: () => plugin.ready() };
}

export type OtaStartupResult = 'web' | 'unavailable' | 'ready' | 'rolled-back' | 'failed';

// Confirm only after the first client render. Network/auth availability is not
// app health: an offline app must still show its local screen and saved drafts.
// Deliberately no reload, reset, channel change, download or cloud request here.
export function createOtaStartup(
  isNative: () => boolean,
  loadBridge: () => Promise<OtaStartupBridge | null>,
  afterPaint: () => Promise<void>,
  report: (result: OtaStartupResult) => void,
) {
  let started: Promise<OtaStartupResult> | undefined;
  return (): Promise<OtaStartupResult> => {
    if (!isNative()) return Promise.resolve('web');
    if (started) return started;
    started = (async () => {
      try {
        await afterPaint();
        const bridge = await loadBridge();
        if (!bridge) return 'unavailable' as const;
        const result = await bridge.ready();
        const status = result.rollback ? 'rolled-back' : 'ready';
        report(status);
        return status;
      } catch {
        report('failed');
        return 'failed' as const;
      }
    })();
    return started;
  };
}
