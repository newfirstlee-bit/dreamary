// Runs real TypeScript modules with deterministic I/O doubles; no Firebase/AI calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => {
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console: { info() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, performance,
    Request, Response, ReadableStream, TextEncoder, AbortController, Blob,
    ...globals,
  }, { filename: file });
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('read cache: simultaneous readers share one request and a completed value', async () => {
  const { ReadCache } = load('src/lib/readCache.ts');
  const cache = new ReadCache(1000);
  let reads = 0;
  const read = async () => ++reads;
  const a = cache.get('owner:pair', read);
  assert.equal(a, cache.get('owner:pair', read));
  assert.equal(await a, 1);
  assert.equal(await cache.get('owner:pair', read), 1);
  assert.equal(reads, 1);
  assert.equal(await cache.get('other:pair', read), 2);
});

test('read cache: invalidation during flight cannot refill cache with an old value', async () => {
  const { ReadCache } = load('src/lib/readCache.ts');
  const cache = new ReadCache(1000);
  const old = deferred();
  const first = cache.get('pair', () => old.promise);
  cache.clear();
  assert.equal(await cache.get('pair', async () => 'new'), 'new');
  old.resolve('old');
  await first;
  assert.equal(await cache.get('pair', async () => 'wrong'), 'new');
});

test('read cache: TTL, bounded eviction, failure retry', async () => {
  let now = 0;
  const { ReadCache } = load('src/lib/readCache.ts', {}, { Date: { now: () => now } });
  const cache = new ReadCache(10, 1);
  await assert.rejects(cache.get('a', async () => { throw new Error('offline'); }));
  assert.equal(await cache.get('a', async () => 1), 1);
  now = 11;
  assert.equal(await cache.get('a', async () => 2), 2);
  await cache.get('b', async () => 3);
  assert.equal(await cache.get('a', async () => 4), 4);
});

test('character store: dedup, auth-mode separation, invalidation and late response', async () => {
  const reads = [];
  const create = init => {
    let state;
    const get = () => state;
    const set = update => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
    state = init(set, get);
    return { getState: get, setState: set };
  };
  const { useAppStore: store, invalidateCharacterStore } = load('src/store/useAppStore.ts', {
    zustand: { create }, '@/lib/db': { getTopics: async () => [] },
    '@/lib/firebase': { auth: { currentUser: null } },
    '@/lib/dataReadCache': { profileReadCache: { clear() {} } },
    '@/lib/ownership': { getCharactersWithGuestRecovery: () => { const request = deferred(); reads.push(request); return request.promise; } },
  });
  const old = store.getState().loadCharacters('a', false);
  const duplicate = store.getState().loadCharacters('a', false);
  assert.equal(reads.length, 1);
  const authenticated = store.getState().loadCharacters('a', true);
  assert.equal(reads.length, 2);
  reads[1].resolve(['signed-in']);
  await authenticated;
  reads[0].resolve([]);
  await Promise.all([old, duplicate]);
  assert.equal(store.getState().characters[0], 'signed-in');
  invalidateCharacterStore('a');
  const fresh = store.getState().loadCharacters('a', true);
  assert.equal(reads.length, 3);
  store.getState().clearStore();
  reads[2].resolve(['late']);
  await fresh;
  assert.equal(store.getState().characters, null);
});

test('saved diary: only authoritative result for this owner/pair/day, old server compatible', () => {
  const { savedDiaryForView } = load('src/lib/diaryResult.ts');
  const diary = { id: 'd', userId: 'u', characterId: 'c', dateString: '2026-09-09', userEntry: 'stored' };
  assert.equal(savedDiaryForView({ savedId: 'd', diary }, 'u', 'c', diary.dateString), diary);
  for (const identity of [['other', 'c', diary.dateString], ['u', 'other', diary.dateString], ['u', 'c', '2026-09-10']]) {
    assert.equal(savedDiaryForView({ savedId: 'd', diary }, ...identity), null);
  }
  assert.equal(savedDiaryForView({ reply: 'old API', savedId: 'd' }, 'u', 'c', diary.dateString), null);
});

