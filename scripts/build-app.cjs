const path = require('node:path');
const { spawnSync } = require('node:child_process');
const targets = require('../app-build-targets.json');

function buildEnvironment(target, env) {
  const config = targets[target];
  if (!Object.hasOwn(targets, target)) throw new Error('앱 빌드 대상은 branch 또는 release로 지정하세요.');
  if (env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== config.firebaseProjectId) {
    throw new Error('앱 빌드 대상과 Firebase 프로젝트가 다릅니다. 연결 설정을 확인하세요.');
  }
  if (env.NEXT_PUBLIC_API_URL && env.NEXT_PUBLIC_API_URL.replace(/\/$/, '') !== config.apiUrl) {
    throw new Error('NEXT_PUBLIC_API_URL이 앱 빌드 대상과 다릅니다. 잘못된 서버 연결을 막기 위해 중단합니다.');
  }
  return {
    ...env,
    NEXT_PUBLIC_BUILD_TARGET: 'app',
    NEXT_PUBLIC_APP_VERSION: require('../package.json').version,
    NEXT_PUBLIC_API_URL: config.apiUrl,
    NEXT_PUBLIC_APP_CHANNEL: config.label,
  };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  require('@next/env').loadEnvConfig(root, false);
  try {
    const env = buildEnvironment(process.argv[2], process.env);
    console.log(`[app build] ${env.NEXT_PUBLIC_APP_CHANNEL} → ${env.NEXT_PUBLIC_API_URL} (${env.NEXT_PUBLIC_FIREBASE_PROJECT_ID})`);
    const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildEnvironment };
