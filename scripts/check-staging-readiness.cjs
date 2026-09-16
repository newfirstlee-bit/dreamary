// Read-only staging readiness. Never prints values, identities, tokens or DB contents.
const { preflight, loginToken, api, assertSite } = require('./deploy-staging.cjs');
const target = require('../staging-deploy.json');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
async function main() {
  const env = preflight();
  const token = await loginToken(env);
  const site = await api(token, '/sites/' + target.siteId);
  assertSite(site);
  const rows = await api(token, '/accounts/' + target.accountId + '/env?site_id=' + target.siteId);
  const value = key => {
    const row = rows.find(r => r.key === key && r.scopes?.includes('functions'));
    return (row?.values?.find(v => v.context === 'production') || row?.values?.find(v => v.context === 'all'))?.value || '';
  };
  const report = {
    checkedAt: new Date().toISOString(), project: target.firebaseProjectId,
    deployId: site.published_deploy?.id,
    aiGenerationEnabled: value('AI_GENERATION_ENABLED') !== 'false',
    openrouterConfigured: Boolean(value('OPENROUTER_API_KEY') || value('NEXT_PUBLIC_OPENROUTER_API_KEY')),
    firestoreRead: null,
  };
  const app = initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY)), projectId: target.firebaseProjectId }, 'staging-readiness');
  const db = getFirestore(app);
  try {
    const ids = process.argv.slice(2);
    if (ids.length > 2 || ids.some(id => !/^[a-z0-9]+$/.test(id))) throw new Error('At most two explicit test IDs allowed.');
    if (ids.length) {
      report.accounts = [];
      for (const id of ids) {
        try {
          const user = await getAuth(app).getUserByEmail(id + '@dreamary.internal');
          report.accounts.push({ id, exists: true, disabled: user.disabled, passwordProvider: user.providerData.some(p => p.providerId === 'password') });
        } catch (error) {
          if (error.code !== 'auth/user-not-found') throw error;
          report.accounts.push({ id, exists: false });
        }
      }
    }
    const started = Date.now();
    // One fixed, absent diagnostic document: no collection scan or contents.
    await db.doc('diagnosticChecks/readiness-probe').get();
    report.firestoreRead = { ok: true, elapsedMs: Date.now() - started };
  } catch (error) {
    report.firestoreRead = { ok: false, code: typeof error.code === 'number' ? error.code : 'unclassified' };
  } finally { await db.terminate(); await deleteApp(app); }
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(() => { console.error('Staging readiness inspection failed; details withheld.'); process.exitCode = 1; });
