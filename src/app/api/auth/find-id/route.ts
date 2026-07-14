import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'auth.missingEmail' }, { status: 400 });
    }

    // 1. 해당 이메일로 가입된 계정 찾기
    const accountsRef = collection(db, 'accounts');
    const q = query(accountsRef, where('email', '==', email));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return NextResponse.json({ error: 'auth.accountNotFound' }, { status: 404 });
    }

    const account = snapshot.docs[0].data();
    const userId = account.id; // 가입 시 입력한 아이디

    // 2. 이메일 발송
    if (process.env.RESEND_API_KEY) {
      const { data, error } = await resend.emails.send({
        from: 'onboarding@resend.dev', // 테스트용 기본 발신자
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
        return NextResponse.json({ error: `이메일 발송 실패: ${error.message} (도메인 인증 문제일 수 있습니다)` }, { status: 500 });
      }
    } else {
      console.warn('RESEND_API_KEY is not set. Email would be sent with ID:', userId);
      // 개발 환경이거나 키가 없을 때는 성공으로 처리하되 실제 발송은 안됨
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Find ID Error:', error);
    return NextResponse.json({ error: 'auth.serverError' }, { status: 500 });
  }
}
