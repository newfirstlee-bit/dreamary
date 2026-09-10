const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { buildEnvironment } = require('./build-app.cjs');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/loginFailure.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: moduleUnderTest.exports });
const { loginFailureKind } = moduleUnderTest.exports;

test('branch build pairs the preview API and label; release must be explicit', () => {
  const input = { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'dreamary-1a9af' };
  const branch = buildEnvironment('branch', input);
  assert.equal(branch.NEXT_PUBLIC_API_URL, 'https://deploy-preview-2--dreamary.netlify.app');
  assert.equal(branch.NEXT_PUBLIC_APP_CHANNEL, 'branch · PR2');
  assert.equal(buildEnvironment('release', input).NEXT_PUBLIC_API_URL, 'https://dreamary.netlify.app');
  assert.throws(() => buildEnvironment(undefined, input));
  assert.equal(input.NEXT_PUBLIC_API_URL, undefined);
});

test('mismatched Firebase project or API override cannot silently build', () => {
  assert.throws(() => buildEnvironment('branch', { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'different' }));
  assert.throws(() => buildEnvironment('branch', {
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'dreamary-1a9af', NEXT_PUBLIC_API_URL: 'https://dreamary.netlify.app',
  }));
});

test('post-login API errors never become incorrect-password messages', () => {
  for (const error of [new Error('API request failed: 404'), new Error('500'), { code: 'permission-denied' }, { code: 'auth/invalid-credential' }]) {
    assert.equal(loginFailureKind(error, 'account-sync'), 'account-sync');
  }
  assert.equal(loginFailureKind({ code: 'auth/invalid-credential' }, 'credentials'), 'credentials');
  assert.equal(loginFailureKind({ code: 'auth/network-request-failed' }, 'credentials'), 'network');
  assert.equal(loginFailureKind({ code: 'auth/too-many-requests' }, 'credentials'), 'rate-limit');
  assert.equal(loginFailureKind(new Error('unknown'), 'credentials'), 'unavailable');
});

test('real login form distinguishes credential rejection, post-login 404, and successful routing', async () => {
  for (const scenario of ['credentials', 'post-login', 'success']) {
    const state = ['example', 'synthetic-password', '', false, false];
    let stateIndex = 0;
    const calls = [];
    const mocks = {
      react: { useState: () => { const index = stateIndex++; return [state[index], value => { state[index] = value; }]; } },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
      'next/navigation': { useRouter: () => ({ push: route => calls.push(route) }) },
      'firebase/auth': { signInWithEmailAndPassword: async () => {
        if (scenario === 'credentials') throw { code: 'auth/invalid-credential' };
        return { user: { uid: 'synthetic-user' } };
      } },
      '@/lib/firebase': { auth: {}, db: {} },
      'next/link': {}, 'lucide-react': {},
      '@/lib/i18n': { useLocale: () => ({ t: key => key, locale: 'ko' }) },
      '@/lib/mixpanel': { trackEvent() {} }, '@/lib/db': {},
      '@/lib/auth': { getStoredGuestUserId: () => null },
      '@/lib/appCache': { clearUserCache() {} }, '@/lib/characterOrder': {},
      '@/lib/dataFirestore': { doc() {}, setDoc: async () => {
        calls.push('account-sync');
        if (scenario === 'post-login') throw new Error('API request failed: 404');
      } },
      '@/store/useAppStore': { invalidateCharacterStore() {} },
      '@/lib/diaryPush': { getPendingDiaryPushOptIn: () => null },
      '@/components/AuthContext': { useAuth: () => ({ syncAuthUser: () => calls.push('authenticated') }) },
      '@/lib/loginFailure': { loginFailureKind },
    };
    const exports = {};
    const source = fs.readFileSync(require.resolve('../src/app/(auth)/login/page.tsx'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, require: name => {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`);
      return mocks[name];
    }, console: { error() {} } });
    const tree = exports.default();
    const form = tree.props.children.find(child => child?.type === 'form');
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(state[3], false, 'loading always clears');
    if (scenario === 'credentials') {
      assert.equal(state[2], 'auth.loginFailed');
      assert.deepEqual(calls, []);
    } else if (scenario === 'post-login') {
      assert.match(state[2], /로그인 인증은 완료됐지만/);
      assert.deepEqual(calls, ['authenticated', 'account-sync']);
    } else {
      assert.equal(state[2], '');
      assert.deepEqual(calls, ['authenticated', 'account-sync', '/mypage']);
    }
  }
});
