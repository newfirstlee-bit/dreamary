import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/server/adminSession';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

async function countCollection(collectionName: string) {
  if (!adminDb) throw new Error('Firebase Admin is not initialized');
  const snapshot = await adminDb.collection(collectionName).count().get();
  return Number(snapshot.data().count || 0);
}

export async function GET(req: Request) {
  if (process.env.NEXT_PUBLIC_BUILD_TARGET !== 'app' && !await isAdminRequest(req)) return NextResponse.json({ error: '관리자 인증이 필요합니다.' }, { status: 401 });
  try {
    if (process.env.NEXT_PUBLIC_BUILD_TARGET === 'app') {
      return NextResponse.json({ users: 0, characters: 0, diaries: 0, chats: 0 });
    }

    const [users, characters, diaries, chats] = await Promise.all([
      countCollection('accounts'),
      countCollection('characters'),
      countCollection('diaries'),
      countCollection('chatMessages'),
    ]);

    return NextResponse.json({
      users,
      characters,
      diaries,
      chats,
    });
  } catch (error: any) {
    console.error('Admin stats failed:', error);
    return NextResponse.json({ error: error?.message || 'Failed to load admin stats' }, { status: 500 });
  }
}
