// Real handlers + real JWT signatures, deterministic in-memory DB. No network,
// real account, production credentials, AI billing, or production DB writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const jose = require('jose');
const nodeCrypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const guestId = '11111111-1111-4111-8111-111111111111';
const secret = 'ab'.repeat(32);
const keys = jose.generateKeyPair('RS256');

function loadClient(file, mocks, globals = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports,
    require: name => { if (name in mocks) return mocks[name]; throw new Error('Unexpected dependency ' + name); },
    Request, Response, URL, Headers, AbortController, setTimeout, clearTimeout, ...globals,
  });
  return module.exports;
}

function memoryDb(seed = {}) {
  const rows = new Map(Object.entries(seed));
  const stats = { reads: 0, writes: 0 };
  let queue = Promise.resolve();
  const snapshot = (key, data) => ({ exists: data !== undefined, id: key.split('/').at(-1), ref: doc(key), data: () => data === undefined ? undefined : structuredClone(data) });
  const doc = key => ({ key, get: async () => { stats.reads++; return snapshot(key, rows.get(key)); },
    set: async value => { rows.set(key, structuredClone(value)); stats.writes++; },
    update: async value => { rows.set(key, { ...rows.get(key), ...structuredClone(value) }); stats.writes++; },
    delete: async () => { rows.delete(key); stats.writes++; },
  });
  const query = (name, filters = [], cap) => ({
    where: (field, op, value) => { assert.equal(op, '=='); return query(name, [...filters, [field, value]], cap); },
    limit: value => query(name, filters, value),
    get: async () => {
      assert.ok(cap && cap <= 20, 'All server queries must be bounded');
      const entries = [...rows].filter(([key, value]) => key.startsWith(name + '/') && filters.every(([field, expected]) => value[field] === expected)).slice(0, cap);
      stats.reads += Math.max(1, entries.length);
      return { empty: !entries.length, size: entries.length, docs: entries.map(([key, data]) => snapshot(key, data)) };
    },
    doc: id => doc(name + '/' + id),
  });
  return {
    rows, stats, collection: name => query(name),
    batch: () => { const pending = []; return { delete: ref => pending.push(ref), commit: async () => { for (const ref of pending) await ref.delete(); } }; },
    runTransaction: fn => {
      const run = queue.then(async () => {
        const changes = [];
        const transaction = {
          get: ref => { assert.equal(changes.length, 0, 'Firestore reads must precede writes'); return ref.get(); },
          set: (ref, value) => changes.push(() => rows.set(ref.key, structuredClone(value))),
          create: (ref, value) => { assert.equal(rows.has(ref.key), false); changes.push(() => rows.set(ref.key, structuredClone(value))); },
          update: (ref, value) => { assert.ok(rows.has(ref.key)); changes.push(() => rows.set(ref.key, { ...rows.get(ref.key), ...structuredClone(value) })); },
          delete: ref => changes.push(() => rows.delete(ref.key)),
        };
        const result = await fn(transaction);
        changes.forEach(change => { change(); stats.writes++; });
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

async function fixture(seed = {}, overrides = {}) {
  const db = memoryDb(seed);
  const { publicKey, privateKey } = await keys;
  const jwk = await jose.exportJWK(publicKey); jwk.kid = 'test-key';
  const env = { FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'test-project' }), GUEST_SESSION_SECRET: '12'.repeat(32), ADMIN_SESSION_SECRET: '34'.repeat(32), OPENROUTER_API_KEY: 'fake', ...overrides };
  const modules = new Map();
  let generations = 0;
  const load = file => {
    file = path.resolve(root, file);
    if (!path.extname(file)) file += '.ts';
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const requireLocal = name => {
      if (name === 'jose') return { ...jose, createRemoteJWKSet: () => jose.createLocalJWKSet({ keys: [jwk] }) };
      if (name === 'node:crypto') return nodeCrypto;
      if (name === 'firebase-admin/firestore') return { FieldValue: { serverTimestamp: () => 123 } };
      if (name === 'firebase-admin/auth') return { getAuth: () => ({
        createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }),
        deleteUser: async () => {},
        getUser: async () => {
        if (env.REGISTERED_UUID) return { uid: guestId };
        throw Object.assign(new Error(), { code: 'auth/user-not-found' });
      } }) };
      const resolved = path.resolve(path.dirname(file), name);
      if (resolved === path.join(root, 'src/lib/firebase-admin')) return { adminDb: db };
      if (name.startsWith('.')) return load(resolved);
      throw new Error('Unexpected dependency ' + name);
    };
    vm.runInNewContext(compiled, { module, exports: module.exports, require: requireLocal,
      process: { env }, URL, Request, Response, Buffer, TextEncoder, TextDecoder, ReadableStream, AbortController,
      setTimeout, clearTimeout, setInterval, clearInterval, performance,
      console: { info() {}, error() {}, warn() {} },
      fetch: async () => { generations++;
        if (env.CHAT_STREAM) return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: '테스트 답변' } }] }) + '\n\ndata: [DONE]\n');
        return Response.json({ choices: [{ message: { content: '테스트 답변' } }] });
      },
    }, { filename: file });
    return module.exports;
  };
  const loginToken = async (uid = 'alice', claims = {}, key = privateKey) => new jose.SignJWT({ auth_time: Math.floor(Date.now()/1000) - 10, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setSubject(uid)
    .setIssuer('https://securetoken.google.com/test-project').setAudience('test-project')
    .setIssuedAt().setExpirationTime('1h').sign(key);
  const run = (name, body, authorization, extra = {}) => load('netlify/functions/' + name + '.ts').default(new Request('https://test.invalid/api', {
    method: 'POST', headers: { ...(authorization ? { Authorization: authorization } : {}), ...extra }, body: JSON.stringify(body),
  }));
  const bind = async () => {
    const response = await run('guest-session', { userId: guestId, secret });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).token;
  };
  return { db, load, loginToken, run, bind, env, generations: () => generations };
}

