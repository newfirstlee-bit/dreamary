import type { Context } from "@netlify/functions";
import { Resend } from 'resend';
import { GoogleAuth } from 'google-auth-library';

const resend = new Resend(process.env.RESEND_API_KEY);

let adminDb: FirebaseFirestore.Firestore | null = null;
let googleAuth: GoogleAuth | null = null;
let projectId: string = '';

async function getFirebaseAdmin() {
  if (adminDb && googleAuth) return { adminDb, googleAuth, projectId };

  const [
    { cert, getApps, initializeApp },
    { getFirestore }
  ] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore')
  ]);

  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!rawServiceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set');
  const serviceAccount = JSON.parse(rawServiceAccount);
  projectId = serviceAccount.project_id;

  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }

  adminDb = getFirestore();

  // Initialize Google Auth for REST API calls
  googleAuth = new GoogleAuth({
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/identitytoolkit', 'https://www.googleapis.com/auth/cloud-platform'],
    projectId: serviceAccount.project_id
  });

  return { adminDb, googleAuth, projectId };
}

export default async (req: Request, context: Context) => {
  // Handle Preflight (CORS)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { id, email } = await req.json();
    if (!id || !email) {
      return new Response(JSON.stringify({ error: 'auth.missingFields' }), {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
      });
    }

    const { adminDb, googleAuth, projectId } = await getFirebaseAdmin();
    
    // Check if account exists
    const snapshot = await adminDb.collection('accounts').where('id', '==', id).where('email', '==', email).get();

    if (snapshot.empty) {
      return new Response(JSON.stringify({ error: 'auth.accountNotFound' }), {
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
      });
    }

    const uid = snapshot.docs[0].id;

    // Generate random 8-character password
    const tempPassword = Math.random().toString(36).slice(-8);

    // Update password in Firebase Auth using Google Identity Toolkit REST API
    const client = await googleAuth.getClient();
    const accessToken = await client.getAccessToken();

    const updateRes = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        localId: uid,
        password: tempPassword
      })
    });

    if (!updateRes.ok) {
      const errorData = await updateRes.json();
      console.error('Identity Toolkit Error:', errorData);
      throw new Error('Failed to update password in Firebase Auth');
    }

    // Send email
    if (process.env.RESEND_API_KEY) {
      const { error } = await resend.emails.send({
        from: process.env.RESEND_AUTH_FROM || 'onboarding@resend.dev',
        to: email,
        subject: '[Dreamary] 임시 비밀번호 안내',
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h2>Dreamary 임시 비밀번호 안내</h2>
            <p>요청하신 임시 비밀번호가 발급되었습니다.</p>
            <p>임시 비밀번호: <strong>${tempPassword}</strong></p>
            <p>로그인 후 반드시 비밀번호를 변경해 주세요.</p>
            <p>감사합니다.</p>
          </div>
        `,
      });

      if (error) {
        console.error('Resend Error:', error);
        return new Response(JSON.stringify({ error: '이메일 발송 실패' }), {
          status: 500,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
        });
      }
    } else {
      console.warn('RESEND_API_KEY is not set. Temp password is:', tempPassword);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Reset Password Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'auth.serverError' }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
    });
  }
};
