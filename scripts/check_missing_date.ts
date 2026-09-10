import { adminDb } from '../src/lib/firebase-admin';

async function findMissingDateDiaries() {
  if (!adminDb) throw new Error('Firebase Admin DB is not initialized.');
  const diariesRef = adminDb.collection('diaries');
  const snapshot = await diariesRef.get();
  
  const missing: Array<{
    id: string;
    createdAt?: number;
    content?: string;
    topicId?: string;
    topicContent?: string;
  }> = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    if (!data.dateString) {
      missing.push({
        id: doc.id,
        createdAt: data.createdAt,
        content: data.userEntry,
        topicId: data.topicId,
        topicContent: data.topicContent
      });
    }
  });
  
  console.log(JSON.stringify(missing, null, 2));
}

findMissingDateDiaries().catch(console.error);
