import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { DiaryAuthenticationError } from './diaryAuthentication';
const PAGE_SIZE = 20;
export async function advanceMigration(db: Firestore, sourceUUID: string, uid: string, transaction: Transaction) {
      const current = await transaction.get(db.collection('guestCredentials').doc(sourceUUID));
      const targetState = await transaction.get(db.collection('accountStates').doc(uid));
      if (targetState.exists || current.data()?.retired) return true;
      if (current.data()?.migrationTarget !== uid) throw new DiaryAuthenticationError(403, '데이터 이전 권한이 없습니다.');
      if (current.data()?.migrationState === 'complete') return true;
      // Move characters LAST: until all diaries are transferred the target UID
      // must not be able to create a duplicate diary under its new daily ID.
      const names = ['diaries', 'chatMessages', 'imageUploads', 'characters'];
      const field = names[current.data()?.migrationStage || 0] === 'imageUploads' ? 'uid' : 'userId';
      const stage = current.data()?.migrationStage || 0;
      const snapshot = await transaction.get(db.collection(names[stage])
        .where(field, '==', sourceUUID).limit(PAGE_SIZE));
      const pairLock = db.collection('pairCreationLocks').doc(uid);
      const reservation = await transaction.get(pairLock);
      snapshot.docs.forEach(item => transaction.update(item.ref, {
        [field]: uid, ...(stage === 3 ? { diaryOwnershipMigrated: true } : {}),
      }));
      const stageDone = snapshot.size < PAGE_SIZE;
      const complete = stage === 3 && stageDone;
      if (complete) {
        transaction.update(db.collection('guestCredentials').doc(sourceUUID), { migrationState: 'complete', completedAt: Date.now() });
        if (reservation.data()?.migrationSource === sourceUUID) transaction.set(pairLock, { reserved: 0, updatedAt: Date.now() });
      }
      else if (stageDone) transaction.update(db.collection('guestCredentials').doc(sourceUUID), { migrationStage: stage + 1 });
      return complete;
}
