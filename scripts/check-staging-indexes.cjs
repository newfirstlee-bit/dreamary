// Read-only comparison against the fixed staging project; never creates indexes.
const fs = require('node:fs');
const path = require('node:path');
const { GoogleAuth } = require('google-auth-library');
const { preflight } = require('./deploy-staging.cjs');

async function main() {
  const env = preflight();
  const client = await new GoogleAuth({ credentials: JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY), scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  let pageToken;
  const remote = [];
  do {
    const url = new URL('https://firestore.googleapis.com/v1/projects/dreamary-staging/databases/(default)/collectionGroups/-/indexes');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await client.request({ url: url.toString() });
    remote.push(...(response.data.indexes || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  const expected = require('../firestore.indexes.json').indexes;
  function normalize(fields) {
    const result = fields.map(field => ({ ...field }));
    if (!result.some(field => field.fieldPath === '__name__')) result.push({ fieldPath: '__name__', order: result.at(-1).order || 'ASCENDING' });
    return JSON.stringify(result);
  }
  const checks = expected.map(index => {
    const match = remote.find(candidate => candidate.name.includes('/collectionGroups/' + index.collectionGroup + '/') && candidate.queryScope === index.queryScope && normalize(candidate.fields) === normalize(index.fields));
    return { collection: index.collectionGroup, fields: index.fields, state: match?.state || 'MISSING' };
  });
  const report = { project: 'dreamary-staging', checkedAt: new Date().toISOString(), expected: expected.length, remote: remote.length, ready: checks.filter(check => check.state === 'READY').length, checks };
  const file = path.resolve(__dirname, '../artifacts/staging-2026-09-13/indexes.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ expected: report.expected, remote: report.remote, ready: report.ready }));
  if (report.ready !== report.expected) process.exitCode = 1;
}
main().catch(error => { console.error(JSON.stringify({ failure: 'Staging index verification failed; credentials hidden.', httpStatus: error.response?.status, category: error.response?.data?.error?.status, type: error.name })); process.exitCode = 1; });
