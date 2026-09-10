import type { Config } from "@netlify/functions";
import { adminDb } from '../../src/lib/firebase-admin';
import { Resend } from 'resend';
import { corsHeaders } from '../shared/cors';
import { randomInt } from 'node:crypto';

export const config: Config = {
  path: "/api/auth/reset-password"
};

const resend = new Resend(process.env.RESEND_API_KEY);

async function getAdminAuth() {
  const [
    { initializeApp, getApps, cert },
    { getAuth },
  ] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
  ]);

  if (!getApps().length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) return null;
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    });
  }

  return getAuth();
}

function generateRandomPassword(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(randomInt(chars.length));
  }
  return pass;
}

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const { id, email } = await req.json();
    if (!id || !email) {
      return new Response(JSON.stringify({ error: 'auth.missingFields' }), { status: 400, headers: corsHeaders });
    }

    const adminAuth = await getAdminAuth();

    if (!adminAuth) {
      return new Response(JSON.stringify({ error: 'auth.serverConfigError' }), { status: 500, headers: corsHeaders });
    }

    const snapshot = await adminDb!.collection('accounts').where('id', '==', id).where('email', '==', email).limit(1).get();

    if (snapshot.empty) {
      return new Response(JSON.stringify({ error: 'auth.accountNotFound' }), { status: 404, headers: corsHeaders });
    }

    const uid = snapshot.docs[0].id;
    if (!process.env.RESEND_API_KEY) throw new Error('Password delivery is not configured');
    const tempPassword = generateRandomPassword();
    await adminAuth.updateUser(uid, { password: tempPassword });

    if (process.env.RESEND_API_KEY) {
      const { data, error: resendError } = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: '[Dreamary] 임시 비밀번호 발급 안내',
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h2>Dreamary 임시 비밀번호</h2>
            <p>회원님의 임시 비밀번호는 <strong>${tempPassword}</strong> 입니다.</p>
            <p>보안을 위해 로그인 후 반드시 비밀번호를 변경해주세요.</p>
          </div>
        `
      });

      if (resendError) {
        console.error('Resend Error:', resendError);
        return new Response(JSON.stringify({ error: `이메일 발송 실패: ${resendError.message}` }), { status: 500, headers: corsHeaders });
      }
    } else {
      throw new Error('Password delivery is not configured');
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error('Reset Password Error:', error);
    return new Response(JSON.stringify({ error: 'auth.serverError' }), { status: 500, headers: corsHeaders });
  }
}
