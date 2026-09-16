// Explicit project, dry-run by default, no private content in output.
const { database, args } = require('./database.cjs');
async function prepare(db, options) {
  const max = Number(options['max-docs']);
  if (!Number.isInteger(max) || max < 20 || max > 100000) throw new Error('max-docs must be 20..100000');
  if (options.action === 'catalog') {
    let cursor, topics = [];
    for (;;) {
      let query = db.collection('topics').orderBy('__name__').limit(20);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      topics.push(...page.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      if (topics.length > Math.min(max, 1000)) throw new Error('Topic limit exceeded; split catalog first');
      if (page.size < 20) break;
      cursor = page.docs.at(-1);
    }
    topics.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    if (topics.some(t => !Number.isFinite(t.order) || typeof t.content !== 'string')) throw new Error('Invalid topics; repair before preparing');
    const bytes = Buffer.byteLength(JSON.stringify(topics));
    if (bytes > 600000 || !topics.length) throw new Error('Catalog is empty or too large');
    if (options.apply) await db.collection('topicCatalog').doc('current').set({ topics, updatedAt: Date.now() });
    return { action: 'catalog', topics: topics.length, bytes, applied: options.apply };
  }
  if (options.action !== 'dates' || !['diaries', 'chatMessages', 'characters', 'accounts'].includes(options.collection)) throw new Error('Choose catalog or dates with a supported collection');
  let cursor = options.cursor, scanned = 0, repaired = 0, unresolved = 0, complete = false;
  while (scanned < max) {
    let query = db.collection(options.collection).orderBy('__name__').select('createdAt', 'dateString').limit(Math.min(20, max - scanned));
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) {
      const data = doc.data();
      if (Number.isFinite(data.createdAt) && data.createdAt > 0) continue;
      const fromId = /^\d{13}$/.test(doc.id) ? Number(doc.id) : 0;
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(data.dateString || '') ? Date.parse(data.dateString + 'T00:00:00+09:00') : 0;
      const oldTimestamp = data.createdAt?.toMillis?.() || 0;
      const value = oldTimestamp || fromId || fromDate;
      if (!Number.isFinite(value) || value <= 0) { unresolved++; continue; }
      if (options.apply) await db.runTransaction(async tx => {
        const current = await tx.get(doc.ref);
        if (current.exists && !(Number.isFinite(current.data().createdAt) && current.data().createdAt > 0))
          tx.update(doc.ref, { createdAt: value, createdAtRecoveredFrom: oldTimestamp ? 'timestamp' : fromId ? 'legacy-id' : 'diary-date-kst' });
      });
      repaired++;
    }
    scanned += page.size;
    if (page.size) cursor = page.docs.at(-1).id;
    if (page.size < 20) { complete = true; break; }
  }
  return { scanned, repairable: repaired, unresolved, complete, nextCursor: complete ? null : cursor, applied: options.apply };
}
module.exports = { prepare };
if (require.main === module) {
  const options = args();
  prepare(database(options.project), options).then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Preparation failed; check project, credentials, input and index settings. No user content logged.'); process.exitCode = 1; });
}
