import type { Config } from "@netlify/functions";
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from './cors';

export const config: Config = {
  path: "/api/backup/generate"
};

function generateBackupCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    if (!adminDb) {
      return new Response(JSON.stringify({ error: '서버 설정이 완료되지 않았습니다.' }), { status: 500, headers: corsHeaders });
    }
    const firestore = adminDb;

    const { sourceUUID } = await req.json();
    if (!sourceUUID) {
      return new Response(JSON.stringify({ error: 'UUID가 필요합니다.' }), { status: 400, headers: corsHeaders });
    }

    const today = new Date().toISOString().split('T')[0];
    const usageRef = firestore.collection('backupCodeUsage').doc(`${sourceUUID}_${today}`);
    
    const code = await firestore.runTransaction(async (transaction) => {
      const usageDoc = await transaction.get(usageRef);
      let count = 0;
      
      if (usageDoc.exists) {
        count = usageDoc.data()?.count || 0;
      }
      
      if (count >= 3) {
        throw new Error('하루 발급 한도(3회)를 초과했습니다.');
      }
      
      let newCode = generateBackupCode();
      let codeRef = firestore.collection('backupCodes').doc(newCode);
      let existingCode = await transaction.get(codeRef);
      for (let attempt = 0; existingCode.exists && attempt < 5; attempt += 1) {
        newCode = generateBackupCode();
        codeRef = firestore.collection('backupCodes').doc(newCode);
        existingCode = await transaction.get(codeRef);
      }

      if (existingCode.exists) {
        throw new Error('백업 코드를 생성하지 못했습니다. 다시 시도해주세요.');
      }
      
      const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
      
      transaction.set(usageRef, { count: count + 1, date: today }, { merge: true });
      transaction.set(codeRef, {
        code: newCode,
        sourceUUID,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        usedAt: null,
        usedByUserId: null
      });
      
      return newCode;
    });

    return new Response(JSON.stringify({ code }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('Backup Generate Error:', error);
    if (error.message.includes('한도')) {
      return new Response(JSON.stringify({ error: error.message }), { status: 403, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ error: '서버 오류가 발생했습니다.' }), { status: 500, headers: corsHeaders });
  }
}
