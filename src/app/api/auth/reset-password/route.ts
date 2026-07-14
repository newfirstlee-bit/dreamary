import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { adminAuth } from '@/lib/firebase-admin';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function generateRandomPassword(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

export async function POST(req: Request) {
  try {
    const { id, email } = await req.json();
    if (!id || !email) {
      return NextResponse.json({ error: 'auth.missingFields' }, { status: 400 });
    }

    if (!adminAuth) {
      return NextResponse.json({ error: 'auth.serverConfigError' }, { status: 500 });
    }

    // 1. 해당 아이디와 이메일이 일치하는 계정 찾기
    const accountsRef = collection(db, 'accounts');
    const q = query(accountsRef, where('id', '==', id), where('email', '==', email));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return NextResponse.json({ error: 'auth.accountNotFound' }, { status: 404 });
    }

    const account = snapshot.docs[0].data();
    const uid = snapshot.docs[0].id; // Firebase Auth UID

    // 2. 임시 비밀번호 생성 및 Firebase Auth 업데이트
    const tempPassword = generateRandomPassword();
    await adminAuth.updateUser(uid, { password: tempPassword });

    // 3. 이메일 발송
    if (process.env.RESEND_API_KEY) {
      const { data, error: resendError } = await resend.emails.send({
        from: 'onboarding@resend.dev', // 테스트용 기본 발신자
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
        return NextResponse.json({ error: `이메일 발송 실패: ${resendError.message}` }, { status: 500 });
      }
    } else {
      console.warn('RESEND_API_KEY is not set. Temp password:', tempPassword);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Reset Password Error:', error);
    return NextResponse.json({ error: 'auth.serverError' }, { status: 500 });
  }
}
