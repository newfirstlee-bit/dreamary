const { GoogleAuth } = require('google-auth-library');
require('dotenv').config({ path: '.env.local' });
async function run() {
  try {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!rawServiceAccount) throw new Error("No service account");
    const sa = JSON.parse(rawServiceAccount);
    const auth = new GoogleAuth({
      credentials: { client_email: sa.client_email, private_key: sa.private_key },
      scopes: ['https://www.googleapis.com/auth/identitytoolkit', 'https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: 'dummy', password: 'dummy' })
    });
    const text = await res.text();
    console.log("Status:", res.status, "Response:", text);
  } catch(e) { console.error(e); }
}
run();
