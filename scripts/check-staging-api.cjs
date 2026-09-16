// Fixed staging destination; creates and removes only this run's synthetic data.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { preflight } = require('./deploy-staging.cjs');

async function main() {
  if (process.argv.slice(2).join(' ') !== '--execute') throw new Error('Use --execute for staging only.');
  const env = preflight(), base = 'https://dreamary-staging.netlify.app';
  const app = initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY)), projectId: 'dreamary-staging' }, 'api-check-' + randomUUID());
  const auth = getAuth(app), db = getFirestore(app);
  const owner = 'qa-api-' + randomUUID(), other = 'qa-api-' + randomUUID(), guest = randomUUID();
  const pairIds = Array.from({ length: 6 }, () => 'qa-api-' + randomUUID());
  const guestPair = 'qa-api-' + randomUUID();
  const createdUsers = [], checks = [], cleanupErrors = [];
  let failure;
  function check(name, passed) { checks.push({ name, passed }); if (!passed) throw new Error('check-failed'); }
  async function post(url, body, authorization) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45000) });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  }
  async function passwordLogin(uid) {
    const password = randomBytes(32).toString('base64url'), email = uid + '@example.invalid';
    await auth.createUser({ uid, email, password }); createdUsers.push(uid);
    const r = await post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(env.NEXT_PUBLIC_FIREBASE_API_KEY), { email, password, returnSecureToken: true });
    check('password-login-' + (uid === owner ? 'owner' : 'other'), r.status === 200 && r.data.localId === uid);
    return 'Bearer ' + r.data.idToken;
  }
  async function databaseSession(uid, authorization) {
    const r = await post(base + '/api/data/session', { userId: uid }, authorization);
    check('data-session-' + (uid === guest ? 'guest' : 'login'), r.status === 200 && typeof r.data.customToken === 'string');
    const exchange = await post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + encodeURIComponent(env.NEXT_PUBLIC_FIREBASE_API_KEY), { token: r.data.customToken, returnSecureToken: true });
    check('custom-token-exchange-' + (uid === guest ? 'guest' : 'login'), exchange.status === 200 && typeof exchange.data.idToken === 'string');
    const identity = await auth.verifyIdToken(exchange.data.idToken);
    check('custom-token-identity-' + (uid === guest ? 'guest' : 'login'), identity.uid === (uid === guest ? 'guest:' + guest : uid));
    return exchange.data.idToken;
  }
  const character = (id, uid) => ({ character: { id, userId: uid, name: 'Synthetic API check', createdAt: Date.now() } });
  try {
    const ownerAuthorization = await passwordLogin(owner), otherAuthorization = await passwordLogin(other);
    await databaseSession(owner, ownerAuthorization);
    const denied = await post(base + '/api/data/session', { userId: owner }, otherAuthorization);
    check('forged-data-owner-denied', denied.status === 403);
    const unauth = await post(base + '/api/character/create', character(pairIds[0], owner));
    check('unauthenticated-pair-denied', unauth.status === 401);
    // Six simultaneous creation attempts exercise the server's real transaction lock.
    const attempts = await Promise.all(pairIds.map(id => post(base + '/api/character/create', character(id, owner), ownerAuthorization)));
    check('concurrent-five-pair-limit', attempts.filter(x => x.status === 200).length === 5 && attempts.filter(x => x.status === 409).length === 1);
    const savedId = pairIds[attempts.findIndex(x => x.status === 200)];
    const replay = await post(base + '/api/character/create', character(savedId, owner), ownerAuthorization);
    check('pair-retry-idempotent', replay.status === 200);
    const foreign = await post(base + '/api/character/create', character(savedId, owner), otherAuthorization);
    check('foreign-pair-write-denied', foreign.status === 403);
    const secret = randomBytes(32).toString('hex');
    const registration = await post(base + '/api/guest/session', { userId: guest, secret });
    check('guest-registration', registration.status === 200 && typeof registration.data.token === 'string');
    const guestAuthorization = 'Guest ' + registration.data.token;
    await databaseSession(guest, guestAuthorization);
    const guestCreate = await post(base + '/api/character/create', character(guestPair, guest), guestAuthorization);
    check('guest-pair-create', guestCreate.status === 200);
    const wrongKey = await post(base + '/api/guest/session', { userId: guest, secret: randomBytes(32).toString('hex') });
    check('guest-wrong-key-denied', wrongKey.status === 403);
  } catch {
    failure = 'Staging API check failed; inspect named checks. Response bodies and credentials are not logged.';
  } finally {
    // IDs are generated here, never discovered by a broad cleanup query.
    const refs = [...pairIds, guestPair].map(id => db.collection('characters').doc(id));
    refs.push(db.collection('pairCreationLocks').doc(owner), db.collection('pairCreationLocks').doc(guest), db.collection('guestCredentials').doc(guest));
    for (const ref of refs) try { await ref.delete(); } catch { cleanupErrors.push(ref.path); }
    for (const uid of [...createdUsers, 'guest:' + guest]) try { await auth.deleteUser(uid); } catch (e) { if (e.code !== 'auth/user-not-found') cleanupErrors.push('auth/' + uid); }
    await db.terminate(); await deleteApp(app);
  }
  const report = { project: 'dreamary-staging', url: base, checkedAt: new Date().toISOString(), checks, failure: failure || null, cleanupComplete: cleanupErrors.length === 0, cleanupErrors, scope: 'Deployed authentication and pair APIs. AI, indexed histories, queues, push and native UI not exercised. Shared registration usage counters are retained.' };
  const file = path.resolve(__dirname, '../artifacts/staging-2026-09-13/api-smoke.json');
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report)); if (failure || cleanupErrors.length) process.exitCode = 1;
}
main().catch(() => { console.error('Staging API verification could not complete; credentials hidden.'); process.exitCode = 1; });
