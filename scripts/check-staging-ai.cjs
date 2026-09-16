// Explicit synthetic staging E2E. Uses at most 3 AI requests and cleans its own records.
const { randomUUID, randomBytes } = require('node:crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { preflight } = require('./deploy-staging.cjs');
async function main() {
  if (!['--expect-unconfigured', '--execute'].includes(process.argv[2])) throw new Error('Explicit mode required.');
  const env = preflight(), expectedMissing = process.argv[2] === '--expect-unconfigured';
  if (expectedMissing && (env.OPENROUTER_API_KEY || env.NEXT_PUBLIC_OPENROUTER_API_KEY || env.AI_GENERATION_ENABLED !== 'false')) throw new Error('Missing-config probe requires disabled local staging config.');
  const app = initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY)), projectId: 'dreamary-staging' }, 'staging-ai-check');
  const db = getFirestore(app), auth = getAuth(app);
  const uid = 'qa-ai-' + randomUUID(), charId = 'qa-ai-' + randomUUID();
  const report = { checkedAt: new Date().toISOString(), project: 'dreamary-staging', checks: [], cleanupComplete: false };
  let createdUser = false;
  const check = (name, passed, extra = {}) => { report.checks.push({ name, passed, ...extra }); if (!passed) throw new Error('Check failed: ' + name); };
  async function post(url, body, bearer) {
    const started = Date.now();
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://localhost', ...(bearer ? { Authorization: bearer } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    return { status: r.status, data: await r.json().catch(() => ({})), elapsedMs: Date.now() - started, contentType: r.headers.get('content-type') };
  }
  try {
    const email = uid.replaceAll('-', '') + '@dreamary.internal', password = randomBytes(24).toString('base64url');
    await auth.createUser({ uid, email, password }); createdUser = true;
    const login = await post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(env.NEXT_PUBLIC_FIREBASE_API_KEY), { email, password, returnSecureToken: true });
    check('fresh-staging-account-password-login', login.status === 200 && login.data.localId === uid);
    const bearer = 'Bearer ' + login.data.idToken, base = env.NEXT_PUBLIC_API_URL;
    const session = await post(base + '/api/data/session', { userId: uid }, bearer);
    check('post-login-data-session', session.status === 200 && Boolean(session.data.customToken));
    const character = { id: charId, userId: uid, name: '하루', feeling: '다정함', title: '친구', exampleChat: '', negative: '', createdAt: Date.now(), locale: 'ko' };
    const created = await post(base + '/api/character/create', { character }, bearer);
    check('pair-created', created.status === 200);
    const common = { userId: uid, character, userProfile: { name: '테스터' }, preferJsonResponse: true };
    const dateString = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    const requests = [
      ['initial-ping', '/api/chat', { ...common, messages: [], isFirstPing: true, requestId: 'initial-ping:' + uid + ':' + charId }],
      ['chat', '/api/chat', { ...common, messages: [{ role: 'user', content: '안녕. 짧게 인사해줘.' }], requestId: 'qa-chat-' + randomUUID() }],
      ['diary', '/api/diary', { ...common, topic: '오늘 하루는 어땠어?', topicId: 'qa-topic', userEntry: '오늘 산책을 해서 기분이 좋았어.', dateString, timezoneOffsetMinutes: -540, requestId: 'qa-diary-' + randomUUID(), isAdTurn: false }],
    ];
    for (const [name, route, body] of requests) {
      const result = await post(base + route, body, bearer);
      const missingKey = result.data.error === 'OpenRouter API Key is not configured';
      const maintenance = result.data.error === '답장 생성을 잠시 점검하고 있습니다. 저장된 기록은 계속 확인할 수 있습니다.';
      check(name, expectedMissing ? (result.status === 500 && missingKey) || (result.status === 503 && maintenance) : result.status === 200 && typeof result.data.reply === 'string' && result.data.reply.length > 0,
        { status: result.status, elapsedMs: result.elapsedMs, contentType: result.contentType, ...(expectedMissing ? { cause: missingKey ? 'openrouter-key-missing' : maintenance ? 'ai-disabled' : 'unexpected' } : {}) });
      if (!expectedMissing) {
        const saved = await db.collection(name === 'diary' ? 'diaries' : 'chatMessages').doc(result.data.savedId).get();
        check(name + '-saved', saved.exists && saved.data().userId === uid && saved.data().characterId === charId);
      }
    }
  } catch { report.failed = true; }
  finally {
    try {
      for (const collection of ['chatMessages', 'diaries', 'aiRequests']) {
        const snapshot = await db.collection(collection).where(collection === 'aiRequests' ? 'uid' : 'userId', '==', uid).limit(20).get();
        if (snapshot.size === 20) throw new Error('Cleanup limit reached.');
        for (const doc of snapshot.docs) await doc.ref.delete();
      }
      for (const [collection, id] of [['characters', charId], ['users', charId], ['accounts', uid], ['pairCreationLocks', uid]]) await db.collection(collection).doc(id).delete();
      if (createdUser) await auth.deleteUser(uid);
      report.cleanupComplete = true;
    } catch { report.cleanupComplete = false; }
    await db.terminate(); await deleteApp(app);
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.failed || !report.cleanupComplete) process.exitCode = 1;
}
main().catch(() => { console.error('Staging synthetic check failed; details withheld.'); process.exitCode = 1; });
