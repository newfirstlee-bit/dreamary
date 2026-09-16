export interface OtaDescriptor {
  schema: number; target: 'branch' | 'release'; appVersion: string;
  firebaseProjectId: string; apiUrl: string; nativeHash: string;
}
export interface OtaManifest extends OtaDescriptor {
  sequence: number; issuedAt: number; expiresAt: number; action: 'update' | 'pause' | 'reset';
  bundleId?: string; checksum?: string; signature?: string; bytes?: number;
}
export interface OtaDeliveryBridge {
  getChannel(): Promise<{ channel: string | null }>;
  getCurrentBundle(): Promise<{ bundleId: string | null }>;
  getBlockedBundles(): Promise<{ bundleIds: string[] }>;
  getDownloadedBundles(): Promise<{ bundleIds: string[] }>;
  downloadBundle(options: { bundleId: string; url: string; checksum: string; signature: string; artifactType: 'zip' }): Promise<void>;
  setNextBundle(options: { bundleId: string | null }): Promise<void>;
}
const base64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

// Verify the envelope before interpreting environment, command or bundle fields.
export async function verifyOtaManifest(envelope: unknown, publicKey: string, descriptor: OtaDescriptor, now: number): Promise<OtaManifest> {
  if (!envelope || typeof envelope !== 'object') throw new Error('Invalid envelope');
  const { payload, signature } = envelope as Record<string, unknown>;
  if (typeof payload !== 'string' || payload.length > 16000 || typeof signature !== 'string' || signature.length > 1024) throw new Error('Invalid envelope');
  const key = await crypto.subtle.importKey('spki', base64(publicKey.replace(/-----[^-]+-----|\s/g, '')).buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const bytes = base64(payload);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64(signature).buffer, bytes.buffer)) throw new Error('Invalid signature');
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as OtaManifest;
  for (const key of ['schema', 'target', 'appVersion', 'firebaseProjectId', 'apiUrl', 'nativeHash'] as const) {
    if (manifest[key] === undefined || manifest[key] !== descriptor[key]) throw new Error('Incompatible update');
  }
  if (manifest.schema !== 1 || !Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1 ||
      !Number.isFinite(manifest.issuedAt) || !Number.isFinite(manifest.expiresAt) ||
      manifest.issuedAt > now + 300000 || manifest.expiresAt <= now || manifest.expiresAt <= manifest.issuedAt ||
      manifest.expiresAt - manifest.issuedAt > 31 * 86400000) throw new Error('Expired or invalid update');
  if (!['update', 'pause', 'reset'].includes(manifest.action)) throw new Error('Invalid action');
  if (manifest.action === 'update' && (!/^[a-f0-9-]{36}$/.test(manifest.bundleId || '') ||
      !/^[a-f0-9]{64}$/.test(manifest.checksum || '') || !/^[A-Za-z0-9+/]{256,1024}={0,2}$/.test(manifest.signature || '') ||
      !Number.isSafeInteger(manifest.bytes) || manifest.bytes! < 1 || manifest.bytes! > 20 * 1024 * 1024)) throw new Error('Invalid bundle');
  return manifest;
}

interface DeliveryDependencies {
  descriptor: OtaDescriptor; origin: string; bridge: OtaDeliveryBridge;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  fetchManifest(): Promise<OtaManifest | null>;
}
export async function checkOtaDelivery(deps: DeliveryDependencies): Promise<string> {
  const { descriptor, bridge } = deps;
  // The channel comes from the installed native configuration, not the server.
  const channel = descriptor.target + '.' + descriptor.nativeHash;
  if ((await bridge.getChannel()).channel !== channel) return 'incompatible-native';
  const prefix = 'dreamary_ota_' + channel;
  // initializeOta shares one operation per app runtime. Every new launch checks
  // again, including after a failed/offline launch; legacy _checked is ignored.
  const manifest = await deps.fetchManifest();
  if (!manifest) return 'no-update';
  const highWater = Number(await deps.read(prefix + '_sequence'));
  if (!Number.isFinite(highWater) || manifest.sequence < highWater) return 'replayed';
  await deps.write(prefix + '_sequence', String(manifest.sequence));
  const current = (await bridge.getCurrentBundle()).bundleId;
  if (manifest.action !== 'update') {
    // Both commands only schedule the next cold start. No reload/reset call.
    await bridge.setNextBundle({ bundleId: manifest.action === 'reset' ? null : current });
    return manifest.action === 'reset' ? 'reset-scheduled' : 'paused';
  }
  const bundleId = manifest.bundleId!;
  if ((await bridge.getBlockedBundles()).bundleIds.includes(bundleId)) return 'blocked';
  if (current === bundleId) return 'current';
  if (!(await bridge.getDownloadedBundles()).bundleIds.includes(bundleId)) {
    await bridge.downloadBundle({ bundleId, artifactType: 'zip', url: deps.origin + '/bundles/' + bundleId + '.zip', checksum: manifest.checksum!, signature: manifest.signature! });
  }
  await bridge.setNextBundle({ bundleId });
  return 'scheduled';
}
