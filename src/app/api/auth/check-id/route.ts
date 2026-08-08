import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(req: Request) {
  try {
    if (!adminDb) {
      return NextResponse.json({ error: 'auth.serverConfigError' }, { status: 500 });
    }

    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    }

    const snapshot = await adminDb.collection('accounts').where('id', '==', id).get();

    return NextResponse.json({ exists: !snapshot.empty });
  } catch (error) {
    console.error('Check ID Error:', error);
    return NextResponse.json({ error: 'auth.serverError' }, { status: 500 });
  }
}
