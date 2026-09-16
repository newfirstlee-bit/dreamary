const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
function database(project) {
  if (!project || !/^[a-z][a-z0-9-]+$/.test(project)) throw new Error('Explicit --project is required');
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host) {
    if (!project.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(host)) throw new Error('Only a loopback demo emulator is allowed');
    return getFirestore(initializeApp({ projectId: project }));
  }
  if (project.startsWith('demo-')) throw new Error('Demo projects require FIRESTORE_EMULATOR_HOST');
  require('@next/env').loadEnvConfig(process.cwd(), false);
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
  if (account.project_id !== project) throw new Error('Credential project does not match --project');
  return getFirestore(initializeApp({ projectId: project, credential: cert(account) }));
}
function args() { return require('node:util').parseArgs({ options: {
  project: { type: 'string' }, file: { type: 'string' }, action: { type: 'string' },
  apply: { type: 'boolean', default: false }, collection: { type: 'string' }, cursor: { type: 'string' },
  'max-docs': { type: 'string', default: '1000' },
} }).values; }
module.exports = { database, args };
