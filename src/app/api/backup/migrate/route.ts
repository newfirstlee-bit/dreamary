import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';

export async function POST(req: Request) {
  try {
    const { code, uid } = await req.json();

    if (!code || !uid) {
      return NextResponse.json({ error: '코드와 사용자 ID가 필요합니다.' }, { status: 400 });
    }

    const codeRef = doc(db, 'backupCodes', code);
    const codeDoc = await getDoc(codeRef);

    if (!codeDoc.exists()) {
      return NextResponse.json({ error: '유효하지 않은 백업 코드입니다.' }, { status: 400 });
    }

    const data = codeDoc.data();

    if (data?.usedAt) {
      return NextResponse.json({ error: '이미 사용된 백업 코드입니다.' }, { status: 400 });
    }

    if (data?.expiresAt?.toMillis() < Date.now()) {
      return NextResponse.json({ error: '만료된 백업 코드입니다.' }, { status: 400 });
    }

    const sourceUUID = data?.sourceUUID;

    // sourceUUID의 모든 데이터 가져오기
    const charactersSnap = await getDocs(query(collection(db, 'characters'), where('userId', '==', sourceUUID)));
    const chatMessagesSnap = await getDocs(query(collection(db, 'chatMessages'), where('userId', '==', sourceUUID)));
    const diariesSnap = await getDocs(query(collection(db, 'diaries'), where('userId', '==', sourceUUID)));

    // Batch 처리 (최대 500개씩)
    const BATCH_LIMIT = 500;
    let currentBatch = writeBatch(db);
    let opCount = 0;
    const batches = [currentBatch];

    const commitBatchIfNeeded = () => {
      if (opCount >= BATCH_LIMIT) {
        currentBatch = writeBatch(db);
        batches.push(currentBatch);
        opCount = 0;
      }
    };

    // characters 이관
    charactersSnap.forEach((d) => {
      currentBatch.update(d.ref, { userId: uid });
      opCount++;
      commitBatchIfNeeded();
    });

    // chatMessages 이관
    chatMessagesSnap.forEach((d) => {
      currentBatch.update(d.ref, { userId: uid });
      opCount++;
      commitBatchIfNeeded();
    });

    // diaries 이관
    diariesSnap.forEach((d) => {
      currentBatch.update(d.ref, { userId: uid });
      opCount++;
      commitBatchIfNeeded();
    });

    // 코드 사용 처리
    currentBatch.update(codeRef, { 
      usedAt: serverTimestamp(),
      usedByUserId: uid
    });
    opCount++;

    // 모든 배치 실행
    await Promise.all(batches.map(batch => batch.commit()));

    return NextResponse.json({ success: true, message: '이관이 완료되었습니다.' });

  } catch (error: any) {
    console.error('Backup Migrate Error:', error);
    return NextResponse.json({ error: '데이터 이관 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
