// No network or real credentials. Match Lambda's disabled require(ESM) feature,
// not just the more permissive developer Node defaults.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { generateKeyPairSync, createPublicKey, verify } = require('node:crypto');

test('Firebase Auth loads with require(ESM) disabled and signs valid custom tokens', async () => {
  assert.ok(process.execArgv.includes('--no-experimental-require-module'));
  const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
  // Exercise both loading forms used by the packaged server code.
  const cjs = require('firebase-admin/auth');
  const esm = await import('firebase-admin/auth');
  assert.equal(esm.getAuth, cjs.getAuth);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const email = 'runtime-test@demo-dreamary.iam.gserviceaccount.com';
  const app = initializeApp({ credential: cert({
    projectId: 'demo-dreamary', clientEmail: email,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }) }, 'runtime-test');
  try {
    const uid = 'guest:11111111-1111-4111-8111-111111111111';
    const claims = { dreamaryOwner: uid.slice(6), dreamaryGuest: true };
    const token = await esm.getAuth(app).createCustomToken(uid, claims);
    const [header, payload, signature] = token.split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
    assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + payload), publicKey, Buffer.from(signature, 'base64url')));
    const decoded = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(decoded.uid, uid);
    assert.equal(decoded.iss, email);
    assert.equal(decoded.sub, email);
    assert.equal(decoded.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
    assert.deepEqual(decoded.claims, claims);
    assert.equal(decoded.exp - decoded.iat, 3600);
  } finally { await deleteApp(app); }
});

test('Firebase transitive JWKS dependency converts RSA keys using the compatible jose build', async () => {
  const adminRequire = createRequire(require.resolve('firebase-admin/auth'));
  const jwks = adminRequire('jwks-rsa');
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'runtime-key', alg: 'RS256', use: 'sig' };
  const client = jwks({ cache: false, getKeysInterceptor: async () => [jwk],
    fetcher: async () => { throw new Error('Network must not be used by this test'); },
  });
  const result = await client.getSigningKey('runtime-key');
  assert.equal(result.kid, 'runtime-key');
  assert.deepEqual(createPublicKey(result.getPublicKey()).export({ format: 'jwk' }), publicKey.export({ format: 'jwk' }));
});
