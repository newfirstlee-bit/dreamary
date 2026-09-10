import type { Firestore, Query } from 'firebase-admin/firestore';

export async function deleteQueryPages(db: Firestore, query: Query, profiles = false) {
  for (;;) {
    const snapshot = await query.limit(20).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    for (const item of snapshot.docs) {
      if (profiles) batch.delete(db.collection('users').doc(item.id));
      batch.delete(item.ref);
    }
    await batch.commit();
    if (snapshot.size < 20) return;
  }
}

export async function cleanupAccountData(db: Firestore, uid: string) {
  // Retire transferred guest keys BEFORE deleting either source or destination
  // data. Interrupted migrations must not restore data after account deletion.
  for (;;) {
    const credentials = await db.collection('guestCredentials').where('migrationTarget', '==', uid).limit(20).get();
    if (credentials.empty) break;
    for (const credential of credentials.docs) {
      await credential.ref.update({ retired: true });
      for (const name of ['diaries', 'chatMessages']) {
        await deleteQueryPages(db, db.collection(name).where('userId', '==', credential.id));
      }
      await deleteQueryPages(db, db.collection('characters').where('userId', '==', credential.id), true);
      for (const name of ['guestBackupCodes', 'backupCodes', 'backupCodeUsage']) {
        await deleteQueryPages(db, db.collection(name).where('sourceUUID', '==', credential.id));
      }
      const { getAuth } = await import('firebase-admin/auth');
      try { await getAuth().deleteUser(`guest:${credential.id}`); }
      catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error; }
      // Keep only a non-personal tombstone so this UUID cannot be claimed again.
      // No account UID, secret hash, code, or content remains in this document.
      await credential.ref.set({ retired: true });
    }
  }
  const scopes: [string, string][] = [
    ['reports', 'userId'], ['backupCodes', 'usedByUserId'], ['backupCodes', 'sourceUUID'],
    ['guestBackupCodes', 'usedByUserId'], ['guestBackupAttempts', 'uid'], ['pushDevices', 'uid'],
    ['chatMessages', 'userId'], ['diaries', 'userId'],
  ];
  for (const [name, field] of scopes) await deleteQueryPages(db, db.collection(name).where(field, '==', uid));
  await deleteQueryPages(db, db.collection('characters').where('userId', '==', uid), true);
  await db.collection('diaryPushTargets').doc(uid).delete();
  await db.collection('accounts').doc(uid).delete();
}
