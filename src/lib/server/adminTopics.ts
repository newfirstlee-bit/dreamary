import { adminDb } from '../firebase-admin';
import { readTopicCatalog } from './topicCatalog';
export async function readAdminTopics() {
  if (!adminDb) throw new Error('Admin DB is not configured');
  return readTopicCatalog(adminDb);
}
