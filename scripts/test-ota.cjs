const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/otaStartup.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exported });
const { createOtaStartup } = exported;

test('OTA: Capacitor proxy is not assimilated as a native thenable', async () => {
  const calls=[];
  const proxy=new Proxy({}, {get:(_target,method)=>async()=>{calls.push(method);if(method!=='ready')throw Error('Native method does not exist');return {rollback:false};}});
  const start=createOtaStartup(()=>true,async()=>exported.otaStartupBridge(proxy),async()=>{},()=>{});
  assert.equal(await start(),'ready');assert.deepEqual(calls,['ready']);
});

test('OTA: web does not load a native bridge or wait for a native paint', async () => {
  const unexpected = () => { throw new Error('Web invoked native OTA'); };
  const start = createOtaStartup(() => false, unexpected, unexpected, unexpected);
  assert.equal(await start(), 'web');
});

const nodeCrypto = require('node:crypto');
const deliveryExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/otaDelivery.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: deliveryExports, crypto: nodeCrypto.webcrypto, atob, Uint8Array, TextDecoder });
const { checkOtaDelivery, verifyOtaManifest } = deliveryExports;
const descriptor = { schema:1, target:'branch', appVersion:'1.0.0', firebaseProjectId:'dreamary-staging', apiUrl:'https://dreamary-staging.netlify.app', nativeHash:'a'.repeat(64) };
const signing = nodeCrypto.generateKeyPairSync('rsa', { modulusLength:2048 });
const pub = signing.publicKey.export({ type:'spki', format:'pem' });
const now = 1800000000000;
const manifest = { ...descriptor, action:'update', sequence:1, issuedAt:now-1000, expiresAt:now+86400000, bundleId:'12345678-1234-1234-1234-123456789abc', checksum:'b'.repeat(64), signature:'A'.repeat(344), bytes:1000 };
const envelope = m => { const bytes = Buffer.from(JSON.stringify(m)); return { payload:bytes.toString('base64'), signature:nodeCrypto.sign('sha256',bytes,signing.privateKey).toString('base64') }; };
test('OTA delivery: authentic manifest accepted; tampering and wrong signing key rejected', async () => {
  assert.equal((await verifyOtaManifest(envelope(manifest),pub,descriptor,now)).bundleId,manifest.bundleId);
  const damaged=envelope(manifest); damaged.payload=envelope({...manifest,action:'reset'}).payload;
  await assert.rejects(verifyOtaManifest(damaged,pub,descriptor,now));
  const another=nodeCrypto.generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'});
  await assert.rejects(verifyOtaManifest(envelope(manifest),another,descriptor,now));
});
test('OTA delivery: signed wrong environment, native version, expiry and oversized bundle rejected', async () => {
  for(const delta of [{target:'release'},{nativeHash:'c'.repeat(64)},{apiUrl:'https://dreamary.netlify.app'},{appVersion:'2.0.0'},{expiresAt:now-1},{issuedAt:now+3600000},{sequence:0},{bytes:21*1024*1024},{action:'unknown'},{bundleId:'../unexpected'}]) {
    await assert.rejects(verifyOtaManifest(envelope({...manifest,...delta}),pub,descriptor,now));
  }
});
function fixture(m=manifest) {
  const calls=[], storage=new Map();
  const bridge={ getChannel:async()=>({channel:'branch.'+descriptor.nativeHash}), getCurrentBundle:async()=>({bundleId:null}), getBlockedBundles:async()=>({bundleIds:[]}), getDownloadedBundles:async()=>({bundleIds:[]}), downloadBundle:async options=>{calls.push(['download',options]);}, setNextBundle:async options=>{calls.push(['next',options.bundleId]);} };
  const deps={descriptor,origin:'https://ota--dreamary-staging.netlify.app',bridge,read:async key=>storage.get(key)??null,write:async(key,value)=>{storage.set(key,value);},fetchManifest:async()=>{calls.push(['fetch']);return m;}};
  return {deps,calls,storage,bridge};
}
test('OTA delivery: each new launch checks despite a recent legacy timestamp and reuses downloaded bundles', async () => {
  const f=fixture();
  f.storage.set('dreamary_ota_branch.'+descriptor.nativeHash+'_checked',String(Date.now()));
  assert.equal(await checkOtaDelivery(f.deps),'scheduled');
  assert.deepEqual(f.calls.map(c=>c[0]),['fetch','download','next']);
  assert.equal(f.calls[1][1].signature,manifest.signature);
  assert.equal(f.calls[1][1].url,'https://ota--dreamary-staging.netlify.app/bundles/'+manifest.bundleId+'.zip');
  f.bridge.getDownloadedBundles=async()=>({bundleIds:[manifest.bundleId]});
  assert.equal(await checkOtaDelivery(f.deps),'scheduled');
  assert.deepEqual(f.calls.map(c=>c[0]),['fetch','download','next','fetch','next']);
});
test('OTA delivery: a launch with no update does not suppress a new update on the next launch', async () => {
  const f=fixture(null);
  assert.equal(await checkOtaDelivery(f.deps),'no-update');
  f.deps.fetchManifest=async()=>{f.calls.push(['fetch']);return manifest;};
  assert.equal(await checkOtaDelivery(f.deps),'scheduled');
  assert.deepEqual(f.calls.map(c=>c[0]),['fetch','fetch','download','next']);
});
test('OTA delivery: failed checks and downloads can retry on the very next launch', async () => {
  for (const stage of ['fetchManifest','downloadBundle']) {
    const f=fixture(), owner=stage==='fetchManifest'?f.deps:f.bridge, original=owner[stage];
    owner[stage]=async()=>{throw Error('offline');};
    await assert.rejects(checkOtaDelivery(f.deps));
    assert.ok(!f.calls.some(c=>c[0]==='next'));
    owner[stage]=original;
    assert.equal(await checkOtaDelivery(f.deps),'scheduled');
    assert.equal(f.calls.at(-1)[0],'next');
  }
});
test('OTA delivery: native mismatch, blocked bundle and current bundle never download', async () => {
  const mismatch=fixture();mismatch.bridge.getChannel=async()=>({channel:'release.other'});assert.equal(await checkOtaDelivery(mismatch.deps),'incompatible-native');assert.equal(mismatch.calls.length,0);
  for(const mode of ['blocked','current']) { const f=fixture();if(mode==='blocked')f.bridge.getBlockedBundles=async()=>({bundleIds:[manifest.bundleId]});else f.bridge.getCurrentBundle=async()=>({bundleId:manifest.bundleId});assert.equal(await checkOtaDelivery(f.deps),mode);assert.deepEqual(f.calls,[['fetch']]); }
});
test('OTA delivery: interrupted download never becomes next bundle; verified existing download is reused', async () => {
  const f=fixture();f.bridge.downloadBundle=async()=>{throw Error('network failed');};await assert.rejects(checkOtaDelivery(f.deps));assert.deepEqual(f.calls,[['fetch']]);
  const downloaded=fixture();downloaded.bridge.getDownloadedBundles=async()=>({bundleIds:[manifest.bundleId]});assert.equal(await checkOtaDelivery(downloaded.deps),'scheduled');assert.deepEqual(downloaded.calls,[['fetch'],['next',manifest.bundleId]]);
});
test('OTA delivery: older signed manifests cannot replace a later decision', async () => {
  const f=fixture();f.storage.set('dreamary_ota_branch.'+descriptor.nativeHash+'_sequence','2');assert.equal(await checkOtaDelivery(f.deps),'replayed');assert.deepEqual(f.calls,[['fetch']]);
});
test('OTA delivery: pause cancels pending activation; reset schedules built-in bundle without reload', async () => {
  for(const action of ['pause','reset']) { const f=fixture({...manifest,action});f.bridge.getCurrentBundle=async()=>({bundleId:'current'});assert.equal(await checkOtaDelivery(f.deps),action==='pause'?'paused':'reset-scheduled');assert.deepEqual(f.calls,[['fetch'],['next',action==='pause'?'current':null]]); }
});
test('OTA hosting: deploy uses isolated static alias and cannot publish the main site', () => {
  const {deployArguments}=require('./ota-host.cjs');const args=deployArguments();
  assert.equal(args[args.indexOf('--site')+1],'12c6d1e4-6439-4cf9-b3e2-a27cf0932e58');
  assert.equal(args[args.indexOf('--alias')+1],'ota');
  assert.ok(args.includes('--no-build'));assert.ok(!args.includes('--prod'));assert.ok(!args.includes('--prod-if-unlocked'));
  assert.ok(!args.includes('--context')); // CLI 27.1.1 rejects context with no-build.
  assert.equal(args[args.indexOf('--functions')+1],'empty-functions');
});
test('OTA: client render precedes readiness and repeated mounts share one operation', async () => {
  const calls = [];
  let painted;
  const paint = new Promise(resolve => { painted = resolve; });
  const start = createOtaStartup(() => true, async () => { calls.push('load'); return { ready: async () => { calls.push('ready'); return { rollback: false }; } }; }, () => paint, status => calls.push(status));
  const first = start(), second = start();
  assert.equal(first, second);
  assert.deepEqual(calls, []);
  painted();
  assert.equal(await first, 'ready');
  assert.deepEqual(calls, ['load', 'ready', 'ready']);
});
test('OTA: rollback is reported without reloading or modifying user state', async () => {
  const statuses = [];
  const start = createOtaStartup(() => true, async () => ({ ready: async () => ({ rollback: true }) }), async () => {}, status => statuses.push(status));
  assert.equal(await start(), 'rolled-back');
  assert.deepEqual(statuses, ['rolled-back']);
});
test('OTA: old native binaries without the plugin keep working', async () => {
  const start = createOtaStartup(() => true, async () => null, async () => {}, () => {});
  assert.equal(await start(), 'unavailable');
});
test('OTA: bridge failure does not reject app initialization or expose error text', async () => {
  const statuses = [];
  const start = createOtaStartup(() => true, async () => ({ ready: async () => { throw new Error('sensitive SDK request'); } }), async () => {}, status => statuses.push(status));
  assert.equal(await start(), 'failed');
  assert.deepEqual(statuses, ['failed']);
});

