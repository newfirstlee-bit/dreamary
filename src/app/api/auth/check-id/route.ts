import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    }

    const accountsRef = collection(db, 'accounts');
    const q = query(accountsRef, where('id', '==', id));
    const snapshot = await getDocs(q);

    return NextResponse.json({ exists: !snapshot.empty });
  } catch (error) {
    console.error('Check ID Error:', error);
    return NextResponse.json({ error: 'Server Error' }, { status: 500 });
  }
}
