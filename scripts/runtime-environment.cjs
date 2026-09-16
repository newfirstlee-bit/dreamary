const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const targets = require('../app-build-targets.json');
const localFiles = ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local'];
const isolatedKeys = ['FIREBASE_SERVICE_ACCOUNT_KEY', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'OPENROUTER_API_KEY', 'NEXT_PUBLIC_OPENROUTER_API_KEY', 'GROQ_API_KEY', 'RESEND_API_KEY', 'IMGBB_API_KEY', 'NEXT_PUBLIC_IMG_BB_API_KEY', 'NEXT_PUBLIC_IMGBB_API_KEY', 'NEXT_PUBLIC_MIXPANEL_TOKEN', 'ADMIN_PASSWORD', 'ADMIN_ALLOWED_IP', 'GUEST_SESSION_SECRET', 'ADMIN_SESSION_SECRET', 'GUEST_LEGACY_CLAIM_UNTIL', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY'];

function validateStaging(env, requireServer = false) {
  const expected = targets.branch;
  if (env.DREAMARY_ENVIRONMENT !== 'staging' || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== expected.firebaseProjectId || env.NEXT_PUBLIC_API_URL !== expected.apiUrl || env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN !== expected.firebaseProjectId + '.firebaseapp.com') throw new Error('테스트 Firebase·서버 주소가 분리된 staging 설정과 일치하지 않습니다.');
  for (const key of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']) if (env[key] && env[key] !== expected.firebaseProjectId) throw new Error('테스트 서버의 Google 프로젝트가 일치하지 않습니다.');
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GOOGLE_APPLICATION_CREDENTIALS']) if (env[key]) throw new Error('클라우드 테스트 환경에 다른 인증/에뮬레이터 연결을 혼합할 수 없습니다.');
  if (env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    let account;
    try { account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_KEY); } catch { throw new Error('테스트 서비스 계정 설정 형식이 올바르지 않습니다.'); }
    if (account.project_id !== expected.firebaseProjectId) throw new Error('테스트 서버에 운영/다른 프로젝트의 서비스 계정을 사용할 수 없습니다.');
  } else if (requireServer) throw new Error('테스트 전용 Firebase 서비스 계정 설정이 필요합니다.');
  if (requireServer && (!env.GUEST_SESSION_SECRET || !env.ADMIN_SESSION_SECRET || !env.ADMIN_PASSWORD)) throw new Error('테스트 서버 인증 설정이 필요합니다.');
  if (env.GUEST_LEGACY_CLAIM_UNTIL) throw new Error('새 테스트 프로젝트에는 이전 운영 기기 연결 예외를 허용하지 않습니다.');
  return env;
}

function isolatedEnvironment(target, inherited = process.env, root = path.resolve(__dirname, '..')) {
  const clean = { ...inherited };
  // Next loads .env.local even during static builds. Explicit blanks prevent
  // production values from being filled back in by its automatic env loader.
  const keys = new Set([...isolatedKeys, ...Object.keys(inherited).filter(k => k.startsWith('NEXT_PUBLIC_'))]);
  for (const file of localFiles) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) for (const key of Object.keys(dotenv.parse(fs.readFileSync(full)))) keys.add(key);
  }
  for (const key of keys) clean[key] = '';
  if (target === 'test') return { ...clean, DREAMARY_ENVIRONMENT: 'demo', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-dreamary-security', NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-only', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-dreamary-security.firebaseapp.com', NEXT_PUBLIC_FIREBASE_APP_ID: 'demo-only', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000', NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: '', NEXT_PUBLIC_API_URL: targets.test.apiUrl, AI_GENERATION_ENABLED: 'false' };
  const file = path.join(root, '.env.staging.local');
  const staging = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : inherited.DREAMARY_ENVIRONMENT === 'staging' ? inherited : null;
  if (!staging) throw new Error('.env.staging.local 또는 명시적인 staging 서버 환경이 필요합니다. 운영 설정으로 대체하지 않습니다.');
  const merged = { ...clean, ...staging };
  if (merged.FIREBASE_SERVICE_ACCOUNT_KEY) merged.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify(parseServiceAccount(merged.FIREBASE_SERVICE_ACCOUNT_KEY));
  return validateStaging(merged);
}

function parseServiceAccount(value) {
  try { return JSON.parse(value); } catch {}
  // dotenv turns the escaped newlines inside a quoted JSON value into a
  // backslash followed by a real newline. Repair that representation before
  // parsing, while keeping the private key's newlines as JSON escapes.
  const repaired = String(value).replace(/\\\n/g, '\\n').replace(/\\"/g, '"');
  return JSON.parse(repaired);
}

module.exports = { isolatedEnvironment, validateStaging, parseServiceAccount };