test('image cache: concurrent requests download once, permanent 404 never retries', async () => {
  let reads = 0;
  const network = deferred();
  const cache = load('src/lib/imageCache.ts', {}, {
    window: { setTimeout, clearTimeout }, fetch: () => { reads++; return network.promise; },
  });
  const a = cache.downloadAndCacheImage('https://images.test/a');
  assert.equal(a, cache.downloadAndCacheImage('https://images.test/a'));
  network.resolve(new Response(new Blob(['image'], { type: 'image/png' })));
  assert.equal((await a).size, 5);
  assert.equal(reads, 1);
  const missing = load('src/lib/imageCache.ts', {}, {
    window: { setTimeout, clearTimeout }, fetch: async () => { reads++; return new Response(null, { status: 404 }); },
  });
  await assert.rejects(missing.downloadAndCacheImage('https://images.test/missing'), /404/);
  assert.equal(reads, 2);
});

test('image cache: stalled IndexedDB open falls back within the cache deadline', async () => {
  const cache = load('src/lib/imageCache.ts', {}, {
    window: { indexedDB: { open: () => ({}) } },
    setTimeout: callback => setTimeout(callback, 5),
  });
  assert.equal(await cache.readCachedImage('https://images.test/a'), null);
});

function pushFixture({ enabled = true, fail = false, disabledDuringRead = false } = {}) {
  let reads = 0, builds = 0, writes = 0, saved;
  const target = { get: async () => { reads++; return { exists: true, data: () => ({ enabled }) }; } };
  const firestore = {
    collection: () => ({ doc: () => target }),
    runTransaction: async action => action({
      get: async () => ({ exists: true, data: () => ({ enabled: !disabledDuringRead, candidates: { other: { nextTopicId: 'keep' } } }) }),
      set: (_ref, data) => { writes++; saved = data; },
    }),
  };
  const shared = {
    corsHeaders: {}, verifyFirebaseIdTokenRest: async () => 'u',
    getFirebaseAdminServices: () => ({ firestore }), getTodayKstDateString: () => '2026-09-09',
    getTomorrowKst8Pm: () => new Date(), toAdminTimestamp: value => value,
    buildDiaryPushCandidates: async (...args) => {
      builds++; assert.equal(args[4], 'c');
      if (fail) throw new Error('offline');
      return { c: { nextTopicId: 'next' } };
    },
  };
  const { handleDiaryPushComplete } = load('src/lib/server/diaryPushComplete.ts', {
    './pushShared': shared, 'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 1 } },
  });
  const run = () => handleDiaryPushComplete(new Request('https://app.test/api/push/diary-complete', {
    method: 'POST', headers: { authorization: 'Bearer mock' }, body: JSON.stringify({ characterId: 'c', dateString: '2026-09-09' }),
  }));
  return { run, stats: () => ({ reads, builds, writes, saved }) };
}
test('push off: target read only, no candidate reads or writes', async () => {
  const fixture = pushFixture({ enabled: false });
  assert.equal((await fixture.run()).status, 200);
  assert.deepEqual(fixture.stats(), { reads: 1, builds: 0, writes: 0, saved: undefined });
});
test('push on: updates just one candidate, preserves other pairs', async () => {
  const fixture = pushFixture();
  assert.equal((await fixture.run()).status, 200);
  const { saved, builds, writes } = fixture.stats();
  assert.equal(builds, 1); assert.equal(writes, 1);
  assert.equal(saved.candidates.other.nextTopicId, 'keep');
  assert.equal(saved.candidates.c.nextTopicId, 'next');
});
test('push failure and concurrent disable never write or re-enable notifications', async () => {
  const failed = pushFixture({ fail: true });
  assert.equal((await failed.run()).status, 500);
  assert.equal(failed.stats().writes, 0);
  const disabled = pushFixture({ disabledDuringRead: true });
  assert.equal((await disabled.run()).status, 200);
  assert.equal(disabled.stats().writes, 0);
});