const { assertCompatible, assertFiles } = require('./ota-bundle.cjs');
test('OTA: rejects another environment, app version or native dependency baseline', () => {
  const baseline = { schema: 1, target: 'branch', appVersion: '1.0.0', firebaseProjectId: 'dreamary-staging', apiUrl: 'https://dreamary-staging.netlify.app', nativeHash: 'a'.repeat(64) };
  assert.doesNotThrow(() => assertCompatible({ ...baseline }, baseline));
  for (const key of Object.keys(baseline)) {
    assert.throws(() => assertCompatible({ ...baseline, [key]: 'different' }, baseline));
    const missing = { ...baseline }; delete missing[key];
    assert.throws(() => assertCompatible(missing, baseline));
  }
});
test('OTA: bundles require an entry page and reject hidden keys and symlinks', () => {
  const os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-file-check-'));
  try {
    assert.throws(() => assertFiles(dir));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(dir, 'ota-build.json'), '{}');
    assert.equal(assertFiles(dir), 2);
    fs.writeFileSync(path.join(dir, '.env.local'), 'synthetic');
    assert.throws(() => assertFiles(dir)); fs.unlinkSync(path.join(dir, '.env.local'));
    fs.writeFileSync(path.join(dir, 'signing.pem'), 'synthetic');
    assert.throws(() => assertFiles(dir)); fs.unlinkSync(path.join(dir, 'signing.pem'));
    fs.symlinkSync(path.join(dir, 'index.html'), path.join(dir, 'linked.html'));
    assert.throws(() => assertFiles(dir));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
