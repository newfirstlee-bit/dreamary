// Run ONLY against the explicit demo emulator. This script never loads .env,
// service credentials, the deployed rules, or a production Firebase project.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase/app');
const sdk = require('firebase/firestore');
sdk.setLogLevel('silent'); // Permission denials below are expected assertions.
const apps = [], databases = [];
const project = 'demo-dreamary-security';
const base = 'http://127.0.0.1:8080/v1/projects/' + project + '/databases/(default)/documents/';
const suffix = require('node:crypto').randomUUID();
const alice = 'alice-' + suffix, bob = 'bob-' + suffix, guest = 'guest-' + suffix;
function client(uid, claims) {
  const app = initializeApp({ projectId: project, apiKey: 'demo-only', appId: 'demo-only' }, 'rules-' + apps.length);
  apps.push(app);
  const db = sdk.getFirestore(app); databases.push(db);
  sdk.connectFirestoreEmulator(db, '127.0.0.1', 8080, uid ? { mockUserToken: { sub: uid, user_id: uid, ...(claims || {}) } } : {});
  return db;
}
function encode(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'boolean') return { booleanValue: value };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
}
async function seed(path, data) {
  const response = await fetch(base + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])) }) });
  assert.equal(response.status, 200, await response.text());
}
const denied = request => assert.rejects(request, error => error.code === 'permission-denied');
after(async () => { await Promise.all(databases.map(db => sdk.terminate(db))); await Promise.all(apps.map(app => deleteApp(app))); });

test('rules: unauthenticated and other users cannot read or change private documents', async () => {
  const id = 'diary-' + suffix;
  await seed('diaries/' + id, { id, userId: alice, userEntry: 'private', dateString: '2020-01-01' });
  const anonymous = client(), other = client(bob), owner = client(alice);
  await denied(sdk.getDoc(sdk.doc(anonymous, 'diaries', id)));
  await denied(sdk.getDoc(sdk.doc(other, 'diaries', id)));
  assert.equal((await sdk.getDoc(sdk.doc(owner, 'diaries', id))).data().userEntry, 'private');
  await denied(sdk.updateDoc(sdk.doc(owner, 'diaries', id), { userEntry: 'bypass API' }));
  await denied(sdk.deleteDoc(sdk.doc(owner, 'diaries', id)));
  await denied(sdk.setDoc(sdk.doc(owner, 'diaries', 'new-' + suffix), { userId: alice }));
  await sdk.updateDoc(sdk.doc(owner, 'diaries', id), { isAdLocked: false });
});

test('rules: owner-constrained queries work; broad or another-owner lists fail', async () => {
  const owner = client(alice);
  const list = sdk.collection(owner, 'diaries');
  assert.ok((await sdk.getDocs(sdk.query(list, sdk.where('userId', '==', alice), sdk.limit(10)))).size > 0);
  await denied(sdk.getDocs(sdk.query(list, sdk.limit(10))));
  await denied(sdk.getDocs(sdk.query(list, sdk.where('userId', '==', bob), sdk.limit(10))));
});

test('rules: credentials, codes, attempts, reports and push collections are server-only', async () => {
  const owner = client(alice);
  for (const name of ['guestCredentials', 'guestBackupCodes', 'guestBackupAttempts', 'backupCodes', 'reports', 'pushDevices', 'diaryPushTargets']) {
    const ref = sdk.doc(owner, name, alice);
    await seed(name + '/' + alice, { secret: 'synthetic' });
    await denied(sdk.getDoc(ref));
    await denied(sdk.setDoc(ref, { secret: 'overwrite' }));
    await denied(sdk.deleteDoc(ref));
  }
});

test('rules: guest data identity works without UI login; transfer locks guest writes', async () => {
  await seed('guestCredentials/' + guest, { secretHash: 'synthetic' });
  const db = client('guest:' + guest, { dreamaryOwner: guest, dreamaryGuest: true });
  const id = 'character-' + suffix, ref = sdk.doc(db, 'characters', id);
  await sdk.setDoc(ref, { id, userId: guest, name: 'guest' });
  await sdk.setDoc(sdk.doc(db, 'users', id), { id, name: 'profile' });
  assert.equal((await sdk.getDoc(ref)).data().userId, guest);
  await denied(sdk.updateDoc(ref, { userId: alice }));
  await denied(sdk.setDoc(sdk.doc(db, 'characters', 'forged-' + suffix), { id: 'forged-' + suffix, userId: alice }));
  await seed('guestCredentials/' + guest, { secretHash: 'synthetic', migrationTarget: alice });
  await denied(sdk.updateDoc(ref, { name: 'after transfer started' }));
});

test('rules: profile follows its parent character; client cannot forge AI messages', async () => {
  const id = 'parent-' + suffix;
  await seed('characters/' + id, { id, userId: alice });
  await seed('users/' + id, { id, name: 'private profile' });
  const owner = client(alice), other = client(bob);
  assert.equal((await sdk.getDoc(sdk.doc(owner, 'users', id))).data().name, 'private profile');
  await denied(sdk.getDoc(sdk.doc(other, 'users', id)));
  const messageId = 'chat-' + suffix;
  const message = { id: messageId, userId: alice, characterId: id, role: 'assistant', content: 'forged' };
  await denied(sdk.setDoc(sdk.doc(owner, 'chatMessages', messageId), message));
  await sdk.setDoc(sdk.doc(owner, 'chatMessages', messageId), { ...message, role: 'user' });
  await denied(sdk.updateDoc(sdk.doc(owner, 'chatMessages', messageId), { role: 'assistant' }));
});

test('rules: account metadata is owner-only; topics are public read but not public write', async () => {
  const owner = client(alice), other = client(bob), anonymous = client();
  await sdk.setDoc(sdk.doc(owner, 'accounts', alice), { id: 'alias' });
  await denied(sdk.getDoc(sdk.doc(other, 'accounts', alice)));
  await denied(sdk.getDocs(sdk.collection(owner, 'accounts')));
  const topic = 'topic-' + suffix;
  await seed('topics/' + topic, { id: topic, content: 'public question' });
  assert.ok((await sdk.getDoc(sdk.doc(anonymous, 'topics', topic))).exists());
  await denied(sdk.setDoc(sdk.doc(owner, 'topics', topic), { content: 'tampered' }));
});
