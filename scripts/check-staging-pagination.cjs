// Bounded synthetic data only. Exercises real composite indexes and cursors.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { preflight } = require('./deploy-staging.cjs');

async function main() {
  if (process.argv.slice(2).join(' ') !== '--execute') throw new Error('Use --execute for staging only.');
  const env = preflight();
  const indexes = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../artifacts/staging-2026-09-13/indexes.json')));
  if (indexes.project !== 'dreamary-staging' || indexes.ready !== indexes.expected || Date.now() - Date.parse(indexes.checkedAt) > 3600000) throw new Error('Run the staging index check first.');
  const app = initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY)), projectId: 'dreamary-staging' }, 'pagination-' + randomUUID());
  const db = getFirestore(app), owner = 'qa-page-' + randomUUID(), characterId = 'qa-page-' + randomUUID();
  const refs = [], checks = [], cleanupErrors = [];
  let failure = false;
  try {
    const batch = db.batch();
    for (const collection of ['diaries', 'chatMessages']) {
      for (let i = 0; i < 35; i++) {
        const ref = db.collection(collection).doc(owner + '-' + String(i).padStart(2, '0'));
        refs.push(ref);
        // Equal timestamps deliberately exercise the document-ID tiebreaker.
        batch.create(ref, { id: ref.id, userId: owner, characterId, createdAt: 1000, content: 'Synthetic pagination verification', role: 'user' });
      }
    }
    await batch.commit();
    for (const collection of ['diaries', 'chatMessages']) {
      const query = db.collection(collection).where('userId', '==', owner).where('characterId', '==', characterId).orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(30);
      const first = await query.get();
      if (first.size !== 30) throw new Error('Unexpected first page size');
      const second = await query.startAfter(first.docs.at(-1)).get();
      const ids = [...first.docs, ...second.docs].map(doc => doc.id);
      const expected = refs.filter(ref => ref.parent.id === collection).map(ref => ref.id).sort().reverse();
      const passed = second.size === 5 && new Set(ids).size === 35 && JSON.stringify(ids) === JSON.stringify(expected);
      checks.push({ collection, firstPage: first.size, secondPage: second.size, passed });
      if (!passed) throw new Error('Pagination check failed');
    }
  } catch { failure = true; }
  finally {
    for (const ref of refs) try { await ref.delete(); } catch { cleanupErrors.push(ref.path); }
    await db.terminate(); await deleteApp(app);
  }
  const report = { project: 'dreamary-staging', checkedAt: new Date().toISOString(), checks, failure, cleanupComplete: !cleanupErrors.length, cleanupErrors, scope: 'Admin SDK synthetic queries: 70 documents, pages of 30+5, equal timestamps. Does not exercise client rules, UI, AI or push delivery.' };
  fs.writeFileSync(path.resolve(__dirname, '../artifacts/staging-2026-09-13/pagination.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (failure || cleanupErrors.length) process.exitCode = 1;
}
main().catch(() => { console.error('Staging pagination check could not start; verify index readiness. Credentials hidden.'); process.exitCode = 1; });
