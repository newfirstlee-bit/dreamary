import type { Config } from "@netlify/functions";
import { corsHeaders } from './cors';

export const config: Config = {
  path: "/api/account/delete"
};

async function getFirebaseAdmin() {
  const [{ cert, getApps, initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
    import('firebase-admin/firestore'),
  ]);

  if (!getApps().length) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!rawServiceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set');
    initializeApp({ credential: cert(JSON.parse(rawServiceAccount)) });
  }

  return {
    auth: getAuth(),
    firestore: getFirestore(),
  };
}

async function deleteSnapshotDocs(firestore: any, docs: any[]) {
  const BATCH_LIMIT = 450;
  for (let start = 0; start < docs.length; start += BATCH_LIMIT) {
    const batch = firestore.batch();
    docs.slice(start, start + BATCH_LIMIT).forEach((item: any) => batch.delete(item.ref));
    await batch.commit();
  }
}

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const authorization = req.headers.get('authorization') || '';
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!idToken) {
      return new Response(JSON.stringify({ error: '로그인 확인이 필요합니다.' }), { status: 401, headers: corsHeaders });
    }

    const { uid } = await req.json();
    const { auth, firestore } = await getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(idToken);
    if (!uid || decoded.uid !== uid) {
      return new Response(JSON.stringify({ error: '본인 계정만 탈퇴할 수 있습니다.' }), { status: 403, headers: corsHeaders });
    }

    // 사용자 관련 데이터 조회
    const [charactersSnap, chatMessagesSnap, diariesSnap, reportsSnap, usedBackupCodesSnap, ownedBackupCodesSnap] = await Promise.all([
      firestore.collection('characters').where('userId', '==', uid).get(),
      firestore.collection('chatMessages').where('userId', '==', uid).get(),
      firestore.collection('diaries').where('userId', '==', uid).get(),
      firestore.collection('reports').where('userId', '==', uid).get(),
      firestore.collection('backupCodes').where('usedByUserId', '==', uid).get(),
      firestore.collection('backupCodes').where('sourceUUID', '==', uid).get(),
    ]);

    // 캐릭터별 users 프로필 문서 참조
    const userProfileRefs = charactersSnap.docs.map((characterDoc: any) => firestore.collection('users').doc(characterDoc.id));
    const accountRef = firestore.collection('accounts').doc(uid);

    // 순서대로 삭제: 신고 → 백업코드 → 채팅 → 일기 → 프로필 → 캐릭터 → 계정 → Auth
    await deleteSnapshotDocs(firestore, reportsSnap.docs);
    await deleteSnapshotDocs(firestore, usedBackupCodesSnap.docs);
    await deleteSnapshotDocs(firestore, ownedBackupCodesSnap.docs);
    await deleteSnapshotDocs(firestore, chatMessagesSnap.docs);
    await deleteSnapshotDocs(firestore, diariesSnap.docs);

    for (let start = 0; start < userProfileRefs.length; start += 450) {
      const batch = firestore.batch();
      userProfileRefs.slice(start, start + 450).forEach((ref: any) => batch.delete(ref));
      await batch.commit();
    }

    await deleteSnapshotDocs(firestore, charactersSnap.docs);
    await accountRef.delete();
    await auth.deleteUser(uid);

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error: any) {
    console.error('Account Delete Error:', error);
    return new Response(JSON.stringify({ error: error?.message || '회원 탈퇴 중 오류가 발생했습니다.' }), { status: 500, headers: corsHeaders });
  }
}
