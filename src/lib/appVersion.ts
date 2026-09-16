export interface OtaRelease { appVersion: string; revision: number; bundleId: string }

export function appliedVersion(base: string, activeBundleId: string | null, release: unknown): string {
  const metadata = release as Partial<OtaRelease> | null;
  return activeBundleId && metadata?.bundleId === activeBundleId && metadata.appVersion === base &&
    Number.isSafeInteger(metadata.revision) && Number(metadata.revision) > 0
    ? `${base}(${metadata.revision})` : base;
}

export async function readAppliedAppVersion(base: string): Promise<string> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return base;
    const { App } = await import('@capacitor/app');
    base = (await App.getInfo()).version;
    if (!Capacitor.isPluginAvailable('LiveUpdate')) return base;
    const { LiveUpdate } = await import('@capawesome/capacitor-live-update');
    const current = await LiveUpdate.getCurrentBundle();
    if (!current.bundleId) return base;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch('/ota-release.json', { cache: 'no-store', signal: controller.signal });
      return response.ok ? appliedVersion(base, current.bundleId, await response.json()) : base;
    } finally { clearTimeout(timer); }
  } catch { return base; }
}
