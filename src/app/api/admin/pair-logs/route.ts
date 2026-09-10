import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/server/adminSession';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function parsePageSize(value: string | null) {
  const size = Number(value || DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(size) || size <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(size), MAX_PAGE_SIZE);
}

function getCollectionName(type: string | null) {
  return type === 'chats' ? 'chatMessages' : 'diaries';
}

export async function GET(req: Request) {
  if (process.env.NEXT_PUBLIC_BUILD_TARGET !== 'app' && !await isAdminRequest(req)) return NextResponse.json({ error: '관리자 인증이 필요합니다.' }, { status: 401 });
  try {
    if (process.env.NEXT_PUBLIC_BUILD_TARGET === 'app') {
      return NextResponse.json({ items: [], nextCursor: null });
    }

    if (!adminDb) throw new Error('Firebase Admin is not initialized');
    const db = adminDb;

    const url = new URL(req.url);
    const userId = url.searchParams.get('userId') || '';
    const characterId = url.searchParams.get('characterId') || '';
    const type = url.searchParams.get('type') === 'chats' ? 'chats' : 'diaries';
    const pageSize = parsePageSize(url.searchParams.get('pageSize'));
    const cursor = Number(url.searchParams.get('cursor') || 0);

    if (!userId || !characterId) {
      return NextResponse.json({ error: 'Missing userId or characterId' }, { status: 400 });
    }

    let query: FirebaseFirestore.Query = db
      .collection(getCollectionName(type))
      .where('userId', '==', userId)
      .where('characterId', '==', characterId)
      .orderBy('createdAt', 'desc')
      .limit(pageSize);

    if (Number.isFinite(cursor) && cursor > 0) {
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    const character = url.searchParams.get('includeCharacter') === '1'
      ? (await db.collection('characters').doc(characterId).get()).data() : undefined;
    const items = snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
    }));
    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
    const lastCreatedAt = lastDoc ? Number(lastDoc.data()?.createdAt || 0) : 0;

    return NextResponse.json({
      ...(character?.userId === userId ? { character } : {}),
      items,
      nextCursor: snapshot.docs.length === pageSize && lastCreatedAt > 0 ? String(lastCreatedAt) : null,
    });
  } catch (error: any) {
    console.error('Admin pair logs failed:', error);
    return NextResponse.json({ error: error?.message || 'Failed to load admin pair logs' }, { status: 500 });
  }
}
