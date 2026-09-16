// Static, staging-only OTA hosting. No functions, production deploy or cloud SDK.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { assertCompatible } = require('./ota-bundle.cjs');
const target = require('../staging-deploy.json');
const config = require('../ota.config.json').branch;
const { loginToken, api, assertSite, redact } = require('./deploy-staging.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.ota-hosting');
const alias = 'ota';
const headers = '/*\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n/channels/*\n  Cache-Control: no-store\n/bundles/*\n  Cache-Control: public, max-age=31536000, immutable\n';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function sign(payload, key) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return { payload: bytes.toString('base64'), signature: crypto.sign('sha256', bytes, key).toString('base64') };
}
function verify(envelope) {
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!crypto.verify('sha256', bytes, config.publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('Invalid manifest signature.');
  const payload = JSON.parse(bytes);
  if (payload.target !== 'branch' || payload.firebaseProjectId !== 'dreamary-staging' || payload.apiUrl !== target.url || !/^[a-f0-9]{64}$/.test(payload.nativeHash)) throw new Error('Manifest is not staging.');
  return payload;
}
function prepare(args) {
  if (!args.baseline || !args.sequence || !['update', 'pause', 'reset'].includes(args.action)) throw new Error('--baseline, --sequence, --action update|pause|reset required.');
  if (!process.env.OTA_SIGNING_KEY_FILE) throw new Error('OTA_SIGNING_KEY_FILE is required.');
  const baseline = JSON.parse(fs.readFileSync(path.resolve(args.baseline)));
  if (!baseline.verifiedNativeBuilds?.ios || !baseline.verifiedNativeBuilds?.android) throw new Error('Verified native baseline required.');
  if (baseline.target !== 'branch' || baseline.firebaseProjectId !== 'dreamary-staging' || baseline.apiUrl !== target.url || !/^[a-f0-9]{64}$/.test(baseline.nativeHash)) throw new Error('Only staging baseline is supported.');
  const key = crypto.createPrivateKey(fs.readFileSync(process.env.OTA_SIGNING_KEY_FILE));
  if (!crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).equals(crypto.createPublicKey(config.publicKey).export({ type: 'spki', format: 'der' }))) throw new Error('Wrong signing key.');
  const sequence = Number(args.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Positive integer sequence required.');
  const folder = path.join(directory, 'channels/branch', baseline.nativeHash), latest = path.join(folder, 'latest.json');
  if (fs.existsSync(latest) && verify(JSON.parse(fs.readFileSync(latest))).sequence >= sequence) throw new Error('Sequence must increase, including rollback/pause.');
  const descriptor = Object.fromEntries(['schema','target','appVersion','firebaseProjectId','apiUrl','nativeHash'].map(k => [k,baseline[k]]));
  const payload = { ...descriptor, sequence, action: args.action, issuedAt: Date.now(), expiresAt: Date.now() + 30 * 86400000 };
  if (args.action === 'update') {
    if (!args.bundle) throw new Error('--bundle is required for update.');
    const bytes = fs.readFileSync(path.resolve(args.bundle)), metadata = JSON.parse(fs.readFileSync(path.resolve(args.bundle) + '.json'));
    assertCompatible(metadata, baseline);
    if (!/^[a-f0-9-]{36}$/.test(metadata.bundleId) || bytes.length > 20 * 1024 * 1024 || bytes.length !== metadata.bytes || digest(bytes) !== metadata.checksum || !crypto.verify('sha256', bytes, config.publicKey, Buffer.from(metadata.signature, 'base64'))) throw new Error('Bundle verification failed.');
    fs.mkdirSync(path.join(directory, 'bundles'), { recursive: true });
    const output = path.join(directory, 'bundles', metadata.bundleId + '.zip');
    if (fs.existsSync(output)) {
      if (digest(fs.readFileSync(output)) !== metadata.checksum) throw new Error('Bundle ID is immutable.');
    } else fs.writeFileSync(output, bytes, { flag: 'wx' });
    Object.assign(payload, { bundleId: metadata.bundleId, checksum: metadata.checksum, signature: metadata.signature, bytes: metadata.bytes });
  }
  fs.mkdirSync(folder, { recursive: true });
  const envelope = sign(payload, key); verify(envelope);
  fs.writeFileSync(latest + '.tmp', JSON.stringify(envelope) + '\n');
  fs.renameSync(latest + '.tmp', latest);
  fs.writeFileSync(path.join(directory, '_headers'), headers);
  console.log(JSON.stringify({ prepared: true, target: 'branch', action: args.action, sequence, published: false }));
}
function validateHosting(dir) {
  let total = 0, manifests = 0;
  const allowedBundles = new Set();
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name), relative = path.relative(dir, file).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error('Hosting symlinks forbidden.');
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile() || !(relative === '_headers' || /^channels\/branch\/[a-f0-9]{64}\/latest.json$/.test(relative) || /^bundles\/[a-f0-9-]{36}\.zip$/.test(relative))) throw new Error('Unexpected hosting file.');
      total += fs.statSync(file).size;
      if (relative.endsWith('latest.json')) {
        const m = verify(JSON.parse(fs.readFileSync(file))); manifests++;
        if (!relative.includes('/' + m.nativeHash + '/') || !['update','pause','reset'].includes(m.action) || !Number.isSafeInteger(m.sequence) || m.sequence < 1 || m.expiresAt <= Date.now()) throw new Error('Invalid/expired manifest.');
        if (m.action === 'update') {
          if (!/^[a-f0-9-]{36}$/.test(m.bundleId)) throw new Error('Invalid bundle ID.');
          const bundle = fs.readFileSync(path.join(dir, 'bundles', m.bundleId + '.zip'));
          if (bundle.length !== m.bytes || digest(bundle) !== m.checksum || !crypto.verify('sha256', bundle, config.publicKey, Buffer.from(m.signature,'base64'))) throw new Error('Invalid hosted bundle.');
          allowedBundles.add(m.bundleId);
        }
      }
    }
  }
  walk(dir);
  if (!manifests || total > 200 * 1024 * 1024 || fs.readFileSync(path.join(dir, '_headers'),'utf8') !== headers) throw new Error('Hosting manifest/header/size check failed.');
  return { manifests, total, activeBundles: allowedBundles.size };
}
function deployArguments(siteId = target.siteId) {
  return ['--yes', '--package=netlify-cli@' + target.netlifyCliVersion, 'netlify', 'deploy', '--site', siteId, '--alias', alias, '--no-build', '--dir', 'public', '--functions', 'empty-functions', '--json', '--timeout', '120'];
}
async function deploy() {
  if (config.origin !== 'https://ota--dreamary-staging.netlify.app' || target.siteId !== '12c6d1e4-6439-4cf9-b3e2-a27cf0932e58') throw new Error('Staging OTA target changed.');
  const checked = validateHosting(directory), token = await loginToken(process.env);
  const site = await api(token, '/sites/' + target.siteId); assertSite(site);
  if (site.build_settings?.repo_branch === alias || site.build_settings?.allowed_branches?.includes(alias)) throw new Error('OTA alias conflicts with a Git branch.');
  const originalDeploy = site.published_deploy?.id;
  if (!originalDeploy) throw new Error('Cannot verify existing staging server deployment.');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamary-ota-publish-'));
  try {
    fs.cpSync(directory, path.join(temp, 'public'), { recursive: true }); validateHosting(path.join(temp,'public'));
    fs.mkdirSync(path.join(temp, 'empty-functions'));
    fs.writeFileSync(path.join(temp, 'netlify.toml'), '[build]\npublish="public"\n[functions]\ndirectory="empty-functions"\n');
    const env = Object.fromEntries(['PATH','HOME','TMPDIR','SystemRoot'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    Object.assign(env, { NETLIFY_AUTH_TOKEN:token, NETLIFY_SITE_ID:target.siteId, NETLIFY_TELEMETRY_DISABLED:'1', CI:'true' });
    const result = await new Promise((resolve,reject)=>{
      const child=spawn('npx',deployArguments(),{cwd:temp,env,stdio:['ignore','pipe','pipe']}); let stdout='', stderr='', size=0;
      const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)child.kill();else stdout+=chunk;});
      child.stderr.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)child.kill();else stderr+=chunk;});
      child.on('error',()=>{clearTimeout(timer);reject(new Error('OTA deploy tool unavailable.'));});
      child.on('close',code=>{
        clearTimeout(timer);
        const logDir=path.join(root,'artifacts/ota-2026-09-14');fs.mkdirSync(logDir,{recursive:true});
        fs.writeFileSync(path.join(logDir,'hosting-cli.log'),redact(stdout+'\n'+stderr,env),{mode:0o600});
        if(code!==0)reject(new Error('OTA deploy failed; inspect Netlify deploy status and private hosting-cli.log before retrying.'));
        else {try{resolve(JSON.parse(stdout));}catch{reject(new Error('Ambiguous OTA deploy response; inspect status before retrying.'));}}
      });
    });
    if (result.site_id !== target.siteId || !/^[a-f0-9]+$/.test(result.deploy_id)) throw new Error('Unexpected deploy result.');
    const deployed = await api(token, '/deploys/' + result.deploy_id);
    const after = await api(token, '/sites/' + target.siteId); assertSite(after);
    if (deployed.state !== 'ready' || deployed.site_id !== target.siteId || deployed.branch !== alias || after.published_deploy?.id !== originalDeploy) throw new Error('OTA alias or existing server deploy verification failed.');
    const record = { checkedAt:new Date().toISOString(), deployId:result.deploy_id, origin:config.origin, target:'branch', ready:true, unchangedServerDeploy:originalDeploy, ...checked };
    fs.mkdirSync(path.join(root,'artifacts/ota-2026-09-14'),{recursive:true});
    fs.writeFileSync(path.join(root,'artifacts/ota-2026-09-14/hosting-deploy.json'),JSON.stringify(record,null,2)+'\n');
    console.log(JSON.stringify(record));
  } finally { fs.rmSync(temp, { recursive:true, force:true }); }
}
async function main() {
  const args = require('node:util').parseArgs({ options: { prepare:{type:'boolean'}, deploy:{type:'boolean'}, baseline:{type:'string'}, bundle:{type:'string'}, sequence:{type:'string'}, action:{type:'string'} } }).values;
  if (args.prepare === args.deploy || (!args.prepare && !args.deploy)) throw new Error('Choose --prepare or --deploy.');
  if (args.prepare) prepare(args); else await deploy();
}
module.exports = { sign, verify, prepare, validateHosting, deployArguments };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode=1; });
