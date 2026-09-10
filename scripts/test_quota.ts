import { adminDb } from '../src/lib/firebase-admin';

async function testQuota() {
  if (!adminDb) throw new Error('Firebase Admin DB is not initialized.');

  try {
    const topicsRef = adminDb.collection('topics').limit(1);
    const snapshot = await topicsRef.get();
    console.log("Topics Read Success:", snapshot.size);
  } catch(e) {
    console.error("Topics Error:", e instanceof Error ? e.message : e);
  }

  try {
    const usersRef = adminDb.collection('users').limit(1);
    const snapshot = await usersRef.get();
    console.log("Users Read Success:", snapshot.size);
  } catch(e) {
    console.error("Users Error:", e instanceof Error ? e.message : e);
  }
}

testQuota().catch(console.error);
