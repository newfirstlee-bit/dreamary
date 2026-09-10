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

async function getCount(query: FirebaseFirestore.Query) {
  const snapshot = await query.count().get();
  return Number(snapshot.data().count || 0);
}

export async function GET(req: Request) {
  if (process.env.NEXT_PUBLIC_BUILD_TARGET !== 'app' && !await isAdminRequest(req)) return NextResponse.json({ error: '관리자 인증이 필요합니다.' }, { status: 401 });
  try {
    if (process.env.NEXT_PUBLIC_BUILD_TARGET === 'app') {
      return NextResponse.json({ users: [], nextCursor: null });
    }

    if (!adminDb) throw new Error('Firebase Admin is not initialized');
    const db = adminDb;

    const url = new URL(req.url);
    const pageSize = parsePageSize(url.searchParams.get('pageSize'));
    const cursor = Number(url.searchParams.get('cursor') || 0);

    let accountQuery: FirebaseFirestore.Query = adminDb
      .collection('accounts')
      .orderBy('createdAt', 'desc')
      .limit(pageSize);

    if (Number.isFinite(cursor) && cursor > 0) {
      accountQuery = accountQuery.startAfter(cursor);
    }

    const accountSnap = await accountQuery.get();
    const users = await Promise.all(accountSnap.docs.map(async accountDoc => {
      const account = accountDoc.data() || {};
      const userId = accountDoc.id;
      const [charactersCount, diariesCount] = await Promise.all([
        getCount(db.collection('characters').where('userId', '==', userId)),
        getCount(db.collection('diaries').where('userId', '==', userId)),
      ]);

      return {
        userId,
        accountId: typeof account.id === 'string' ? account.id : '',
        charactersCount,
        diariesCount,
        lastActivity: Number(account.updatedAt || account.createdAt || 0),
        createdAt: Number(account.createdAt || 0),
      };
    }));

    const lastDoc = accountSnap.docs[accountSnap.docs.length - 1];
    const lastCreatedAt = lastDoc ? Number(lastDoc.data()?.createdAt || 0) : 0;

    return NextResponse.json({
      users,
      nextCursor: accountSnap.docs.length === pageSize && lastCreatedAt > 0 ? String(lastCreatedAt) : null,
    });
  } catch (error: any) {
    console.error('Admin users failed:', error);
    return NextResponse.json({ error: error?.message || 'Failed to load admin users' }, { status: 500 });
  }
}
