import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminDb } from '@/lib/firebase-admin';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    if (!adminDb) {
      return NextResponse.json({ error: 'auth.serverConfigError' }, { status: 500 });
    }

    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'auth.missingEmail' }, { status: 400 });
    }

    const snapshot = await adminDb.collection('accounts').where('email', '==', email).get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'auth.accountNotFound' }, { status: 404 });
    }

    const account = snapshot.docs[0].data();
    const userId = account.id;

    if (process.env.RESEND_API_KEY) {
      const { error } = await resend.emails.send({
        from: process.env.RESEND_AUTH_FROM || 'onboarding@resend.dev',
        to: email,
        subject: '[Dreamary] 아이디 찾기 안내',
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h2>Dreamary 아이디 찾기</h2>
            <p>회원님의 아이디는 <strong>${userId}</strong> 입니다.</p>
            <p>감사합니다.</p>
          </div>
        `,
      });

      if (error) {
        console.error('Resend Error:', error);
        return NextResponse.json({ error: `이메일 발송 실패: ${error.message}` }, { status: 500 });
      }
    } else {
      console.warn('RESEND_API_KEY is not set. Email would be sent with ID:', userId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Find ID Error:', error);
    return NextResponse.json({ error: 'auth.serverError' }, { status: 500 });
  }
}
