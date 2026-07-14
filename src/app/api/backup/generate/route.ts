import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';

// 임의의 8자리 영숫자 생성
function generateBackupCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function POST(req: Request) {
  try {
    const { sourceUUID } = await req.json();
    if (!sourceUUID) {
      return NextResponse.json({ error: 'UUID가 필요합니다.' }, { status: 400 });
    }

    const today = new Date().toISOString().split('T')[0];
    const usageRef = doc(db, 'backupCodeUsage', `${sourceUUID}_${today}`);
    
    // 트랜잭션으로 일일 제한(3회) 체크 및 코드 발급
    const code = await runTransaction(db, async (transaction) => {
      const usageDoc = await transaction.get(usageRef);
      let count = 0;
      
      if (usageDoc.exists()) {
        count = usageDoc.data()?.count || 0;
      }
      
      if (count >= 3) {
        throw new Error('하루 발급 한도(3회)를 초과했습니다.');
      }
      
      const newCode = generateBackupCode();
      const codeRef = doc(db, 'backupCodes', newCode);
      
      // 24시간 유효
      const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
      
      transaction.set(usageRef, { count: count + 1, date: today }, { merge: true });
      transaction.set(codeRef, {
        code: newCode,
        sourceUUID,
        createdAt: serverTimestamp(),
        expiresAt,
        usedAt: null,
        usedByUserId: null
      });
      
      return newCode;
    });

    return NextResponse.json({ code });

  } catch (error: any) {
    console.error('Backup Generate Error:', error);
    if (error.message.includes('한도')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
