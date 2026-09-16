// Bounded cloud verification: synthetic users/documents only, fixed staging project.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { preflight } = require('./deploy-staging.cjs');

async function main() {
  if (process.argv.slice(2).join(' ') !== '--execute') throw new Error('Use --execute for the fixed staging project.');
  const env = preflight();
  const project = 'dreamary-staging';
  const app = initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY)), projectId: project }, 'staging-check-' + randomUUID());
  const auth = getAuth(app), db = getFirestore(app);
  const run = randomUUID(), owner = 'qa-' + run + '-owner', other = 'qa-' + run + '-other';
  const documentId = 'qa-' + run;
  const createdUsers = [], results = [], cleanupErrors = [];
  let documentCreated = false, failure;
  const document = db.collection('characters').doc(documentId);
  const documentUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/characters/${documentId}`;
  function check(name, passed) {
    results.push({ name, passed });
    if (!passed) throw new Error(name + ' failed');
  }
  async function request(url, options) {
    return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  }
  async function signIn(uid) {
    const password = randomBytes(32).toString('base64url');
    const email = uid + '@example.invalid';
    await auth.createUser({ uid, email, password });
    createdUsers.push(uid);
    const response = await request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(env.NEXT_PUBLIC_FIREBASE_API_KEY), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const body = await response.json();
    check('password-sign-in-' + (uid === owner ? 'owner' : 'other'), response.ok && body.localId === uid && typeof body.idToken === 'string');
    return body.idToken;
  }
  async function expectRead(name, token, expected) {
    const response = await request(documentUrl, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    await response.body?.cancel();
    check(name, response.status === expected);
  }
  try {
    const ownerToken = await signIn(owner), otherToken = await signIn(other);
    await document.create({ id: documentId, userId: owner, createdAt: Date.now(), name: 'Synthetic staging verification' });
    documentCreated = true;
    await expectRead('owner-read-allowed', ownerToken, 200);
    await expectRead('other-read-denied', otherToken, 403);
    await expectRead('unauthenticated-read-denied', null, 403);
    const response = await request(documentUrl, { method: 'DELETE', headers: { Authorization: 'Bearer ' + ownerToken } });
    await response.body?.cancel();
    check('client-character-delete-denied', response.status === 403);
  } catch (error) {
    // Never print SDK request objects: they may contain tokens or credentials.
    failure = error.code ? 'Firebase check failed: ' + error.code : 'Firebase check failed; inspect result flags and connectivity.';
  } finally {
    if (documentCreated) try { await document.delete(); } catch { cleanupErrors.push('characters/' + documentId); }
    for (const uid of createdUsers) try { await auth.deleteUser(uid); } catch { cleanupErrors.push('auth/' + uid); }
    await db.terminate();
    await deleteApp(app);
  }
  const report = { project, completedAt: new Date().toISOString(), checks: results, cleanupComplete: cleanupErrors.length === 0, cleanupErrors, failure: failure || null, scope: 'Direct Firebase verification; deployed application APIs not exercised.' };
  const file = path.resolve(__dirname, '../artifacts/staging-2026-09-12/firebase-smoke.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (failure || cleanupErrors.length) process.exitCode = 1;
}
main().catch(() => { console.error('Staging verification could not complete. No credentials printed.'); process.exitCode = 1; });
