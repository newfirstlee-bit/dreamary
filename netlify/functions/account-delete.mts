import type { Config } from '@netlify/functions';
export { default } from '../../src/lib/server/accountDelete';
export const config: Config = { path: '/api/account/delete' };
