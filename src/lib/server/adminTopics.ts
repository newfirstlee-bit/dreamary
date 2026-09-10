import { adminDb } from '../firebase-admin';
import type { Topic } from '../db';

export async function readAdminTopics(): Promise<Topic[]> {
  if (!adminDb) throw new Error('Admin DB is not configured');
  const result: Topic[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (let page = 0; page < 100; page++) {
    let query = adminDb.collection('topics').orderBy('__name__').limit(20);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    result.push(...snapshot.docs.map(item => item.data() as Topic));
    if (snapshot.size < 20) return result;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  throw new Error('주제가 너무 많습니다. 범위를 나눠 처리해주세요.');
}
