import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { cleanExpiredMetadata } from '../../src/lib/server/retention';
// 100/hour ceiling; temporary records only. No paid Firestore TTL dependency.
export const config: Config = { schedule: '17 * * * *' };
export default async function handler() {
  if (!adminDb) throw new Error('Cleanup database unavailable');
  console.log(JSON.stringify({ event: 'metadata_cleanup', examined: await cleanExpiredMetadata(adminDb) }));
}
