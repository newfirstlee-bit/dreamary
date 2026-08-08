import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    docs.slice(start, start + BATCH_LIMIT).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

export async function OPTIONS() {
  return NextResponse.json(null, { status: 204 });
}

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization') || '';
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!idToken) {
      return NextResponse.json({ error: '로그인 확인이 필요합니다.' }, { status: 401 });
    }

    const { uid } = await req.json();
    const { auth, firestore } = await getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(idToken);
    if (!uid || decoded.uid !== uid) {
      return NextResponse.json({ error: '본인 계정만 탈퇴할 수 있습니다.' }, { status: 403 });
    }

    const [charactersSnap, chatMessagesSnap, diariesSnap, reportsSnap, usedBackupCodesSnap, ownedBackupCodesSnap] = await Promise.all([
      firestore.collection('characters').where('userId', '==', uid).get(),
      firestore.collection('chatMessages').where('userId', '==', uid).get(),
      firestore.collection('diaries').where('userId', '==', uid).get(),
      firestore.collection('reports').where('userId', '==', uid).get(),
      firestore.collection('backupCodes').where('usedByUserId', '==', uid).get(),
      firestore.collection('backupCodes').where('sourceUUID', '==', uid).get(),
    ]);

    const userProfileRefs = charactersSnap.docs.map((characterDoc: any) => firestore.collection('users').doc(characterDoc.id));
    const accountRef = firestore.collection('accounts').doc(uid);

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

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Account Delete Error:', error);
    return NextResponse.json({ error: error?.message || '회원 탈퇴 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