test('dev and production push endpoints delegate to the same handler', () => {
  const handler = async () => new Response();
  const dev = load('src/app/api/push/diary-complete/route.ts', { '@/lib/server/diaryPushComplete': { handleDiaryPushComplete: handler } });
  const prod = load('netlify/functions/push-diary-complete.mts', { '../../src/lib/server/diaryPushComplete': { handleDiaryPushComplete: handler } });
  assert.equal(dev.POST, prod.default);
  assert.equal(dev.OPTIONS, prod.default);
});

test('performance traces preserve results/errors and never log payloads', async () => {
  const rows = [];
  const { measurePhase } = load('src/lib/performanceTrace.ts', {}, { console: { info: (_prefix, entry) => rows.push(entry) } });
  assert.equal(await measurePhase('diary.edit', 'save', async () => 'private body'), 'private body');
  const error = new Error('private body');
  await assert.rejects(measurePhase('diary.edit', 'save', async () => { throw error; }), value => value === error);
  assert.equal(rows[0].success, true); assert.equal(rows[1].success, false);
  assert.equal(JSON.stringify(rows).includes('private body'), false);
});

test('profile cache: successful edit invalidates cached data; login uses a different key', async () => {
  const { ReadCache } = load('src/lib/readCache.ts');
  const auth = { currentUser: null };
  let profile = { id: 'c', name: 'before' }, reads = 0;
  const db = load('src/lib/db.ts', {
    './appCache': { clearUserCache: () => {} },
    './characterOrder': { copyRecentCharacterOrder: () => {} },
    './productLimits': { CHAT_PAGE_SIZE: 30 },
    './firebase': { auth, db: {} },
    './auth': { getStoredGuestUserId: () => 'guest-uuid' },
    './guestSession': { getGuestSession: async () => 'guest-token' },
    './api': { apiPostJson: async () => ({}) },
    './dataReadCache': { profileReadCache: new ReadCache(60000), topicReadCache: new ReadCache(300000) },
    './diaryIdentity': { getDiaryDailyDocId: () => 'daily' },
    './dataFirestore': {
      doc: () => 'c',
      getDoc: async () => { reads++; return { exists: () => true, data: () => profile }; },
      setDoc: async (_ref, value) => { profile = value; },
    },
  });
  await Promise.all([db.getUserProfile('c'), db.getUserProfile('c')]);
  assert.equal(reads, 1);
  await db.saveUserProfile({ id: 'c', name: 'after' });
  assert.equal((await db.getUserProfile('c')).name, 'after');
  assert.equal(reads, 2);
  auth.currentUser = { uid: 'signed-in' };
  await db.getUserProfile('c');
  assert.equal(reads, 3);
});

function diaryFixture(existing) {
  let stored = existing, generations = 0, writes = 0;
  const snapshot = () => ({ exists: !!stored, data: () => stored });
  const characterRef = { get: async () => ({ exists: true, data: () => ({ userId: 'u' }) }) };
  const ref = { get: async () => snapshot() };
  const db = {
    collection: name => ({ doc: () => name === 'characters' ? characterRef : ref }),
    runTransaction: async action => action({ get: async target => target.get(), set: (_ref, diary) => { stored = diary; writes++; } }),
  };
  const { default: handler } = load('netlify/functions/diary.ts', {
    // Quota/idempotency transactions are exercised by test-security; this fixture isolates diary persistence.
    '../../src/lib/server/operationalGuard': { readJsonBody: req => req.json(), validateAiInput() {}, reserveAiRequest: async () => ({ signal: new AbortController().signal }), assertAiPermit: async () => {}, finishAiRequest: async () => {} },
    '../../src/lib/firebase-admin': { adminDb: db }, '../shared/cors': { corsHeaders: {} },
    '../../src/lib/diaryIdentity': { getDiaryDailyDocId: () => 'daily' },
    '../../src/lib/koreanJosa': { applyKoreanJosa: value => value, formatKoreanNameTemplate: value => value },
    '../../src/lib/aiReplyGuard': { findUnexpectedLanguageSegments: () => [], getKoreanOnlyRetryInstruction: () => '' },
    '../../src/lib/performanceTrace': { measurePhase: (_operation, _phase, action) => action() },
    '../../src/lib/server/guestIdentity': { requireDataOwner: async () => ({ uid: 'u', kind: 'firebase' }), assertGuestActive: async () => {}, securityErrorResponse: () => new Response(null, { status: 500 }) },
    '../../src/lib/server/diaryAuthentication': { DiaryAuthenticationError: Error },
    '../../src/lib/server/diaryDate': { currentDiaryDate: () => '2026-09-09' },
  }, {
    process: { env: { OPENROUTER_API_KEY: 'test-only' } },
    fetch: async () => { generations++; return Response.json({ choices: [{ message: { content: '테스트 답변' }, finish_reason: 'stop' }] }); },
  });
  const run = () => handler(new Request('https://app.test/api/diary', {
    method: 'POST', body: JSON.stringify({ character: { id: 'c', name: '캐릭터' }, topic: '주제', topicId: 't', userEntry: 'new input', userId: 'u', dateString: '2026-09-09' }),
  }));
  return { run, stats: () => ({ stored, generations, writes }) };
}

