const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isolatedEnvironment, validateStaging } = require('./runtime-environment.cjs');
const root = path.resolve(__dirname, '..');
try {
  const env = validateStaging(isolatedEnvironment('branch', process.env, root), true);
  env.NEXT_PUBLIC_BUILD_TARGET = '';
  env.NEXT_PUBLIC_APP_VERSION = require('../package.json').version;
  env.CONTEXT = 'branch-deploy';
  for (const args of [['scripts/check-netlify-functions.cjs'], ['--run', 'test:regression'], [require.resolve('next/dist/bin/next'), 'build']]) {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('테스트 서버 빌드/검증에 실패했습니다.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
