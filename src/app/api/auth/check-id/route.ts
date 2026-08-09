import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function getAdminDb() {
  const [{ cert, getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);

  if (!getApps().length) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!rawServiceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set');
    initializeApp({ credential: cert(JSON.parse(rawServiceAccount)) });
  }

  return getFirestore();
}

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    }

    const adminDb = await getAdminDb();
    const snapshot = await adminDb.collection('accounts').where('id', '==', id).get();

    return NextResponse.json({ exists: !snapshot.empty });
  } catch (error) {
    console.error('Check ID Error:', error);
    return NextResponse.json({ error: 'auth.serverError' }, { status: 500 });
  }
}
