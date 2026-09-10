// Shared module: keep outside functions/ so Netlify does not deploy it as a function.
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { formatKoreanNameTemplate } from '../../src/lib/koreanJosa';

export const KST_DAILY_PUSH_HOUR_UTC = 11; // 20:00 KST

export function getFirebaseAdminServices() {
  if (!getApps().length) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!rawServiceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set');
    initializeApp({ credential: cert(JSON.parse(rawServiceAccount)) });
  }

  return {
    firestore: getFirestore(),
    messaging: getMessaging(),
  };
}

export async function verifyFirebaseIdTokenRest(idToken: string) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is not set');

  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Token verification failed');
  if (!data.users || data.users.length === 0) throw new Error('User not found');
  return data.users[0].localId as string;
}

export function sanitizeDocId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
}

export function getNextKst8Pm(after = new Date()) {
  const kstNow = new Date(after.getTime() + 9 * 60 * 60 * 1000);
  let candidate = new Date(Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
    KST_DAILY_PUSH_HOUR_UTC,
    0,
    0,
    0
  ));

  if (candidate.getTime() <= after.getTime()) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }

  return candidate;
}

export function getTodayKstDateString(now = new Date()) {
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = kstNow.getUTCFullYear();
  const month = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
  const date = String(kstNow.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

export function getTomorrowKst8Pm(after = new Date()) {
  const kstNow = new Date(after.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate() + 1,
    KST_DAILY_PUSH_HOUR_UTC,
    0,
    0,
    0
  ));
}

export function toAdminTimestamp(date: Date) {
  return Timestamp.fromDate(date);
}

export interface DiaryPushCandidate {
  characterId: string;
  lastDiaryDate: string;
  nextTopicOrder: number;
  nextTopicContent: string;
  nextTopicId: string;
  updatedAtMs: number;
}

export function normalizeDiaryPushCandidate(value: any): DiaryPushCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const characterId = typeof value.characterId === 'string' ? value.characterId : '';
  const nextTopicOrder = Number(value.nextTopicOrder || 0);
  const nextTopicContent = typeof value.nextTopicContent === 'string' ? value.nextTopicContent.trim() : '';
  if (!characterId || !Number.isFinite(nextTopicOrder) || nextTopicOrder <= 0 || !nextTopicContent) return null;

  return {
    characterId,
    lastDiaryDate: typeof value.lastDiaryDate === 'string' ? value.lastDiaryDate : '',
    nextTopicOrder,
    nextTopicContent,
    nextTopicId: typeof value.nextTopicId === 'string' ? value.nextTopicId : '',
    updatedAtMs: Number(value.updatedAtMs || 0),
  };
}

export function pickDiaryPushCandidate(candidates: any, todayDateString: string): DiaryPushCandidate | null {
  if (!candidates || typeof candidates !== 'object') return null;

  return Object.values(candidates).reduce<DiaryPushCandidate | null>((best, raw) => {
    const candidate = normalizeDiaryPushCandidate(raw);
    if (!candidate || candidate.lastDiaryDate === todayDateString) return best;
    if (!best) return candidate;
    if (candidate.nextTopicOrder !== best.nextTopicOrder) {
      return candidate.nextTopicOrder > best.nextTopicOrder ? candidate : best;
    }
    return candidate.updatedAtMs > best.updatedAtMs ? candidate : best;
  }, null);
}

export function hasUnresolvedNameTemplateText(value: string) {
  return /{(?:유저|캐릭터|ユーザー|キャラクター)}/.test(value);
}

export function candidatesNeedNameTemplateRebuild(candidates: any) {
  if (!candidates || typeof candidates !== 'object') return false;
  return Object.values(candidates).some(raw => {
    const candidate = normalizeDiaryPushCandidate(raw);
    return candidate ? hasUnresolvedNameTemplateText(candidate.nextTopicContent) : false;
  });
}

export async function buildDiaryPushCandidates(firestore: any, uid: string, locale = 'ko', todayDateString = getTodayKstDateString()) {
  const [charactersSnap, topicsSnap] = await Promise.all([
    firestore.collection('characters').where('userId', '==', uid).get(),
    firestore.collection('topics').get(),
  ]);

  const topics = topicsSnap.docs
    .map((doc: any) => {
      const data = doc.data() || {};
      return {
        ...data,
        id: typeof data.id === 'string' && data.id ? data.id : doc.id,
      };
    })
    .filter((topic: any) => Number(topic.order || 0) > 0 && typeof topic.content === 'string' && topic.content.trim())
    .sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0));

  if (topics.length === 0 || charactersSnap.empty) return {};

  const updatedAtMs = Date.now();
  const entries = await Promise.all(charactersSnap.docs.map(async (characterDoc: any) => {
    const character = characterDoc.data() || {};
    const characterId = typeof character.id === 'string' && character.id ? character.id : characterDoc.id;
    if (!characterId) return null;
    const characterName = typeof character.name === 'string' && character.name
      ? character.name
      : (locale === 'ja' ? 'キャラクター' : '캐릭터');

    const diaryQuery = firestore.collection('diaries')
      .where('userId', '==', uid)
      .where('characterId', '==', characterId);
    const todayDiaryQuery = diaryQuery
      .where('dateString', '==', todayDateString)
      .limit(1);

    const [diaryCountSnap, todayDiarySnap, userProfileSnap] = await Promise.all([
      diaryQuery.count().get(),
      todayDiaryQuery.get(),
      firestore.collection('users').doc(characterId).get(),
    ]);

    const diaryCount = Number(diaryCountSnap.data().count || 0);
    const nextTopic = topics[diaryCount % topics.length] || topics[0];
    const rawContent = locale === 'ja' && typeof nextTopic.contentJa === 'string' && nextTopic.contentJa.trim()
      ? nextTopic.contentJa.trim()
      : nextTopic.content.trim();
    const userProfile = userProfileSnap.exists ? userProfileSnap.data() || {} : {};
    const userName = typeof userProfile.name === 'string' && userProfile.name
      ? userProfile.name
      : (locale === 'ja' ? 'ユーザー' : '유저');
    const content = formatKoreanNameTemplate(rawContent, {
      userName,
      characterName,
    });

    return [
      sanitizeDocId(characterId),
      {
        characterId,
        lastDiaryDate: todayDiarySnap.empty ? '' : todayDateString,
        nextTopicOrder: Number(nextTopic.order || 0),
        nextTopicContent: content,
        nextTopicId: typeof nextTopic.id === 'string' ? nextTopic.id : '',
        updatedAtMs,
      },
    ] as const;
  }));

  return Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, DiaryPushCandidate]>);
}
