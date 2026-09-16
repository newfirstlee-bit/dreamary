import { Capacitor } from '@capacitor/core';
import { createOtaStartup, otaStartupBridge } from './otaStartup';
import otaConfig from '../../ota.config.json';
import { checkOtaDelivery, verifyOtaManifest, type OtaDescriptor } from './otaDelivery';

const startup = createOtaStartup(
  () => Capacitor.isNativePlatform(),
  async () => {
    if (!Capacitor.isPluginAvailable('LiveUpdate')) return null;
    const { LiveUpdate } = await import('@capawesome/capacitor-live-update');
    return otaStartupBridge(LiveUpdate);
  },
  () => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }),
  // No user IDs, tokens, download URLs or SDK error bodies in diagnostics.
  status => console.info(JSON.stringify({ event: 'ota_startup', status })),
);

async function readJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
    if (response.status === 404) return null;
    if (!response.ok || !response.body) throw new Error('OTA unavailable');
    const reader = response.body.getReader();
    let content = '', length = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 24000) { await reader.cancel(); throw new Error('OTA response too large'); }
      content += decoder.decode(value, { stream: true });
    }
    return JSON.parse(content + decoder.decode());
  } finally { clearTimeout(timer); }
}

let delivery: Promise<void> | undefined;
export function initializeOta(): Promise<void> {
  if (delivery) return delivery;
  delivery = (async () => {
    const status = await startup();
    if (status !== 'ready' && status !== 'rolled-back') return;
    try {
      const descriptor = await readJson('/ota-build.json') as OtaDescriptor | null;
      if (!descriptor || !['branch', 'release'].includes(descriptor.target)) return;
      const config = otaConfig[descriptor.target];
      if (!config.enabled) return;
      const [{ LiveUpdate }, { Preferences }, { App }] = await Promise.all([
        import('@capawesome/capacitor-live-update'), import('@capacitor/preferences'), import('@capacitor/app'),
      ]);
      if ((await App.getInfo()).version !== descriptor.appVersion) return;
      const result = await checkOtaDelivery({
        descriptor, origin: config.origin, bridge: LiveUpdate,
        read: async key => (await Preferences.get({ key })).value,
        write: (key, value) => Preferences.set({ key, value }),
        fetchManifest: async () => {
          const envelope = await readJson(config.origin + '/channels/' + descriptor.target + '/' + descriptor.nativeHash + '/latest.json');
          return envelope ? verifyOtaManifest(envelope, config.publicKey, descriptor, Date.now()) : null;
        },
      });
      console.info(JSON.stringify({ event: 'ota_delivery', status: result }));
    } catch {
      // Update/network failure must not block the app or expose SDK requests.
      console.info(JSON.stringify({ event: 'ota_delivery', status: 'failed' }));
    }
  })();
  return delivery;
}
