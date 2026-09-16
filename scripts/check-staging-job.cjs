// Synthetic chat deletion; the deployed scheduler must finish after one API call.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { preflight } = require('./deploy-staging.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');

async function main() {
  if (process.argv.slice(2).join(' ') !== '--execute') throw new Error('Use --execute for staging only.');
  const env = preflight(), base = 'https://dreamary-staging.netlify.app';
  const app = initializeApp({ projectId: 'dreamary-staging', credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY)) }, 'job-' + randomUUID());
  const db = getFirestore(app), auth = getAuth(app), uid = 'qa-job-' + randomUUID(), characterId = 'qa-job-' + randomUUID(), requestId = randomUUID();
  const character = db.collection('characters').doc(characterId);
  const messages = Array.from({ length: 45 }, (_, i) => db.collection('chatMessages').doc(characterId + '-' + i));
  const lateMessage = db.collection('chatMessages').doc(characterId + '-after');
  const job = db.collection('dataJobs').doc(hash(JSON.stringify(['chat-delete', uid, characterId, requestId])));
  const usage = db.collection('operationUsage').doc('jobs_' + hash(uid));
  const checks = [], cleanupErrors = [];
  let failure = false;
  function check(name, passed) { checks.push({ name, passed }); if (!passed) throw new Error('Check failed'); }
  async function post(url, body, token) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45000) });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }
  try {
    await auth.createUser({ uid });
    const customToken = await auth.createCustomToken(uid);
    const exchange = await post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + encodeURIComponent(env.NEXT_PUBLIC_FIREBASE_API_KEY), { token: customToken, returnSecureToken: true });
    check('test-user-authenticated', exchange.status === 200 && typeof exchange.data.idToken === 'string');
    const batch = db.batch();
    batch.create(character, { id: characterId, userId: uid, name: 'Synthetic job verification', createdAt: Date.now() });
    for (const ref of messages) batch.create(ref, { id: ref.id, userId: uid, characterId, createdAt: Date.now(), role: 'user', content: 'Synthetic job verification' });
    await batch.commit();
    const body = { userId: uid, characterId, requestId };
    const start = await post(base + '/api/chat/delete', body, exchange.data.idToken);
    check('delete-api-accepted-background-work', start.status === 200 && start.data.done === false);
    let completed = false;
    for (let attempt = 0; attempt < 9; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20000));
      const state = (await job.get()).data();
      console.log(JSON.stringify({ schedulerCheck: attempt + 1, state: state?.status || 'missing', attempts: state?.attempts || 0 }));
      if (state?.status === 'complete') { completed = true; break; }
    }
    check('scheduler-completed-without-client-retry', completed);
    const remaining = await db.collection('chatMessages').where('userId', '==', uid).where('characterId', '==', characterId).limit(1).get();
    check('all-45-messages-removed', remaining.empty);
    const profile = (await character.get()).data();
    check('clearing-released-and-epoch-advanced', profile?.chatClearing === false && profile?.chatEpoch === 1);
    await lateMessage.create({ id: lateMessage.id, userId: uid, characterId, createdAt: Date.now(), role: 'user', content: 'Created after completed deletion' });
    const replay = await post(base + '/api/chat/delete', body, exchange.data.idToken);
    check('completed-request-replay-preserves-new-message', replay.status === 200 && replay.data.done === true && (await lateMessage.get()).exists);
  } catch { failure = true; }
  finally {
    for (const ref of [...messages, lateMessage, character, job, usage]) try { await ref.delete(); } catch { cleanupErrors.push(ref.path); }
    try { await auth.deleteUser(uid); } catch (error) { if (error.code !== 'auth/user-not-found') cleanupErrors.push('auth/' + uid); }
    await db.terminate(); await deleteApp(app);
  }
  const report = { project: 'dreamary-staging', checkedAt: new Date().toISOString(), checks, failure, cleanupComplete: !cleanupErrors.length, cleanupErrors, scope: 'One deployed chat deletion API call plus real scheduled continuation and completed-request replay. Synthetic data only; no push delivery, migration or account deletion.' };
  fs.writeFileSync(path.resolve(__dirname, '../artifacts/staging-2026-09-13/job-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report)); if (failure || cleanupErrors.length) process.exitCode = 1;
}
main().catch(() => { console.error('Staging job check could not start; credentials hidden.'); process.exitCode = 1; });
