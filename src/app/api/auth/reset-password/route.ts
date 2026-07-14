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
      return NextResponse.json({ error: '아이디와 이메일을 모두 입력해주세요.' }, { status: 400 });
    }

    if (!adminAuth) {
      return NextResponse.json({ error: '서버 인증 설정이 완료되지 않았습니다. 관리자에게 문의하세요.' }, { status: 500 });
    }

    // 1. 해당 아이디와 이메일이 일치하는 계정 찾기
    const accountsRef = collection(db, 'accounts');
    const q = query(accountsRef, where('id', '==', id), where('email', '==', email));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return NextResponse.json({ error: '입력하신 정보와 일치하는 계정이 없습니다.' }, { status: 404 });
    }

    const account = snapshot.docs[0].data();
    const uid = snapshot.docs[0].id; // Firebase Auth UID

    // 2. 임시 비밀번호 생성 및 Firebase Auth 업데이트
    const tempPassword = generateRandomPassword();
    await adminAuth.updateUser(uid, { password: tempPassword });

    // 3. 이메일 발송
    if (process.env.RESEND_API_KEY) {
      await resend.emails.send({
        from: 'Dreamary <noreply@dreamary.app>', // 도메인 인증 필요
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
    } else {
      console.warn('RESEND_API_KEY is not set. Temp password:', tempPassword);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Reset Password Error:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
