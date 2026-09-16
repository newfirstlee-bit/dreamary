import type { Firestore } from 'firebase-admin/firestore';
import type { Topic } from '../db';
import { ReadCache } from '../readCache';
const cache = new ReadCache<Topic[]>(300000, 1);
export const clearTopicCatalog = () => cache.clear();
export async function readTopicCatalog(db: Firestore): Promise<Topic[]> {
  return cache.get('current', async () => {
    const snapshot = await db.collection('topicCatalog').doc('current').get();
    const topics = snapshot.data()?.topics;
    if (!Array.isArray(topics)) throw new Error('Topic catalog must be prepared before release');
    return topics;
  });
}