test('Firebase: missing, wrong project, invalid signature, future auth_time and wrong owner are rejected', async () => {
  const f = await fixture();
  const verify = f.load('src/lib/server/diaryAuthentication.ts').requireDiaryLogin;
  const check = (token, owner = 'alice') => verify(new Request('https://test.invalid', { headers: token ? { Authorization: 'Bearer ' + token } : {} }), owner);
  await assert.rejects(check(), { status: 401 });
  const valid = await f.loginToken();
  assert.equal(await check(valid), 'alice');
  await assert.rejects(check(valid, 'bob'), { status: 403 });
  await assert.rejects(check(await f.loginToken('alice', { auth_time: Date.now() })), { status: 401 });
  const other = await jose.generateKeyPair('RS256');
  await assert.rejects(check(await f.loginToken('alice', {}, other.privateKey)), { status: 401 });
  const wrongProject = await new jose.SignJWT({ auth_time: 1 }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('alice').setAudience('other').setIssuer('https://securetoken.google.com/other').setIssuedAt().setExpirationTime('1h').sign((await keys).privateKey);
  await assert.rejects(check(wrongProject), { status: 401 });
  const expired = await new jose.SignJWT({ auth_time: 1 }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('alice').setAudience('test-project').setIssuer('https://securetoken.google.com/test-project').setIssuedAt(1).setExpirationTime(2).sign((await keys).privateKey);
  await assert.rejects(check(expired), { status: 401 });
  assert.equal(f.db.stats.reads, 0);
});

test('guest: atomic first binding, same-key retry, wrong key rejection, no raw secret stored', async () => {
  const f = await fixture();
  const responses = await Promise.all([secret, 'cd'.repeat(32)].map(key => f.run('guest-session', { userId: guestId, secret: key })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 403]);
  assert.equal((await f.run('guest-session', { userId: guestId, secret })).status, 200);
  assert.equal(JSON.stringify([...f.db.rows]).includes(secret), false);
  const token = (await responses[0].json()).token;
  assert.equal((await f.load('src/lib/server/guestIdentity.ts').verifyGuestSession(token)).uid, guestId);
});

test('guest: legacy requires explicit unexpired window; registered account cannot be claimed', async () => {
  const seed = { 'characters/c': { userId: guestId } };
  const closed = await fixture(seed);
  assert.equal((await closed.run('guest-session', { userId: guestId, secret })).status, 403);
  assert.equal(closed.db.rows.has('guestCredentials/' + guestId), false);
  const expired = await fixture(seed, { GUEST_LEGACY_CLAIM_UNTIL: '2020-01-01T00:00:00Z' });
  assert.equal((await expired.run('guest-session', { userId: guestId, secret })).status, 403);
  const open = await fixture(seed, { GUEST_LEGACY_CLAIM_UNTIL: new Date(Date.now() + 60000).toISOString() });
  await open.bind();
  const registered = await fixture({}, { REGISTERED_UUID: 'true' });
  assert.equal((await registered.run('guest-session', { userId: guestId, secret })).status, 403);
});

test('diary edit: no credentials / another UID fail before reads; owner fields cannot be changed', async () => {
  const f = await fixture({ 'diaries/d': { userId: 'alice', userEntry: 'old' } });
  const body = { diaryId: 'd', userId: 'alice', action: 'update', field: 'userEntry', content: 'new' };
  assert.equal((await f.run('diary-edit', body)).status, 401);
  assert.equal((await f.run('diary-edit', body, 'Bearer ' + await f.loginToken('bob'))).status, 403);
  assert.equal(f.db.stats.reads, 0);
  const auth = 'Bearer ' + await f.loginToken();
  assert.equal((await f.run('diary-edit', { ...body, field: 'userId' }, auth)).status, 400);
  assert.equal((await f.run('diary-edit', body, auth)).status, 200);
  assert.equal(f.db.rows.get('diaries/d').userEntry, 'new');
  assert.equal(f.db.stats.reads, 1);
  assert.equal((await f.run('diary-edit', { ...body, diaryId: 'missing' }, auth)).status, 403);
});

test('diary delete: forged today string cannot delete an old diary; current date works', async () => {
  const f = await fixture({ 'diaries/old': { userId: 'alice', dateString: '2020-01-01' },
    'diaries/today': { userId: 'alice', dateString: new Date().toISOString().slice(0, 10) } });
  const auth = 'Bearer ' + await f.loginToken();
  const body = { diaryId: 'old', userId: 'alice', action: 'delete', todayDateString: '2020-01-01', timezoneOffsetMinutes: 0 };
  assert.equal((await f.run('diary-edit', body, auth)).status, 400);
  assert.equal((await f.run('diary-edit', { ...body, timezoneOffsetMinutes: -99999 }, auth)).status, 400);
  assert.equal((await f.run('diary-edit', { ...body, diaryId: 'today' }, auth)).status, 200);
  assert.ok(f.db.rows.has('diaries/old'));
  assert.equal(f.db.rows.has('diaries/today'), false);
});

test('diary creation: validates character owner, returns duplicate only to owner, no unauthorized AI', async () => {
  const f = await fixture({ 'characters/c': { userId: 'alice' } });
  const body = { character: { id: 'c', name: '캐릭터' }, userId: 'alice', topic: '주제', topicId: 't',
    userEntry: '입력', dateString: new Date().toISOString().slice(0,10), timezoneOffsetMinutes: 0, requestId: 'r' };
  assert.equal((await f.run('diary', body)).status, 401);
  const bob = 'Bearer ' + await f.loginToken('bob');
  assert.equal((await f.run('diary', body, bob)).status, 403);
  assert.equal((await f.run('diary', { ...body, userId: 'bob' }, bob)).status, 403);
  assert.equal(f.generations(), 0);
  const auth = 'Bearer ' + await f.loginToken();
  const response = await f.run('diary', body, auth);
  const first = await response.json();
  assert.equal(first.created, true);
  const secondResponse = await f.run('diary', body, auth);
  assert.match(secondResponse.headers.get('Cache-Control'), /no-store/);
  const second = await secondResponse.json();
  assert.equal(second.savedId, first.savedId);
  assert.equal(f.generations(), 1);
});

test('guest migration: source proof + destination login, paged resume, target pin, old key blocked afterwards', async () => {
  const f = await fixture();
  const token = await f.bind();
  for (let i = 0; i < 25; i++) f.db.rows.set('diaries/d' + i, { userId: guestId, userEntry: 'old' });
  f.db.rows.set('characters/c', { userId: guestId });
  const payload = { sourceUUID: guestId, uid: 'alice' };
  const headers = { 'X-Guest-Authorization': 'Guest ' + token };
  const auth = 'Bearer ' + await f.loginToken();
  assert.equal((await f.run('backup-migrate', payload, auth)).status, 401);
  assert.equal((await f.run('backup-migrate', payload, undefined, headers)).status, 401);
  assert.equal((await (await f.run('backup-migrate', payload, auth, headers)).json()).done, false);
  assert.equal(f.db.rows.get('characters/c').userId, guestId, 'Characters stay with guest until all diaries moved');
  const blocked = await f.run('diary-edit', { userId: guestId, diaryId: 'd24', action: 'update', field: 'userEntry', content: 'attack' }, 'Guest ' + token);
  assert.equal(blocked.status, 403);
  assert.equal((await f.run('backup-migrate', { ...payload, uid: 'bob' }, 'Bearer ' + await f.loginToken('bob'), headers)).status, 403);
  let result;
  for (let page = 0; page < 5; page++) { result = await (await f.run('backup-migrate', payload, auth, headers)).json(); if (result.done) break; }
  assert.equal(result.done, true);
  assert.equal(f.db.rows.get('diaries/d24').userId, 'alice');
  assert.equal(f.db.rows.get('characters/c').diaryOwnershipMigrated, true);
  assert.equal((await (await f.run('backup-migrate', payload, auth, headers)).json()).done, true);
});

test('backup: secure generation, missing proof, invalid-code limit, reserved code cannot target another user', async () => {
  const f = await fixture(); const token = await f.bind();
  assert.equal((await f.run('backup-generate', { sourceUUID: guestId })).status, 401);
  const backup = await (await f.run('backup-generate', { sourceUUID: guestId }, 'Guest ' + token)).json();
  assert.match(backup.code, /^[A-Z0-9]{8}$/);
  assert.equal(JSON.stringify([...f.db.rows]).includes(backup.code), false);
  const auth = 'Bearer ' + await f.loginToken();
  assert.equal((await f.run('backup-migrate', { code: backup.code, uid: 'alice' })).status, 401);
  assert.equal((await f.run('backup-migrate', { code: backup.code, uid: 'alice' }, auth)).status, 200);
  assert.equal((await f.run('backup-migrate', { code: backup.code, uid: 'bob' }, 'Bearer ' + await f.loginToken('bob'))).status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await f.run('backup-migrate', { code: '00000000', uid: 'alice' }, auth)).status, 403);
  assert.equal((await f.run('backup-migrate', { code: '00000000', uid: 'alice' }, auth)).status, 429);
});

test('development and production use the exact same diary/guest/backup handlers', async () => {
  const f = await fixture();
  for (const [route, handler] of [['diary','diary'], ['diary/edit','diary-edit'], ['guest/session','guest-session'], ['backup/generate','backup-generate'], ['backup/migrate','backup-migrate']]) {
    // Existing diary routes use @ alias; inspect those explicit delegates.
    const source = fs.readFileSync(path.join(root, 'src/app/api', route, 'route.ts'), 'utf8');
    assert.ok(source.includes('netlify/functions/' + handler));
  }
});

test('client: login token refresh cannot send after logout or owner switch; no unauthenticated fallback', async () => {
  let complete;
  const user = { uid: 'alice', getIdToken: () => new Promise(resolve => { complete = resolve; }) };
  const auth = { currentUser: user };
  const client = loadClient('src/lib/diaryRequestHeaders.ts', {
    './firebase': { auth }, './auth': { getStoredGuestUserId: () => guestId },
    './guestSession': { getGuestSession: async () => 'bound-guest-token' },
  });
  await assert.rejects(client.diaryRequestHeaders({ userId: 'bob' }));
  const request = client.diaryRequestHeaders({ userId: 'alice' });
  auth.currentUser = null; complete('old-token');
  await assert.rejects(request);
  assert.equal((await client.diaryRequestHeaders({ userId: guestId })).Authorization, 'Guest bound-guest-token');
  await assert.rejects(client.diaryRequestHeaders({ userId: guestId }, true));
});

test('client: web and native send the same trusted authorization and timezone; no mutation auto-retry', async () => {
  for (const native of [false, true]) {
    const requests = [];
    const api = loadClient('src/lib/api.ts', {
      '@capacitor/core': { Capacitor: { isNativePlatform: () => native }, CapacitorHttp: { post: async request => {
        requests.push(request); return { status: 200, data: { success: true } };
      } } },
      './performanceTrace': { measurePhase: (_operation, _phase, action) => action() },
      './diaryRequestHeaders': { diaryRequestHeaders: async () => ({ Authorization: 'Bearer current-token' }) },
    }, { window: {}, process: { env: {} }, fetch: async (url, request) => {
      requests.push({ url, headers: request.headers, data: JSON.parse(request.body) }); return Response.json({ success: true });
    } });
    await api.apiPostJson('/api/diary/edit', { userId: 'alice' }, { headers: { authorization: 'Bearer stale-token' } });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.Authorization, 'Bearer current-token');
    assert.equal('authorization' in requests[0].headers, false);
    assert.equal(typeof requests[0].data.timezoneOffsetMinutes, 'number');
  }
});

