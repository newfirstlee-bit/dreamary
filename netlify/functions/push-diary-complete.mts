import type { Config } from '@netlify/functions';
import { handleDiaryPushComplete } from '../../src/lib/server/diaryPushComplete';

export const config: Config = { path: '/api/push/diary-complete' };
export default handleDiaryPushComplete;
