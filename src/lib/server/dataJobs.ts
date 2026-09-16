import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { secretHash } from './guestIdentity';
import { DiaryAuthenticationError } from './diaryAuthentication';

export type DataJobKind = 'chat-delete' | 'character-delete' | 'migration' | 'account-delete';
// Authorization/state changes and enqueue commit together. A repeated request
// never reopens a completed destructive operation.
export async function enqueueDataJob(db: Firestore, kind: DataJobKind, uid: string, entityId = '', operationId = '',
  initialize?: (tx: Transaction, exists: boolean) => Promise<void>) {
  const ref = db.collection('dataJobs').doc(secretHash(JSON.stringify([kind, uid, entityId, operationId])));
  await db.runTransaction(async tx => {
    const previous = await tx.get(ref);
    const usageRef = db.collection('operationUsage').doc('jobs_' + secretHash(uid));
    const usage = !previous.exists && kind !== 'account-delete' ? await tx.get(usageRef) : null;
    const day = new Date().toISOString().slice(0, 10);
    const count = usage?.data()?.day === day ? usage.data()!.count || 0 : 0;
    if (usage && count >= 50) throw new DiaryAuthenticationError(429, '오늘 데이터 정리 요청 한도에 도달했습니다. 내일 다시 시도해주세요.');
    await initialize?.(tx, previous.exists);
    if (usage) tx.set(usageRef, { uid, day, count: count + 1, expiresAt: new Date(Date.now() + 7 * 86400000) });
    if (!previous.exists) tx.create(ref, { kind, uid, entityId, status: 'pending', stage: 0, nextRunAt: Timestamp.now(), createdAt: Date.now() });
  });
  return ref;
}
export async function assertJobLease(tx: Transaction, ref: DocumentReference, lease: string) {
  const snapshot = await tx.get(ref);
  const job = snapshot.data();
  if (!job || job.lease !== lease || job.leaseUntil <= Date.now() || job.status !== 'pending') throw new Error('job_lease_expired');
  return job;
}
function progress(stage: number) {
  return { stage, status: 'pending', leaseUntil: 0, nextRunAt: Timestamp.now() };
}
// Completed receipts retain only an opaque ID and completion time, not owner
// identifiers or payloads. Expiring receipts would permit destructive replays.
function saveProgress(tx: Transaction, ref: DocumentReference, stage: number, done: boolean) {
  if (done) tx.set(ref, { status: 'complete', completedAt: Date.now() });
  else tx.update(ref, progress(stage));
}
export async function advanceDataJob(db: Firestore, ref: DocumentReference) {
  const lease = randomUUID();
  const job = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref), data = snapshot.data();
    if (!data || data.status === 'complete' || (data.leaseUntil || 0) > Date.now()) return null;
    tx.update(ref, { lease, leaseUntil: Date.now() + 60000, nextRunAt: Timestamp.fromMillis(Date.now() + 60000) });
    return data;
  });
  if (!job) return (await ref.get()).data()?.status === 'complete';
  try {
    if (job.kind === 'migration') {
      const { advanceMigration } = await import('./migrationPage');
      return await db.runTransaction(async tx => {
        await assertJobLease(tx, ref, lease);
        const done = await advanceMigration(db, job.entityId, job.uid, tx);
        saveProgress(tx, ref, 0, done);
        return done;
      });
    }
    if (job.kind === 'chat-delete' || job.kind === 'character-delete') {
      return await db.runTransaction(async tx => {
        const currentJob = await assertJobLease(tx, ref, lease);
        let stage = currentJob.stage || 0;
        const character = db.collection('characters').doc(job.entityId);
        const current = await tx.get(character);
        if (!current.exists) { saveProgress(tx, ref, stage, true); return true; }
        if (current.data()?.userId !== job.uid) throw new Error('job_owner_changed');
        const names = job.kind === 'chat-delete' ? ['chatMessages'] : ['diaries', 'chatMessages'];
        const page = await tx.get(db.collection(names[stage]).where('userId', '==', job.uid).where('characterId', '==', job.entityId).limit(20));
        const done = stage === names.length - 1 && page.size < 20;
        page.docs.forEach(doc => tx.delete(doc.ref));
        if (page.size < 20) stage++;
        if (done) {
          if (job.kind === 'chat-delete') tx.update(character, { chatClearing: false, chatEpoch: (current.data()?.chatEpoch || 0) + 1 });
          else { tx.delete(db.collection('users').doc(job.entityId)); tx.delete(character); }
        }
        saveProgress(tx, ref, stage, done);
        return done;
      });
    }
    if (job.kind !== 'account-delete') throw new Error('unknown_job');
    const scopes = [
      ['reports', 'userId'], ['backupCodes', 'usedByUserId'], ['backupCodes', 'sourceUUID'],
      ['guestBackupCodes', 'usedByUserId'], ['guestBackupCodes', 'sourceUUID'], ['backupCodeUsage', 'sourceUUID'],
      ['guestBackupAttempts', 'uid'], ['pushDevices', 'uid'], ['chatMessages', 'userId'], ['diaries', 'userId'],
      ['operationUsage', 'uid'], ['aiRequests', 'uid'], ['characters', 'userId'],
    ];
    // External Auth deletion is idempotent. All database changes below are
    // fenced by the lease and commit with the cursor, including source changes.
    if (job.stage >= scopes.length && (job.sourceUUID || job.sourcesComplete)) {
      const { getAuth } = await import('firebase-admin/auth');
      try { await getAuth().deleteUser(job.sourceUUID ? 'guest:' + job.sourceUUID : job.uid); }
      catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error; }
    }
    return await db.runTransaction(async tx => {
      const current = await assertJobLease(tx, ref, lease);
      let stage = current.stage || 0;
      const source = current.sourceUUID as string | undefined, owner = source || job.uid;
      if (!source && !current.sourcesComplete) {
        const sources = await tx.get(db.collection('guestCredentials').where('migrationTarget', '==', job.uid).limit(1));
        if (!sources.empty) {
          tx.update(sources.docs[0].ref, { retired: true });
          tx.update(ref, { ...progress(0), sourceUUID: sources.docs[0].id });
        } else tx.update(ref, { ...progress(0), sourcesComplete: true });
        return false;
      }
      if (stage < scopes.length) {
        const [name, field] = scopes[stage];
        const page = await tx.get(db.collection(name).where(field, '==', owner).limit(20));
        page.docs.forEach(doc => {
          if (name === 'characters') tx.delete(db.collection('users').doc(doc.id));
          tx.delete(doc.ref);
        });
        if (page.size < 20) stage++;
        tx.update(ref, progress(stage));
        return false;
      }
      // ImgBB has no documented deletion API. Preserve deletion capabilities
      // in a server-only queue for operator deletion instead of losing them.
      const images = await tx.get(db.collection('imageUploads').where('uid', '==', owner).limit(20));
      images.docs.forEach(doc => {
        tx.set(db.collection('imageDeletionQueue').doc(doc.id), { ...doc.data(), requestedAt: Date.now(), status: 'pending' });
        tx.delete(doc.ref);
      });
      if (!images.empty) { tx.update(ref, progress(stage)); return false; }
      for (const name of ['accounts', 'diaryPushTargets', 'pairCreationLocks']) tx.delete(db.collection(name).doc(owner));
      if (source) {
        tx.set(db.collection('guestCredentials').doc(source), { retired: true });
        tx.update(ref, { ...progress(0), sourceUUID: null });
        return false;
      }
      saveProgress(tx, ref, stage, true);
      return true;
    });
  } catch (error) {
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.lease !== lease || current.status !== 'pending') return;
      const attempts = (current.attempts || 0) + 1;
      tx.update(ref, { leaseUntil: 0, nextRunAt: Timestamp.fromMillis(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6))), failedAt: Date.now(), attempts });
    });
    console.error(JSON.stringify({ event: 'data_job_failed', kind: job.kind }));
    throw error;
  }
}
export async function drainDataJobs(db: Firestore, budgetMs = 18000) {
  const deadline = Date.now() + budgetMs;
  let steps = 0;
  while (Date.now() < deadline) {
    const page = await db.collection('dataJobs').where('status', '==', 'pending').where('nextRunAt', '<=', Timestamp.now())
      .orderBy('nextRunAt').limit(5).get();
    if (page.empty) break;
    await Promise.allSettled(page.docs.map(doc => advanceDataJob(db, doc.ref)));
    steps += page.size;
  }
  return steps;
}
