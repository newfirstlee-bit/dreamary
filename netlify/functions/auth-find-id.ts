import type { Config } from "@netlify/functions";
import { adminDb } from '../../src/lib/firebase-admin';
import { Resend } from 'resend';
import { corsHeaders } from './cors';

export const config: Config = {
  path: "/api/auth/find-id"
};

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    if (!adminDb) {
      return new Response(JSON.stringify({ error: '서버 설정이 완료되지 않았습니다.' }), { status: 500, headers: corsHeaders });
    }

    const { email } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'auth.missingEmail' }), { status: 400, headers: corsHeaders });
    }

    const snapshot = await adminDb.collection('accounts').where('email', '==', email).get();

    if (snapshot.empty) {
      return new Response(JSON.stringify({ error: 'auth.accountNotFound' }), { status: 404, headers: corsHeaders });
    }

    const account = snapshot.docs[0].data();
    const userId = account.id;

    if (process.env.RESEND_API_KEY) {
      const { data, error } = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: '[Dreamary] 아이디 찾기 안내',
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h2>Dreamary 아이디 찾기</h2>
            <p>회원님의 아이디는 <strong>${userId}</strong> 입니다.</p>
            <p>감사합니다.</p>
          </div>
        `
      });

      if (error) {
        console.error('Resend Error:', error);
        return new Response(JSON.stringify({ error: `이메일 발송 실패: ${error.message}` }), { status: 500, headers: corsHeaders });
      }
    } else {
      console.warn('RESEND_API_KEY is not set. Email would be sent with ID:', userId);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error('Find ID Error:', error);
    return new Response(JSON.stringify({ error: 'auth.serverError' }), { status: 500, headers: corsHeaders });
  }
}
