import type { Context } from "@netlify/functions";
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Cache adminDb and adminAuth
let adminDb: FirebaseFirestore.Firestore | null = null;
let adminAuth: any = null;

async function getFirebaseAdmin() {
  if (adminDb && adminAuth) return { adminDb, adminAuth };

  const [
    { cert, getApps, initializeApp },
    { getFirestore },
    { getAuth }
  ] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
    import('firebase-admin/auth')
  ]);

  if (!getApps().length) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!rawServiceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set');
    initializeApp({ credential: cert(JSON.parse(rawServiceAccount)) });
  }

  adminDb = getFirestore();
  adminAuth = getAuth();
  return { adminDb, adminAuth };
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

    const { adminDb, adminAuth } = await getFirebaseAdmin();
    
    // Check if account exists
    const snapshot = await adminDb.collection('accounts').where('id', '==', id).where('email', '==', email).get();

    if (snapshot.empty) {
      return new Response(JSON.stringify({ error: 'auth.accountNotFound' }), {
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
      });
    }

    const account = snapshot.docs[0].data();
    const uid = account.uid; // Firebase Auth UID

    // Generate random 8-character password
    const tempPassword = Math.random().toString(36).slice(-8);

    // Update password in Firebase Auth
    await adminAuth.updateUser(uid, { password: tempPassword });

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
