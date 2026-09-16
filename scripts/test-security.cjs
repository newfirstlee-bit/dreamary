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
  const doc = key => ({ key, id: key.split('/').at(-1), path: key, get: async () => { stats.reads++; return snapshot(key, rows.get(key)); },
    set: async value => { rows.set(key, structuredClone(value)); stats.writes++; },
    update: async value => { rows.set(key, { ...rows.get(key), ...structuredClone(value) }); stats.writes++; },
    delete: async () => { rows.delete(key); stats.writes++; },
  });
  const query = (name, filters = [], cap, orders = [], cursor = null) => ({
    where: (field, op, value) => query(name, [...filters, [field, op, value]], cap, orders, cursor),
    limit: value => query(name, filters, value, orders, cursor),
    orderBy: (field, direction = 'asc') => query(name, filters, cap, [...orders, [field, direction]], cursor),
    startAfter: (...values) => query(name, filters, cap, orders, values),
    get: async () => {
      assert.ok(cap && cap <= 20, 'All server queries must be bounded');
      const fieldValue = ([key, data], field) => field === '__name__' ? key.split('/').at(-1) : data[field];
      const compare = (a, b) => { for (let i = 0; i < orders.length; i++) { const [field, dir] = orders[i], left = fieldValue(a, field), right = Array.isArray(b) && b.length === 2 && typeof b[1] === 'object' ? fieldValue(b, field) : b[i]; if (left !== right) return (left < right ? -1 : 1) * (dir === 'desc' ? -1 : 1); } return 0; };
      const entries = [...rows].filter(([key, value]) => key.startsWith(name + '/') && filters.every(([field, op, expected]) => op === '==' ? value[field] === expected : op === '<=' ? value[field] <= expected : false))
        .sort(compare).filter(entry => !cursor || compare(entry, cursor) > 0).slice(0, cap);
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
  const errorLogs = [];
  let generations = 0;
  const load = file => {
    file = path.resolve(root, file);
    if (!path.extname(file)) file += '.ts';
    if (file.endsWith('.json')) return { default: JSON.parse(fs.readFileSync(file, 'utf8')) };
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const requireLocal = name => {
      if (name === 'jose') return { ...jose, createRemoteJWKSet: () => jose.createLocalJWKSet({ keys: [jwk] }) };
      if (name === 'node:crypto') return nodeCrypto;
      if (name === 'node:http2') return require(name);
      if (name === 'firebase-admin/app') return { getApps: () => [{}] };
      if (name === 'firebase-admin/messaging') return { getMessaging: () => ({}) };
      if (name === 'firebase-admin/firestore') return { Timestamp: { now: () => Date.now(), fromMillis: value => value, fromDate: date => date.getTime() }, FieldValue: { serverTimestamp: () => 123 } };
      if (name === 'firebase-admin/auth') return { getAuth: () => ({
        createCustomToken: async (uid, claims) => JSON.stringify({ uid, claims }),
        deleteUser: async () => {},
        getUser: async () => {
        if (env.AUTH_ERROR) throw Object.assign(new Error('private request details'), { code: env.AUTH_ERROR });
        if (env.REGISTERED_UUID) return { uid: guestId };
        throw Object.assign(new Error(), { code: 'auth/user-not-found' });
      } }) };
      const resolved = path.resolve(path.dirname(file), name);
      if (resolved === path.join(root, 'src/lib/firebase-admin')) return { adminDb: db };
      if (name.startsWith('.')) return load(resolved);
      throw new Error('Unexpected dependency ' + name);
    };
    vm.runInNewContext(compiled, { module, exports: module.exports, require: requireLocal,
      process: { env }, URL, Request, Response, Buffer, TextEncoder, TextDecoder, ReadableStream, AbortController, AbortSignal, crypto: nodeCrypto,
      setTimeout, clearTimeout, setInterval, clearInterval, performance,
      console: { log() {}, info() {}, error(...args) { errorLogs.push(args); }, warn() {} },
      fetch: async () => { generations++; env.ON_FETCH?.(); if (env.FETCH_BARRIER) await env.FETCH_BARRIER;
        if (env.CHAT_STREAM) return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: '테스트 답변' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n');
        return Response.json({ choices: [{ message: { content: '테스트 답변' }, finish_reason: 'stop' }] });
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
  return { db, load, loginToken, run, bind, env, errorLogs, generations: () => generations };
}

test('Guest diagnostics identify failure stages without logging credentials or changing rejection behavior', async () => {
  for (const stage of ['token-signing', 'credential-read', 'account-check', 'credential-transaction']) {
    const f = await fixture({}, stage === 'account-check' ? { AUTH_ERROR: 'auth/insufficient-permission' } : {});
    const failure = () => { throw Object.assign(new Error('private request details ' + secret), { code: 7 }); };
    if (stage === 'token-signing') f.load('src/lib/server/guestIdentity.ts').issueGuestSession = failure;
    if (stage === 'credential-read') f.db.collection = failure;
    if (stage === 'credential-transaction') f.db.runTransaction = failure;
    const response = await f.run('guest-session', { userId: guestId, secret });
    assert.equal(response.status, 500);
    assert.equal(f.db.stats.writes, 0);
    assert.equal(f.errorLogs.length, 1);
    assert.equal(f.errorLogs[0][1].stage, stage);
    assert.equal(f.errorLogs[0][1].code, stage === 'account-check' ? 'auth/insufficient-permission' : 'permission-denied');
    for (const output of [JSON.stringify(f.errorLogs), await response.text()]) {
      for (const privateValue of [secret, guestId, 'private request details']) assert.equal(output.includes(privateValue), false);
    }
  }
  const f = await fixture();
  await f.bind();
  assert.deepEqual(f.errorLogs, []);
  assert.equal((await f.run('guest-session', { userId: guestId, secret: 'ef'.repeat(32) })).status, 403);
  assert.deepEqual(f.errorLogs, []);
  f.load('src/lib/server/guestSessionDiagnostics.ts').logGuestSessionFailure({ code: secret, name: secret, message: secret }, 'account-check');
  assert.equal(f.errorLogs[0][1].code, 'unknown');
  assert.equal(f.errorLogs[0][1].kind, 'unknown');
  assert.equal(JSON.stringify(f.errorLogs).includes(secret), false);
});

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
  assert.equal(f.db.stats.reads, 2); // account deletion state + diary owner
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
    './firebase': { auth },
    './auth': { getStoredGuestUserId: () => guestId },
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
    assert.equal(new Headers(requests[0].headers).get('Authorization'), 'Bearer current-token');
    assert.equal('authorization' in requests[0].headers, false);
    assert.equal(typeof requests[0].data.timezoneOffsetMinutes, 'number');
  }
});

test('client guest key: concurrent requests share registration; retry after lost response retains key', async () => {
  const storage = new Map(); let calls = 0; const sent = [];
  const client = loadClient('src/lib/guestSession.ts', {
    './firebase': { auth: { currentUser: null } },
    './auth': { getStoredGuestUserId: () => guestId },
    './guestPersistence': {
      readGuestSecret: async userId => storage.get('dreamary_guest_secret_' + userId) || null,
      persistGuestSecret: async () => undefined,
    },
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
  let done = false;
  for (let page = 0; page < 3 && !done; page++) done = (await (await f.run('character-delete', body, auth)).json()).done;
  assert.equal(done, true);
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
  const jobs = f.load('src/lib/server/dataJobs.ts');
  const ref = await jobs.enqueueDataJob(f.db, 'account-delete', 'alice');
  let done = false;
  for (let step = 0; step < 60 && !done; step++) done = await jobs.advanceDataJob(f.db, ref);
  assert.equal(done, true);
  assert.equal(f.db.rows.size, 3); // includes the durable completion receipt
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

test('pair creation: concurrent requests cannot pass five; replay is idempotent and old pairs survive', async () => {
  const f = await fixture(); const auth = 'Bearer ' + await f.loginToken();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => f.run('character-create', { character: { id: 'c' + i, name: '페어', userId: 'alice' } }, auth)));
  assert.equal(results.filter(r => r.status === 200).length, 5);
  assert.equal(results.filter(r => r.status === 409).length, 3);
  assert.equal((await f.run('character-create', { character: { id: 'c0', name: '페어', userId: 'alice' } }, auth)).status, 200);
  f.db.rows.set('characters/legacy', { userId: 'alice' });
  assert.equal((await f.run('character-create', { character: { id: 'new', name: '페어', userId: 'alice' } }, auth)).status, 409);
  assert.ok(f.db.rows.has('characters/legacy'));
});

test('AI guard: concurrent same request runs once; daily cap and malformed input reject before provider', async () => {
  const f = await fixture({ 'characters/c': { userId: 'alice' } }, { CHAT_STREAM: 'true', AI_USER_DAILY_ATTEMPT_LIMIT: '1' });
  const auth = 'Bearer ' + await f.loginToken();
  const body = { userId: 'alice', character: { id: 'c' }, messages: [], requestId: 'one', preferJsonResponse: true };
  const responses = await Promise.all([f.run('chat', body, auth), f.run('chat', body, auth)]);
  const bodies = await Promise.all(responses.map(r => r.json()));
  assert.equal(f.generations(), 1);
  assert.ok(bodies.some(b => b.savedId));
  assert.equal((await f.run('chat', { ...body, requestId: 'two' }, auth)).status, 429);
  assert.equal((await f.run('chat', { ...body, messages: [{ role: 'system', content: 'bypass' }] }, auth)).status, 400);
  assert.equal((await f.run('chat', { ...body, messages: [{ role: 'user', content: 'x'.repeat(4001) }] }, auth)).status, 400);
  const replay = await (await f.run('chat', body, auth)).json();
  assert.ok(replay.savedId); assert.equal(f.generations(), 1);
});

test('AI guard: reservation rechecks saved result to close preflight race, expired lease cannot save', async () => {
  const f = await fixture(); const guard = f.load('src/lib/server/operationalGuard.ts');
  const ref = f.db.collection('chatMessages').doc('result');
  await ref.set({ userId: 'alice', content: 'already committed' });
  const cached = await guard.reserveAiRequest(f.db, 'alice', 'request', 1, ref);
  assert.equal(cached.savedRecord.content, 'already committed');
  assert.equal([...f.db.rows.keys()].filter(k => k.startsWith('operationUsage')).length, 0);
  const permit = await guard.reserveAiRequest(f.db, 'alice', 'next');
  await permit.requestRef.update({ token: 'new worker' });
  await assert.rejects(f.db.runTransaction(tx => guard.assertAiPermit(tx, permit)), error => error.status === 409);
});

test('chat stream: truncated/length/error frames never count as complete', async () => {
  const f = await fixture(); const { parseOpenRouterStream } = f.load('netlify/functions/chat.ts');
  const collect = async data => { let value = ''; for await (const chunk of parseOpenRouterStream(new Response(data).body)) value += chunk; return value; };
  const frame = 'data: {"choices":[{"delta":{"content":"답변"}}]}\n\n';
  await assert.rejects(collect(frame));
  await assert.rejects(collect(frame + 'data: [DONE]\n'));
  await assert.rejects(collect(frame + 'data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n'));
  await assert.rejects(collect(frame + 'data: {"error":{"message":"failed"}}\n'));
  assert.equal(await collect(frame + 'data: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n'), '답변');
});

test('chat deletion: worker resumes after client exit; completed replay cannot clear new chat', async () => {
  const f = await fixture({ 'characters/c': { userId: 'alice' } });
  for (let i = 0; i < 43; i++) f.db.rows.set('chatMessages/m' + i, { userId: 'alice', characterId: 'c' });
  const auth = 'Bearer ' + await f.loginToken(); const body = { userId: 'alice', characterId: 'c', requestId: 'clear-once' };
  assert.equal((await (await f.run('chat-delete', body, auth)).json()).done, false);
  const key = [...f.db.rows.keys()].find(k => k.startsWith('dataJobs/'));
  const jobs = f.load('src/lib/server/dataJobs.ts'), ref = f.db.collection('dataJobs').doc(key.split('/')[1]);
  assert.equal(await jobs.advanceDataJob(f.db, ref), false);
  assert.equal(await jobs.advanceDataJob(f.db, ref), true);
  f.db.rows.set('chatMessages/new', { userId: 'alice', characterId: 'c' });
  assert.equal((await (await f.run('chat-delete', body, auth)).json()).done, true);
  assert.equal(f.db.rows.get('characters/c').chatClearing, false);
  assert.ok(f.db.rows.has('chatMessages/new'));
});

test('account job: interrupted sources, images, Auth cleanup survive bounded worker restarts', async () => {
  const f = await fixture({
    ['guestCredentials/' + guestId]: { migrationTarget: 'alice' },
    'characters/c': { userId: guestId }, 'users/c': { name: 'profile' },
    'accounts/alice': { id: 'alias' }, 'imageUploads/image': { uid: 'alice', deleteUrl: 'https://ibb.co/synthetic/private' },
    'diaries/bob': { userId: 'bob' },
  });
  for (let i = 0; i < 45; i++) f.db.rows.set('diaries/d' + i, { userId: 'alice' });
  const jobs = f.load('src/lib/server/dataJobs.ts');
  const ref = await jobs.enqueueDataJob(f.db, 'account-delete', 'alice', '', '', async tx => tx.set(f.db.collection('accountStates').doc('alice'), { deleting: true }));
  let done = false;
  for (let step = 0; step < 60 && !done; step++) done = await jobs.advanceDataJob(f.db, ref);
  assert.equal(done, true);
  assert.deepEqual(f.db.rows.get('guestCredentials/' + guestId), { retired: true });
  assert.ok(f.db.rows.has('imageDeletionQueue/image'));
  for (const key of ['characters/c', 'users/c', 'accounts/alice', 'imageUploads/image', 'diaries/d44']) assert.equal(f.db.rows.has(key), false, key);
  assert.ok(f.db.rows.has('diaries/bob'));
});

test('push: 201 due targets are drained, success is not repeated, legacy devices have another page', async () => {
  const f = await fixture(); const queue = f.load('src/lib/server/diaryPushQueue.ts');
  for (let i = 0; i < 201; i++) {
    f.db.rows.set('diaryPushTargets/u' + i, { enabled: true, nextNotifyAt: 1, locale: 'ko' });
    f.db.rows.set('pushDevices/d' + i, { uid: 'u' + i, diaryPushEnabled: true, pushToken: 'token' + i, platform: 'android' });
  }
  let sent = 0; const messaging = { send: async () => { sent++; return 'ok'; } };
  const result = await queue.drainDiaryPushQueue(f.db, messaging, 18000);
  assert.equal(result.targets, 201); assert.equal(sent, 201);
  assert.equal((await queue.drainDiaryPushQueue(f.db, messaging)).targets, 0);
  f.db.rows.set('diaryPushTargets/legacy', { enabled: true, nextNotifyAt: 1 });
  for (let i = 0; i < 8; i++) f.db.rows.set('pushDevices/legacy' + i, { uid: 'legacy', diaryPushEnabled: true, pushToken: 'l' + i, platform: 'android' });
  const ref = f.db.collection('diaryPushTargets').doc('legacy');
  assert.equal((await queue.processDiaryPushTarget(f.db, messaging, ref)).sent, 5);
  await ref.update({ nextNotifyAt: 1 });
  assert.equal((await queue.processDiaryPushTarget(f.db, messaging, ref)).sent, 3);
});

test('push: transient failure retries only failed device; invalid tokens and deleted accounts stop', async () => {
  const f = await fixture({ 'diaryPushTargets/u': { enabled: true, nextNotifyAt: 1 } });
  for (const id of ['good', 'retry', 'invalid']) f.db.rows.set('pushDevices/' + id, { uid: 'u', diaryPushEnabled: true, pushToken: id, platform: 'android' });
  const calls = [], queue = f.load('src/lib/server/diaryPushQueue.ts'), ref = f.db.collection('diaryPushTargets').doc('u');
  let failing = true;
  const messaging = { send: async ({ token }) => { calls.push(token); if (token === 'invalid') throw { code: 'messaging/registration-token-not-registered' }; if (token === 'retry' && failing) throw new Error('offline'); } };
  assert.equal((await queue.processDiaryPushTarget(f.db, messaging, ref)).failed, 1);
  assert.equal(f.db.rows.get('pushDevices/invalid').diaryPushEnabled, false);
  failing = false; await ref.update({ nextNotifyAt: 1 });
  assert.equal((await queue.processDiaryPushTarget(f.db, messaging, ref)).sent, 1);
  assert.equal(calls.filter(c => c === 'good').length, 1);
  f.db.rows.set('accountStates/u', { deleting: true }); await ref.update({ nextNotifyAt: 1 });
  assert.equal((await queue.processDiaryPushTarget(f.db, messaging, ref)).sent, 0);
  assert.equal(f.db.rows.get('diaryPushTargets/u').enabled, false);
});

test('deletion: a second clear cannot race the active job; a deleted pair ID cannot be recreated', async () => {
  const f = await fixture({ 'characters/c': { userId: 'alice' } });
  for (let i = 0; i < 25; i++) f.db.rows.set('chatMessages/m' + i, { userId: 'alice', characterId: 'c' });
  const auth = 'Bearer ' + await f.loginToken(), body = { userId: 'alice', characterId: 'c', requestId: 'first' };
  assert.equal((await f.run('chat-delete', body, auth)).status, 200);
  assert.equal((await f.run('chat-delete', { ...body, requestId: 'second' }, auth)).status, 409);
  for (let i = 0; i < 4; i++) await f.run('character-delete', body, auth);
  assert.equal((await f.run('character-create', { character: { id: 'c', name: 'replay', userId: 'alice' } }, auth)).status, 409);
});

test('protocol: default accepts previous clients; explicit minimum blocks old mutations before DB reads', async () => {
  const f = await fixture({}, { MIN_CLIENT_PROTOCOL: '1' });
  const body = { userId: 'alice', character: { id: 'c' }, messages: [] }, auth = 'Bearer ' + await f.loginToken();
  assert.equal((await f.run('chat', body, auth)).status, 426);
  assert.equal(f.db.stats.reads, 0);
  assert.equal((await f.run('chat', body, auth, { 'X-Client-Protocol': '1' })).status, 403);
});

test('initial ping: the real colon request ID remains compatible and can run again after clearing', async () => {
  const f = await fixture({ 'characters/c': { userId: 'alice' } }, { CHAT_STREAM: 'true' });
  const auth = 'Bearer ' + await f.loginToken(), body = { userId: 'alice', character: { id: 'c' }, isFirstPing: true, messages: [], requestId: 'initial-ping:alice:c' };
  const first = await (await f.run('chat', body, auth)).json(); assert.ok(first.savedId);
  assert.equal((await (await f.run('chat-delete', { userId: 'alice', characterId: 'c', requestId: 'clear' }, auth)).json()).done, true);
  const second = await (await f.run('chat', body, auth)).json(); assert.ok(second.savedId);
  assert.notEqual(first.savedId, second.savedId); assert.equal(f.generations(), 2);
});

test('chat clear fences an AI generation that finishes after clearing has completed', async () => {
  let release, entered;
  const barrier = new Promise(resolve => { release = resolve; });
  const called = new Promise(resolve => { entered = resolve; });
  const f = await fixture({ 'characters/c': { userId: 'alice' } }, { CHAT_STREAM: 'true', FETCH_BARRIER: barrier, ON_FETCH: entered });
  const auth = 'Bearer ' + await f.loginToken();
  const response = f.run('chat', { userId: 'alice', character: { id: 'c' }, messages: [], preferJsonResponse: true, requestId: 'in-flight' }, auth);
  await called;
  assert.equal((await (await f.run('chat-delete', { userId: 'alice', characterId: 'c', requestId: 'clear' }, auth)).json()).done, true);
  release(); const result = await (await response).json(); assert.ok(result.error);
  assert.equal([...f.db.rows.keys()].filter(key => key.startsWith('chatMessages/')).length, 0);
});

test('guest completion proof retires only the verified completed guest, never pending, rejected or logged-in identities', async () => {
  for (const [state, loggedIn, reject, expected] of [['complete', false, false, 1], ['pending', false, false, 0], [null, false, true, 0], ['complete', true, false, 0]]) {
    let retired = 0;
    const client = loadClient('src/lib/guestSession.ts', {
      './firebase': { auth: { currentUser: loggedIn ? { uid: 'alice' } : null } },
      './auth': { getStoredGuestUserId: () => guestId, retireGuestIdentity: id => { assert.equal(id, guestId); retired++; } },
      './guestPersistence': { readGuestSecret: async () => secret, persistGuestSecret: async () => undefined },
      './api': { apiPostJson: async () => {
        if (reject) throw new Error('wrong secret');
        return { token: 'verified', expiresAt: Date.now() + 900000, migrationState: state };
      } },
    }, { localStorage: { getItem: () => secret } });
    if (reject || expected) await assert.rejects(client.getGuestSession(guestId));
    else assert.equal(await client.getGuestSession(guestId), 'verified');
    assert.equal(retired, expected);
  }
});

test('backup progress advances bounded pages, keeps characters last, and proves complete on same-key reconnect', async () => {
  const f = await fixture(); const token = await f.bind();
  for (let i = 0; i < 45; i++) f.db.rows.set('diaries/p' + i, { userId: guestId });
  f.db.rows.set('characters/progress', { userId: guestId });
  const backup = await (await f.run('backup-generate', { sourceUUID: guestId }, 'Guest ' + token)).json();
  const payload = { code: backup.code, uid: 'alice', progressVersion: 1 };
  const auth = 'Bearer ' + await f.loginToken();
  const first = await (await f.run('backup-migrate', payload, auth)).json();
  assert.equal(first.done, false); assert.equal(first.stage, 'chatMessages');
  assert.equal(f.db.rows.get('characters/progress').userId, guestId);
  assert.equal([...f.db.rows].filter(([k,v]) => k.startsWith('diaries/') && v.userId === 'alice').length, 45);
  const second = await (await f.run('backup-migrate', payload, auth)).json();
  assert.equal(second.done, true); assert.equal(second.stage, 'complete');
  assert.equal(f.db.rows.get('characters/progress').userId, 'alice');
  const reconnect = await f.run('guest-session', { userId: guestId, secret });
  assert.equal((await reconnect.json()).migrationState, 'complete');
  assert.equal((await f.run('guest-session', { userId: guestId, secret: 'ef'.repeat(32) })).status, 403);
  assert.equal((await f.run('data-session', { userId: guestId }, 'Guest ' + token)).status, 403);
  assert.equal((await (await f.run('backup-migrate', payload, auth)).json()).done, true);
});

test('password recovery allows client protocol preflight and never mutates credentials without mail configuration', async () => {
  let reads = 0, updates = 0, sends = 0, events = [];
  const db = { collection: () => ({ where() { return this; }, limit(n) { assert.equal(n, 1); return this; }, get: async () => { reads++; return { empty: false, docs: [{ id: 'test-user' }] }; } }) };
  const make = (enabled, rejectMail = false) => loadClient('netlify/functions/reset-password.mts', {
    '../shared/cors': { corsHeaders: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Protocol' } },
    resend: { Resend: class { emails = { send: async data => { sends++; events.push('send'); assert.equal(data.from, 'sender@example.test'); return { error: rejectMail ? { message: 'recipient blocked' } : null }; } }; } },
    'google-auth-library': { GoogleAuth: class { async getClient() { return { getAccessToken: async () => ({ token: 'fake-token' }) }; } } },
    'firebase-admin/app': { getApps: () => [{}] },
    'firebase-admin/firestore': { getFirestore: () => db },
  }, { process: { env: { ...(enabled ? { RESEND_API_KEY: 'fake', RESEND_AUTH_FROM: 'sender@example.test' } : {}), FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'test' }) } },
    fetch: async () => { updates++; events.push('update'); return Response.json({}); }, console: { error() {}, warn() {} } }).default;
  const request = () => new Request('https://test.invalid/reset', { method: 'POST', body: JSON.stringify({ id: 'test', email: 'recipient@example.test' }) });
  const disabled = make(false);
  assert.equal((await disabled(request())).status, 503);
  assert.deepEqual([reads, updates, sends], [0,0,0]);
  const preflight = await disabled(new Request('https://test.invalid/reset', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204); assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /X-Client-Protocol/);
  assert.equal((await make(true)(request())).status, 200);
  assert.deepEqual([reads, updates, sends], [1,1,1]); assert.deepEqual(events, ['send', 'update']);
  const updatesBeforeRejectedMail = updates;
  assert.equal((await make(true, true)(request())).status, 503);
  assert.equal(updates, updatesBeforeRejectedMail);
});

test('password recovery screen uses the canonical production mail function', () => {
  const source = fs.readFileSync(path.join(root, 'src/app/(auth)/reset-password/page.tsx'), 'utf8');
  assert.match(source, /apiPostJson\('\/api\/auth\/reset-password'/);
  assert.doesNotMatch(source, /\.netlify\/functions\/reset-password/);
  const route = fs.readFileSync(path.join(root, 'src/app/api/auth/reset-password/route.ts'), 'utf8');
  assert.match(route, /netlify\/functions\/auth-reset-password/);
  assert.match(route, /export const POST = handler/);
  assert.match(route, /export const OPTIONS = handler/);
});

test('canonical password recovery never changes credentials before mail acceptance', () => {
  const source = fs.readFileSync(path.join(root, 'netlify/functions/auth-reset-password.ts'), 'utf8');
  assert.ok(source.indexOf('resend.emails.send') < source.indexOf('adminAuth.updateUser'));
  assert.match(source, /auth\.mailDeliveryFailed/);
});