test('diary server: response contains the committed diary, duplicate returns stored input', async () => {
  const fixture = diaryFixture();
  const first = await (await fixture.run()).json();
  assert.equal(first.created, true);
  assert.equal(first.diary.id, first.savedId);
  assert.equal(first.diary.charReply, '테스트 답변');
  assert.equal(fixture.stats().writes, 1);
  assert.equal(first.diary.userEntry, fixture.stats().stored.userEntry);
  const existing = { ...first.diary, userEntry: 'authoritative existing input' };
  const duplicate = diaryFixture(existing);
  const second = await (await duplicate.run()).json();
  assert.equal(second.created, false);
  assert.equal(second.diary.userEntry, existing.userEntry);
  assert.equal(duplicate.stats().generations, 0);
  assert.equal(duplicate.stats().writes, 0);
});

test('image component: remote URL renders immediately, cached errors recover, only owned blobs revoke', async () => {
  let cursor = 0;
  const slots = [], effects = [], cachedReads = [], warmed = [], revoked = [];
  const hooks = {
    default: { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment' },
    useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }];
    },
    useRef: initial => {
      const index = cursor++;
      return slots[index] ||= { current: initial };
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      const old = slots[index];
      if (old && old.deps.every((value, i) => value === deps[i])) return;
      effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
    },
  };
  const { default: Image } = load('src/components/ResilientImage.tsx', {
    react: hooks, '@/lib/imageDiagnostics': { reportImageLoadFailure() {} },
    '@/lib/imageCache': {
      readCachedImage: () => { const request = deferred(); cachedReads.push(request); return request.promise; },
      warmImageCache: url => warmed.push(url),
    },
  }, { URL: { createObjectURL: () => 'blob:owned', revokeObjectURL: value => revoked.push(value) } });
  const render = src => {
    cursor = 0;
    const output = Image({ src, alt: '', kind: 'profile', fallback: 'placeholder' });
    while (effects.length) effects.shift()();
    return output;
  };
  const first = render('https://images.test/a');
  assert.equal(first.props.src, 'https://images.test/a');
  assert.deepEqual(warmed, ['https://images.test/a']);
  const second = render('https://images.test/b');
  assert.equal(second.props.src, 'https://images.test/b');
  second.props.onError();
  cachedReads[0].resolve(new Blob(['cached']));
  await Promise.resolve();
  assert.equal(render('https://images.test/b').props.src, 'blob:owned');
  assert.equal(render('blob:caller-owned').props.src, 'blob:caller-owned');
  render('/local.png');
  assert.deepEqual(revoked, ['blob:owned']);
});

