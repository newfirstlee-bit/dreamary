import { drainDataJobs } from '../../src/lib/server/dataJobs';
import type { Config } from '@netlify/functions';
import { getFirebaseAdminServices } from '../shared/push-shared.mts';
import { drainDiaryPushQueue } from '../../src/lib/server/diaryPushQueue';
// Due times remain 20:00 KST. Each bounded run continues the persistent backlog.
export const config: Config = { schedule: '* * * * *' };
export default async function handler() {
  const { firestore, messaging } = getFirebaseAdminServices();
  const startedAt = Date.now();
  const steps = await drainDataJobs(firestore, 6000);
  const push = await drainDiaryPushQueue(firestore, messaging, Math.max(1, 18000 - (Date.now() - startedAt)));
  console.log(JSON.stringify({ event: 'operations_queue', dataSteps: steps, ...push }));
}