test('client guest key: concurrent requests share registration; retry after lost response retains key', async () => {
  const storage = new Map(); let calls = 0; const sent = [];
  const client = loadClient('src/lib/guestSession.ts', {
    './auth': { getStoredGuestUserId: () => guestId },
    './api': { apiPostJson: async (_endpoint, data) => {
      sent.push(data.secret); calls++;
      if (calls === 1) throw new Error('response lost');
      return { token: 'guest-token', expiresAt: Date.now() + 900000 };
    } },
  }, { crypto: nodeCrypto.webcrypto, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
  await assert.rejects(client.getGuestSession(guestId));
  const a = client.getGuestSession(guestId), b = client.getGuestSession(guestId);
  assert.equal(a, b);
  assert.equal(await a, 'guest-token');
  assert.equal(await client.getGuestSession(guestId), 'guest-token');
  assert.equal(calls, 2); assert.equal(sent[0], sent[1]);
});

test('data session: Firebase guest claims derive only from verified owner, not caller claims', async () => {
  const f = await fixture(); const token = await f.bind();
  const response = await f.run('data-session', { userId: guestId, dreamaryOwner: 'victim', admin: true }, 'Guest ' + token);
  const issued = JSON.parse((await response.json()).customToken);
  assert.equal(issued.uid, 'guest:' + guestId);
  assert.equal(issued.claims.dreamaryOwner, guestId);
  assert.equal(issued.claims.dreamaryGuest, true);
  assert.equal(issued.claims.admin, undefined);
  assert.equal((await f.run('data-session', { userId: 'alice' }, 'Guest ' + token)).status, 403);
  const customGuestLogin = await f.loginToken('guest:' + guestId, { dreamaryGuest: true });
  assert.equal((await f.run('backup-migrate', { uid: 'guest:' + guestId }, 'Bearer ' + customGuestLogin)).status, 401);
});

test('admin session: forged true cookie and wrong signatures never authenticate', async () => {
  const f = await fixture();
  const admin = f.load('src/lib/server/adminSession.ts');
  assert.equal(await admin.validAdminSession('true'), false);
  const token = await admin.createAdminSession();
  assert.equal(await admin.validAdminSession(token), true);
  assert.equal(await admin.validAdminSession(token.slice(0, -10) + 'AAAAAAAAAA'), false);
  const response = await f.run('admin-topics-data', { action: 'delete', id: 't' }, undefined, { Cookie: 'admin_auth=true' });
  assert.equal(response.status, 401);
  assert.equal(f.db.stats.reads, 0);
});

test('chat: unauthenticated duplicate lookup denied; authorized reply uses Admin transaction', async () => {
  const f = await fixture({ 'characters/c': { userId: 'alice' } }, { CHAT_STREAM: 'true' });
  const body = { userId: 'alice', character: { id: 'c' }, messages: [], isFirstPing: true, requestId: 'request' };
  assert.equal((await f.run('chat', body)).status, 401);
  assert.equal(f.generations(), 0);
  const auth = 'Bearer ' + await f.loginToken();
  const first = await (await f.run('chat', body, auth)).json();
  assert.equal(first.reply, '테스트 답변');
  assert.equal(f.db.rows.get('chatMessages/' + first.savedId).userId, 'alice');
  const second = await (await f.run('chat', body, auth)).json();
  assert.equal(second.savedId, first.savedId); assert.equal(f.generations(), 1);
});

test('character delete: bounded cascade preserves another owner and finishes on retry', async () => {
  const f = await fixture({ 'characters/c': { userId: 'alice' }, 'users/c': { name: 'p' }, 'diaries/other': { userId: 'bob', characterId: 'c' } });
  for (let i = 0; i < 25; i++) f.db.rows.set('diaries/d' + i, { userId: 'alice', characterId: 'c' });
  const auth = 'Bearer ' + await f.loginToken();
  const body = { userId: 'alice', characterId: 'c' };
  assert.equal((await (await f.run('character-delete', body, auth)).json()).done, false);
  assert.equal(f.db.rows.get('characters/c').deleting, true);
  assert.equal((await (await f.run('character-delete', body, auth)).json()).done, true);
  assert.ok(f.db.rows.has('diaries/other')); assert.equal(f.db.rows.has('users/c'), false);
});

test('account cleanup: includes interrupted guest transfers, private metadata and parent profiles', async () => {
  const f = await fixture({
    ['guestCredentials/' + guestId]: { migrationTarget: 'alice', secretHash: 'hash', migrationState: 'pending' },
    'characters/guest-char': { userId: guestId }, 'users/guest-char': { name: 'profile' },
    'characters/own-char': { userId: 'alice' }, 'users/own-char': { name: 'profile' },
    'guestBackupCodes/code': { sourceUUID: guestId }, 'guestBackupAttempts/attempt': { uid: 'alice' },
    'diaries/bob': { userId: 'bob' }, 'accounts/alice': { id: 'alias' },
  });
  for (let i = 0; i < 25; i++) f.db.rows.set('diaries/d' + i, { userId: 'alice' });
  await f.load('src/lib/server/accountCleanup.ts').cleanupAccountData(f.db, 'alice');
  assert.equal(f.db.rows.size, 2);
  assert.deepEqual(f.db.rows.get('guestCredentials/' + guestId), { retired: true });
  assert.ok(f.db.rows.has('diaries/bob'));
  assert.equal((await f.run('guest-session', { userId: guestId, secret })).status, 403);
});

test('data session client: simultaneous DB operations share one authentication; logout changes data identity', async () => {
  const auth = { currentUser: null }, dataAuth = { currentUser: null }; let requests = 0;
  const client = loadClient('src/lib/dataSession.ts', {
    'firebase/auth': { signOut: async () => { dataAuth.currentUser = null; }, signInWithCustomToken: async () => { dataAuth.currentUser = {}; } },
    './firebase': { auth, dataAuth }, './auth': { getUserId: () => auth.currentUser?.uid || guestId },
    './api': { apiPostJson: async () => { requests++; return { customToken: 'synthetic' }; } },
  }, { window: {} });
  await Promise.all([client.ensureDataSession(), client.ensureDataSession()]);
  assert.equal(requests, 1); assert.equal(auth.currentUser, null);
  auth.currentUser = { uid: 'alice' };
  assert.equal(await client.ensureDataSession(), 'login:alice'); assert.equal(requests, 2);
});
