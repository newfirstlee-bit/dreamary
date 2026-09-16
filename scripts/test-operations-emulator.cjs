// Real Admin SDK persistence and type restoration against the demo emulator only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { exportBackup, restoreDemo, verifyBackup } = require('./operations/backup.cjs');
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Explicit local emulator required');
const projectId = 'demo-dreamary-security';
const app = initializeApp({ projectId }, 'backup-demo'), db = getFirestore(app);
after(async () => { await db.terminate(); await deleteApp(app); });
test('demo Firestore: encrypted backup restores 23 records with database timestamp precision', async () => {
  const collection = db.collection('backupFixture_' + require('node:crypto').randomUUID());
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dreamary-demo-backup-'));
  const file = path.join(temp, 'synthetic.drmbkp'), passphrase = 'only-synthetic-emulator-password';
  try {
    for (let i = 0; i < 23; i++) await collection.doc('d' + i).set({ text: 'synthetic', at: new Timestamp(123, 456), bytes: Buffer.from('demo') });
    const original = (await collection.doc('d0').get()).data();
    const source = { projectId, listCollections: async () => [collection] };
    assert.equal((await exportBackup(source, file, passphrase, 100)).documents, 23);
    assert.deepEqual(await verifyBackup(file, passphrase, projectId), { documents: 23, verified: true });
    await collection.doc('d0').delete();
    assert.equal((await restoreDemo(db, file, passphrase, { verifyWrites: true })).documents, 23);
    const restored = (await collection.doc('d0').get()).data();
    assert.ok(restored.at.isEqual(original.at));
    assert.ok(restored.bytes.equals(Buffer.from('demo')));
  } finally {
    for (let i = 0; i < 23; i++) await collection.doc('d' + i).delete();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