test('chat history: 100/1,000/10,000 records keep a 30-document window and tie-safe older cursor', async () => {
  for (const size of [100, 1000, 10000]) {
    const rows = Array.from({ length: size }, (_, i) => ({ id: String(i).padStart(5, '0'), userId: 'u', characterId: 'c', createdAt: Math.floor(i / 3), role: 'user', content: 'synthetic' }));
    const caps = []; let listenerClosed = false;
    const firestore = {
      collection: (_db, name) => name, where: (...args) => ({ kind: 'where', args }),
      orderBy: (...args) => ({ kind: 'order', args }), limit: n => ({ kind: 'limit', n }), startAfter: doc => ({ kind: 'cursor', doc }),
      query: (name, ...conditions) => ({ name, conditions }),
      getDocs: async ({ conditions }) => {
        const cap = conditions.find(c => c.kind === 'limit')?.n; assert.equal(cap, 30); caps.push(cap);
        let values = [...rows];
        for (const { args } of conditions.filter(c => c.kind === 'where')) values = values.filter(v => v[args[0]] === args[2]);
        values.sort((a,b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        const cursor = conditions.find(c => c.kind === 'cursor')?.doc;
        if (cursor) values = values.slice(values.findIndex(v => v.id === cursor.id) + 1);
        const docs = values.slice(0,cap).map(value => ({ id: value.id, data: () => value }));
        return { docs, size: docs.length, empty: !docs.length };
      },
      onSnapshot: (query, callback) => { void firestore.getDocs(query).then(callback); return () => { listenerClosed = true; }; },
    };
    const { ReadCache } = load('src/lib/readCache.ts');
    const db = load('src/lib/db.ts', {
      './productLimits': { CHAT_PAGE_SIZE: 30 }, './firebase': { auth: {}, db: {} }, './auth': {}, './guestSession': {}, './appCache': {}, './characterOrder': {}, './api': {},
      './diaryIdentity': {}, './dataFirestore': firestore,
      './dataReadCache': { profileReadCache: new ReadCache(1000), topicReadCache: new ReadCache(1000) },
    });
    const first = await db.getChatMessagesPage('u','c');
    const second = await db.getChatMessagesPage('u','c', first.nextCursor);
    assert.equal(first.messages.length, 30); assert.equal(second.messages.length, 30);
    assert.equal(new Set([...first.messages, ...second.messages].map(m => m.id)).size, 60);
    assert.equal(first.messages.at(-1).id, String(size - 1).padStart(5,'0'));
    const close = db.subscribeChatMessages('u','c', messages => assert.equal(messages.length,30));
    await Promise.resolve(); close(); assert.equal(listenerClosed, true); assert.deepEqual(caps, [30,30,30]);
  }
});

test('manual backup waits for server completion before retiring source and invalidates both owners', async () => {
  const events = []; let page = 0;
  const client = load('src/lib/db.ts', {
    './productLimits': {}, './firebase': {}, './dataReadCache': {}, './dataFirestore': {}, './diaryIdentity': {}, './guestSession': {},
    './auth': { retireGuestIdentity: id => events.push('retire:' + id) },
    './appCache': { clearUserCache: id => events.push('clear:' + id) },
    './characterOrder': { copyRecentCharacterOrder: (a,b) => events.push('order:' + a + ':' + b) },
    './api': { apiPostJson: async (_url, body) => { assert.equal(body.progressVersion, 1); assert.equal(events.some(e => e.startsWith('retire:')), false); return { done: ++page === 2, sourceUUID: 'guest', stage: page === 1 ? 'characters' : 'complete' }; } },
  });
  await client.migrateGuestBackup('TESTCODE', 'alice', stage => events.push(stage));
  assert.equal(page, 2);
  assert.deepEqual(events, ['diaries', 'characters', 'complete', 'clear:guest', 'clear:alice', 'order:guest:alice', 'retire:guest']);
});

test('list recovery respects pending explicit backup code without starting an automatic transfer', async () => {
  let transfers = 0;
  const recovery = load('src/lib/ownership.ts', {
    './db': { getCharactersByUser: async () => [], prepareOwnershipMigration: () => { transfers++; throw new Error(); } },
    './appCache': {}, './characterOrder': {}, './auth': { getStoredGuestUserId: () => 'guest' },
  }, { window: {}, localStorage: { getItem: key => key === 'backupCode' ? 'TESTCODE' : String(Date.now()) } });
  assert.equal((await recovery.getCharactersWithGuestRecovery('alice', true)).length, 0);
  assert.equal(transfers, 0);
});
