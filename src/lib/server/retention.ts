import { Timestamp, type Firestore } from 'firebase-admin/firestore';
// No TTL billing feature is required. Each scheduled run removes at most 100
// expired temporary documents. User diaries/chats and replay tombstones stay.
export async function cleanExpiredMetadata(db: Firestore) {
  let removed = 0;
  for (const [name, field] of [['operationUsage', 'expiresAt'], ['aiRequests', 'expiresAt'], ['guestBackupAttempts', 'expiresAt'], ['backupCodeUsage', 'expiresAt'], ['guestBackupCodes', 'cleanupAt']]) {
    const page = await db.collection(name).where(field, '<=', Timestamp.now()).orderBy(field).limit(20).get();
    await db.runTransaction(async tx => {
      const current = await Promise.all(page.docs.map(doc => tx.get(doc.ref)));
      const sourceRefs = current.map(doc => name === 'guestBackupCodes' && doc.data()?.usedByUserId
        ? db.collection('guestCredentials').doc(doc.data()!.sourceUUID) : null);
      const sources = await Promise.all(sourceRefs.map(ref => ref ? tx.get(ref) : null));
      current.forEach((doc, index) => {
        const data = doc.data(), expiry = data?.[field]?.toMillis?.();
        if (!doc.exists || !expiry || expiry > Date.now() || (name === 'aiRequests' && data?.status === 'complete')) return;
        if (sources[index] && sources[index]?.data()?.migrationState !== 'complete' && !sources[index]?.data()?.retired) { tx.update(doc.ref, { cleanupAt: new Date(Date.now() + 7 * 86400000) }); return; }
        tx.delete(doc.ref);
      });
    });
    removed += page.size;
  }
  return removed;
}
