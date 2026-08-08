import type { Config } from "@netlify/functions";
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from './cors';

export const config: Config = {
  path: "/api/backup/migrate"
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    if (!adminDb) {
      return new Response(JSON.stringify({ error: '서버 설정이 완료되지 않았습니다.' }), { status: 500, headers: corsHeaders });
    }
    const firestore = adminDb;

    const { code, uid } = await req.json();
    const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';

    if (!normalizedCode || !uid) {
      return new Response(JSON.stringify({ error: '코드와 사용자 ID가 필요합니다.' }), { status: 400, headers: corsHeaders });
    }

    const codeRef = firestore.collection('backupCodes').doc(normalizedCode);
    const codeDoc = await codeRef.get();

    if (!codeDoc.exists) {
      return new Response(JSON.stringify({ error: '유효하지 않은 백업 코드입니다.' }), { status: 400, headers: corsHeaders });
    }

    const data = codeDoc.data();

    if (data?.usedAt) {
      return new Response(JSON.stringify({ error: '이미 사용된 백업 코드입니다.' }), { status: 400, headers: corsHeaders });
    }

    if (data?.expiresAt?.toMillis() < Date.now()) {
      return new Response(JSON.stringify({ error: '만료된 백업 코드입니다.' }), { status: 400, headers: corsHeaders });
    }

    const sourceUUID = data?.sourceUUID;

    const [charactersSnap, chatMessagesSnap, diariesSnap] = await Promise.all([
      firestore.collection('characters').where('userId', '==', sourceUUID).get(),
      firestore.collection('chatMessages').where('userId', '==', sourceUUID).get(),
      firestore.collection('diaries').where('userId', '==', sourceUUID).get(),
    ]);

    const BATCH_LIMIT = 500;
    let currentBatch = firestore.batch();
    let opCount = 0;
    const batches = [currentBatch];

    const commitBatchIfNeeded = () => {
      if (opCount >= BATCH_LIMIT) {
        currentBatch = firestore.batch();
        batches.push(currentBatch);
        opCount = 0;
      }
    };

    charactersSnap.docs.forEach((d) => {
      currentBatch.update(d.ref, { userId: uid });
      opCount++;
      commitBatchIfNeeded();
    });

    chatMessagesSnap.docs.forEach((d) => {
      currentBatch.update(d.ref, { userId: uid });
      opCount++;
      commitBatchIfNeeded();
    });

    diariesSnap.docs.forEach((d) => {
      currentBatch.update(d.ref, { userId: uid });
      opCount++;
      commitBatchIfNeeded();
    });

    currentBatch.update(codeRef, { 
      usedAt: FieldValue.serverTimestamp(),
      usedByUserId: uid
    });
    opCount++;

    await Promise.all(batches.map(batch => batch.commit()));

    return new Response(JSON.stringify({ success: true, message: '이관이 완료되었습니다.' }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('Backup Migrate Error:', error);
    return new Response(JSON.stringify({ error: '데이터 이관 중 오류가 발생했습니다.' }), { status: 500, headers: corsHeaders });
  }
}
