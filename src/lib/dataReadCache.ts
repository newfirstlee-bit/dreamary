import type { Topic, UserProfile } from './db';
import { ReadCache } from './readCache';

export const profileReadCache = new ReadCache<UserProfile | null>(60_000);
export const topicReadCache = new ReadCache<Topic[]>(5 * 60_000, 1);
