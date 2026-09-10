import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/server/adminSession';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

async function getCount(query: FirebaseFirestore.Query) {
  const snapshot = await query.count().get();
  return Number(snapshot.data().count || 0);
}

async function getLatestTimestamp(query: FirebaseFirestore.Query) {
  const snapshot = await query.orderBy('createdAt', 'desc').limit(1).get();
  if (snapshot.empty) return 0;
  return Number(snapshot.docs[0].data()?.createdAt || 0);
}

export async function GET(req: Request) {
  if (process.env.NEXT_PUBLIC_BUILD_TARGET !== 'app' && !await isAdminRequest(req)) return NextResponse.json({ error: '관리자 인증이 필요합니다.' }, { status: 401 });
  try {
    if (process.env.NEXT_PUBLIC_BUILD_TARGET === 'app') {
      return NextResponse.json({
        userProfile: null,
        stats: { firstLogin: 0, lastLogin: 0, charactersCount: 0, diariesCount: 0, chatTurns: 0 },
        pairs: [],
      });
    }

    if (!adminDb) throw new Error('Firebase Admin is not initialized');
    const db = adminDb;

    const url = new URL(req.url);
    const userId = url.searchParams.get('userId') || '';
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const [accountDoc, userDoc, charSnap] = await Promise.all([
      db.collection('accounts').doc(userId).get(),
      db.collection('users').doc(userId).get(),
      db.collection('characters').where('userId', '==', userId).orderBy('createdAt', 'desc').get(),
    ]);

    const characters = charSnap.docs.map<any>(doc => {
      const data = doc.data() || {};
      return {
        ...data,
        id: typeof data.id === 'string' && data.id ? data.id : doc.id,
      };
    });

    const [diariesCount, chatTurns, latestDiaryAt, latestChatAt] = await Promise.all([
      getCount(db.collection('diaries').where('userId', '==', userId)),
      getCount(db.collection('chatMessages').where('userId', '==', userId).where('role', '==', 'user')),
      getLatestTimestamp(db.collection('diaries').where('userId', '==', userId)),
      getLatestTimestamp(db.collection('chatMessages').where('userId', '==', userId)),
    ]);

    const account = accountDoc.exists ? accountDoc.data() || {} : {};
    const userProfile = userDoc.exists ? userDoc.data() || null : null;
    const firstLogin = Number(account.createdAt || 0);
    const lastLogin = Math.max(Number(account.updatedAt || 0), firstLogin, latestDiaryAt, latestChatAt);

    const pairs = await Promise.all(characters.map(async char => {
      const characterId = String(char.id || '');
      const [charDiaries, charChats, profileDoc] = await Promise.all([
        getCount(db.collection('diaries').where('userId', '==', userId).where('characterId', '==', characterId)),
        getCount(db.collection('chatMessages').where('userId', '==', userId).where('characterId', '==', characterId).where('role', '==', 'user')),
        db.collection('users').doc(characterId).get(),
      ]);
      const profile = profileDoc.exists ? profileDoc.data() || {} : {};

      return {
        characterId,
        characterName: typeof char.name === 'string' ? char.name : '이름 없음',
        pairName: typeof char.pairName === 'string' && char.pairName ? char.pairName : (typeof char.name === 'string' ? char.name : '이름 없음'),
        userName: typeof profile.name === 'string' && profile.name ? profile.name : (typeof userProfile?.name === 'string' ? userProfile.name : '알 수 없음'),
        diariesCount: charDiaries,
        chatTurns: charChats,
      };
    }));

    return NextResponse.json({
      userProfile,
      stats: {
        firstLogin,
        lastLogin,
        charactersCount: characters.length,
        diariesCount,
        chatTurns,
      },
      pairs,
    });
  } catch (error: any) {
    console.error('Admin user detail failed:', error);
    return NextResponse.json({ error: error?.message || 'Failed to load admin user detail' }, { status: 500 });
  }
}
