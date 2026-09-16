// Local packaging only. This command never uploads or publishes an update.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function nativeDescriptor(root, target) {
  if (!['branch', 'release'].includes(target)) throw new Error('OTA requires branch or release.');
  const targets = JSON.parse(fs.readFileSync(path.join(root, 'app-build-targets.json')));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const inputs = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'ios', 'android', 'capacitor.config.ts'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  if (!inputs.includes('capacitor.config.ts') || !inputs.some(file => file.endsWith('project.pbxproj')) || !inputs.includes('android/app/build.gradle')) throw new Error('Native source checkout is required.');
  // Conservative: all lockfile changes require another verified native build.
  inputs.push('package-lock.json');
  inputs.push('ota.config.json', 'scripts/ota-native-config.cjs');
  const hash = crypto.createHash('sha256');
  for (const file of [...new Set(inputs)].sort()) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    if (!fs.lstatSync(full).isFile()) throw new Error('Native inputs must be regular files.');
    hash.update(file + '\0'); hash.update(crypto.createHash('sha256').update(fs.readFileSync(full)).digest());
  }
  return { schema: 1, target, appVersion: pkg.version, firebaseProjectId: targets[target].firebaseProjectId, apiUrl: targets[target].apiUrl, nativeHash: hash.digest('hex') };
}

function assertCompatible(candidate, baseline) {
  for (const key of ['schema', 'target', 'appVersion', 'firebaseProjectId', 'apiUrl', 'nativeHash']) {
    if (candidate[key] === undefined || candidate[key] !== baseline[key]) throw new Error('OTA native/environment mismatch: ' + key);
  }
  if (candidate.schema !== 1 || !/^[a-f0-9]{64}$/.test(candidate.nativeHash)) throw new Error('Invalid OTA descriptor.');
}

function assertFiles(directory) {
  let count = 0;
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || /\.(pem|key|map|drmbkp)$/i.test(entry.name)) throw new Error('Hidden, key or source-map file in OTA bundle.');
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('OTA bundles cannot contain symbolic links.');
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) count++;
      else throw new Error('Unsupported OTA file.');
    }
  }
  for (const required of ['index.html', 'ota-build.json']) if (!fs.existsSync(path.join(directory, required))) throw new Error('Missing ' + required);
  walk(directory);
  return count;
}

function main() {
  const args = require('node:util').parseArgs({ options: { target: { type: 'string' }, baseline: { type: 'string' }, output: { type: 'string' }, revision: { type: 'string' } } }).values;
  const revision = Number(args.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('VERSIONING.md: --revision must be a positive integer.');
  if (!args.target || !args.baseline || !args.output || !process.env.OTA_SIGNING_KEY_FILE) throw new Error('Required: --target, --baseline, --output, OTA_SIGNING_KEY_FILE.');
  const root = path.resolve(__dirname, '..'), out = path.join(root, 'out');
  const candidate = JSON.parse(fs.readFileSync(path.join(out, 'ota-build.json')));
  const baseline = JSON.parse(fs.readFileSync(path.resolve(args.baseline)));
  if (baseline.verifiedNativeBuilds?.ios !== true || baseline.verifiedNativeBuilds?.android !== true) throw new Error('Both native builds must be verified before packaging.');
  assertCompatible(candidate, baseline);
  assertCompatible(nativeDescriptor(root, args.target), baseline);
  const files = assertFiles(out);
  const privateKey = crypto.createPrivateKey(fs.readFileSync(process.env.OTA_SIGNING_KEY_FILE));
  if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048) throw new Error('RSA signing key of at least 2048 bits required.');
  const config = require('../ota.config.json')[args.target];
  const actualKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  if (!config.enabled || !actualKey.equals(crypto.createPublicKey(config.publicKey).export({ type: 'spki', format: 'der' }))) throw new Error('Signing key does not match the native public key.');
  const output = path.resolve(args.output);
  if (!output.endsWith('.zip') || output.startsWith(out + path.sep) || fs.existsSync(output) || fs.existsSync(output + '.json')) throw new Error('Use a new ZIP path outside out.');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamary-ota-'));
  try {
    const bundleId = crypto.randomUUID();
    const bundle = path.join(temporary, 'web');
    fs.cpSync(out, bundle, { recursive: true });
    // Only OTA ZIPs contain a revision. The native installation stays at base.
    fs.writeFileSync(path.join(bundle, 'ota-release.json'), JSON.stringify({ appVersion: candidate.appVersion, revision, bundleId }) + '\n', { flag: 'wx' });
    const archive = path.join(temporary, 'bundle.zip');
    execFileSync('zip', ['-X', '-q', '-r', archive, '.'], { cwd: bundle, stdio: 'pipe' });
    const bytes = fs.readFileSync(archive);
    if (bytes.length > 20 * 1024 * 1024) throw new Error('OTA ZIP exceeds the 20 MB limit.');
    const signature = crypto.sign('sha256', bytes, privateKey);
    const publicKey = crypto.createPublicKey(privateKey);
    if (!crypto.verify('sha256', bytes, publicKey, signature)) throw new Error('Local signature verification failed.');
    const report = { ...candidate, revision, bundleId, createdAt: new Date().toISOString(), files: files + 1, bytes: bytes.length, checksum: crypto.createHash('sha256').update(bytes).digest('hex'), signature: signature.toString('base64'), signingKeyFingerprint: crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex'), published: false };
    fs.copyFileSync(archive, output, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(output + '.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ output, files, bytes: bytes.length, signatureVerified: true, published: false }));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { nativeDescriptor, assertCompatible, assertFiles };
if (require.main === module) try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
