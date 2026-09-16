import targets from '../../../app-build-targets.json';

// Validate again inside deployed functions: changing dashboard environment
// values after a build must not redirect the staging server to production.
export function assertServerEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env.DREAMARY_ENVIRONMENT !== 'staging') return;
  const expected = targets.branch;
  let account: { project_id?: string };
  try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}'); }
  catch { throw new Error('Invalid staging service account configuration'); }
  if (account.project_id !== expected.firebaseProjectId || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== expected.firebaseProjectId || env.NEXT_PUBLIC_API_URL !== expected.apiUrl) throw new Error('Staging Firebase/API isolation check failed');
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Staging cannot use another credential or emulator');
}
