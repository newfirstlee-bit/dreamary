import { auth, db } from './firebase';
import { profileReadCache, topicReadCache } from './dataReadCache';
import { getStoredGuestUserId, retireGuestIdentity, getUserId } from './auth';
import { collection, doc, getDocs, setDoc, updateDoc, deleteDoc, getDoc, query, where, orderBy, limit, getCountFromServer, onSnapshot, runTransaction, startAfter, QueryDocumentSnapshot, DocumentData } from './dataFirestore';
import { getDiaryDailyDocId } from './diaryIdentity';
import { getGuestSession } from './guestSession';
import { apiPostJson } from './api';

export interface OwnershipMigration {
  sourceUserId: string;
  token: string;
}

export const prepareOwnershipMigration = async (sourceUserId: string): Promise<OwnershipMigration> => {
  return { sourceUserId, token: await getGuestSession(sourceUserId) };
};

const migrations = new Map<string, Promise<void>>();
export const completeOwnershipMigration = (migration: OwnershipMigration, targetUserId: string): Promise<void> => {
  const key = `${migration.sourceUserId}:${targetUserId}`;
  const pending = migrations.get(key);
  if (pending) return pending;
  const request = (async () => {
    // Bounded pages; a failed request is resumed explicitly, not auto-replayed.
    for (let page = 0; page < 100; page++) {
      const result = await apiPostJson<{ done: boolean }>('/api/backup/migrate', {
        sourceUUID: migration.sourceUserId, uid: targetUserId,
      }, { headers: { 'X-Guest-Authorization': `Guest ${migration.token}` } });
      if (result.done) { retireGuestIdentity(migration.sourceUserId); return; }
    }
    throw new Error('이전할 데이터가 많습니다. 다시 로그인하여 이어서 진행해주세요.');
  })().finally(() => migrations.delete(key));
  migrations.set(key, request);
  return request;
};

export async function migrateGuestBackup(code: string, uid: string) {
  for (let page = 0; page < 100; page++) {
    const result = await apiPostJson<{ done: boolean; sourceUUID: string }>('/api/backup/migrate', { code, uid });
    if (result.done) { retireGuestIdentity(result.sourceUUID); return; }
  }
  throw new Error('이전할 데이터가 많습니다. 같은 백업 코드로 다시 시도해주세요.');
}

export interface Character {
  id: string;
  userId: string;
  name: string;
  gender?: '남성' | '여성' | '그 외';
  feeling: string;
  title: string;
  exampleChat: string;
  negative: string;
  worldview?: string;
  extra?: string;
  narrative?: string;
  image?: string;
  pairName?: string;
  homeBackgroundImage?: string;
  homeTheme?: 'dark' | 'light';
  dDayStartDate?: number;
  locale?: string;
  createdAt: number;
}

export interface UserProfile {
  id: string; // User's UUID
  name: string;
  gender?: '남성' | '여성' | '그 외';
  feeling: string;
  extra?: string;
  image?: string;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  characterId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  timestamp?: number;
  isAdLocked?: boolean;
  requestId?: string;
}

// Characters CRUD
export const getCharactersByUser = async (userId: string): Promise<Character[]> => {
  const q = query(collection(db, 'characters'), where('userId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Character);
};

export const getCharacter = async (id: string): Promise<Character | null> => {
  const d = await getDoc(doc(db, 'characters', id));
  return d.exists() ? (d.data() as Character) : null;
};

export const saveCharacter = async (char: Character) => {
  // Bind a new guest before creating its first remotely stored data.
  if (!auth.currentUser) await getGuestSession(char.userId);
  await setDoc(doc(db, 'characters', char.id), char);
};

export const deleteMessage = async (msgId: string) => {
  await deleteDoc(doc(db, 'chatMessages', msgId));
};

export const unlockMessageAd = async (msgId: string) => {
  await updateDoc(doc(db, 'chatMessages', msgId), { isAdLocked: false });
};

export const deleteCharacter = async (id: string) => {
  const userId = getUserId();
  for (let page = 0; page < 100; page++) {
    const result = await apiPostJson<{ done: boolean }>('/api/character/delete', { userId, characterId: id });
    if (result.done) return;
  }
  throw new Error('삭제할 데이터가 많습니다. 같은 캐릭터 삭제를 다시 시도해주세요.');
};

// Users CRUD
export const getUserProfile = async (id: string): Promise<UserProfile | null> => {
  const ownerId = auth.currentUser?.uid || getStoredGuestUserId();
  const read = async () => {
    const d = await getDoc(doc(db, 'users', id));
    return d.exists() ? d.data() as UserProfile : null;
  };
  // Never share an anonymous cache key across guest UUIDs or server-side requests.
  return ownerId ? profileReadCache.get(`${ownerId}:${id}`, read) : read();
};

export const saveUserProfile = async (user: UserProfile) => {
  profileReadCache.clear();
  try {
    await setDoc(doc(db, 'users', user.id), user);
  } finally {
    profileReadCache.clear();
  }
};

// --- Diary & Topic Models ---

export interface Topic {
  id: string;
  content: string;
  contentJa?: string;
  order: number;
}

export interface Diary {
  id: string;
  userId: string;
  characterId: string;
  topicId: string;
  topicContent: string;
  userEntry: string;
  charReply?: string;
  dateString: string; // e.g. "YYYY-MM-DD"
  createdAt: number;
  isAdLocked?: boolean;
  requestId?: string;
}

export interface DiaryPage {
  diaries: Diary[];
  nextCursor: QueryDocumentSnapshot<DocumentData> | null;
}

export { getDiaryDailyDocId };

// Topics CRUD
export const getTopics = async (): Promise<Topic[]> => {
  return topicReadCache.get('topics', async () => {
    const snapshot = await getDocs(collection(db, 'topics'));
    return snapshot.docs.map(doc => doc.data() as Topic).sort((a, b) => a.order - b.order);
  });
};

export const saveTopic = async (topic: Topic) => {
  await apiPostJson('/api/admin/topics-data', { action: 'save', topic });
  topicReadCache.clear();
};

export const deleteTopic = async (topicId: string) => {
  await apiPostJson('/api/admin/topics-data', { action: 'delete', id: topicId });
  topicReadCache.clear();
};

export const getTopicAnswerCount = async (topicId: string): Promise<number> => {
  const result = await apiPostJson<{ count: number }>('/api/admin/topics-data', { action: 'count', id: topicId });
  return result.count;
};

// Diaries CRUD
export const getDiariesByUserAndChar = async (userId: string, characterId: string): Promise<Diary[]> => {
  const q = query(collection(db, 'diaries'), where('userId', '==', userId), where('characterId', '==', characterId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Diary).sort((a, b) => b.createdAt - a.createdAt);
};

export const getDiariesByUserAndCharPage = async (
  userId: string,
  characterId: string,
  pageSize = 30,
  cursor?: QueryDocumentSnapshot<DocumentData> | null
): Promise<DiaryPage> => {
  const constraints = [
    where('userId', '==', userId),
    where('characterId', '==', characterId),
    limit(pageSize),
  ];
  const q = cursor
    ? query(collection(db, 'diaries'), ...constraints, startAfter(cursor))
    : query(collection(db, 'diaries'), ...constraints);
  const snapshot = await getDocs(q);
  return {
    diaries: snapshot.docs.map(doc => doc.data() as Diary),
    nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null,
  };
};

export const getAdjacentDiaryIds = async (
  userId: string,
  characterId: string,
  createdAt: number
): Promise<{ prevDiaryId: string | null; nextDiaryId: string | null }> => {
  const olderQuery = query(
    collection(db, 'diaries'),
    where('userId', '==', userId),
    where('characterId', '==', characterId),
    where('createdAt', '<', createdAt),
    orderBy('createdAt', 'desc'),
    limit(1)
  );
  const newerQuery = query(
    collection(db, 'diaries'),
    where('userId', '==', userId),
    where('characterId', '==', characterId),
    where('createdAt', '>', createdAt),
    orderBy('createdAt', 'asc'),
    limit(1)
  );

  try {
    const [olderSnap, newerSnap] = await Promise.all([
      getDocs(olderQuery),
      getDocs(newerQuery),
    ]);

    return {
      prevDiaryId: olderSnap.empty ? null : (olderSnap.docs[0].data() as Diary).id,
      nextDiaryId: newerSnap.empty ? null : (newerSnap.docs[0].data() as Diary).id,
    };
  } catch (error) {
    console.warn('Adjacent diary query failed; skipping unbounded fallback to protect Firestore quota.', error);
    return { prevDiaryId: null, nextDiaryId: null };
  }
};

export const getTodayDiaryByUserAndChar = async (
  userId: string,
  characterId: string,
  dateString: string
): Promise<Diary | null> => {
  try {
    const q = query(
      collection(db, 'diaries'),
      where('userId', '==', userId),
      where('characterId', '==', characterId),
      where('dateString', '==', dateString),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return snapshot.docs[0].data() as Diary;
  } catch (error) {
    console.warn('Today diary optimized query failed; skipping full diary fallback to protect Firestore quota.', error);
    return null;
  }
};

export const getDiaryCountByUserAndChar = async (userId: string, characterId: string): Promise<number> => {
  try {
    const q = query(
      collection(db, 'diaries'),
      where('userId', '==', userId),
      where('characterId', '==', characterId)
    );
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
  } catch (error) {
    console.warn('Diary count optimized query failed; skipping full diary fallback to protect Firestore quota.', error);
    return 0;
  }
};

export const subscribeDiaries = (userId: string, characterId: string, callback: (diaries: Diary[]) => void) => {
  const q = query(
    collection(db, 'diaries'),
    where('userId', '==', userId),
    where('characterId', '==', characterId)
  );
  return onSnapshot(q, (snapshot) => {
    const d = snapshot.docs.map(doc => doc.data() as Diary);
    d.sort((a, b) => b.createdAt - a.createdAt);
    callback(d);
  });
};

export const subscribeTodayDiary = (
  userId: string,
  characterId: string,
  dateString: string,
  callback: (diary: Diary | null) => void
) => {
  const q = query(
    collection(db, 'diaries'),
    where('userId', '==', userId),
    where('characterId', '==', characterId),
    where('dateString', '==', dateString),
    limit(1)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      // An initial empty offline cache is not proof that a server-saved diary
      // disappeared. Keep the API result until an authoritative snapshot arrives.
      if (snapshot.empty && snapshot.metadata.fromCache) return;
      callback(snapshot.empty ? null : (snapshot.docs[0].data() as Diary));
    },
    (error) => {
      console.warn('Today diary subscription failed; skipping full diary fallback to protect Firestore quota.', error);
    }
  );
};

export const saveDiary = async (diary: Diary) => {
  await setDoc(doc(db, 'diaries', diary.id), diary);
};

export const saveDiaryOncePerDay = async (diary: Diary): Promise<{ diary: Diary; created: boolean }> => {
  const docRef = doc(db, 'diaries', diary.id);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    if (snapshot.exists()) {
      return { diary: snapshot.data() as Diary, created: false };
    }

    transaction.set(docRef, diary);
    return { diary, created: true };
  });
};

export const unlockDiaryAd = async (diaryId: string) => {
  await updateDoc(doc(db, 'diaries', diaryId), { isAdLocked: false });
};

export const getDiaryById = async (id: string): Promise<Diary | null> => {
  const docRef = doc(db, 'diaries', id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return snapshot.data() as Diary;
};

export const getDiaryByRequestId = async (requestId: string): Promise<Diary | null> => {
  const q = query(collection(db, 'diaries'), where('requestId', '==', requestId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as Diary;
};

export async function updateCharacter(charId: string, data: Partial<Character>) {
  const docRef = doc(db, 'characters', charId);
  await setDoc(docRef, data, { merge: true });
}

export async function updatePairName(charId: string, pairName: string) {
  const docRef = doc(db, 'characters', charId);
  await setDoc(docRef, { pairName }, { merge: true });
}

export const getCharacterById = async (id: string): Promise<Character | null> => {
  const docRef = doc(db, 'characters', id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return snapshot.data() as Character;
};

// Chat CRUD
export const getChatMessages = async (userId: string, characterId: string): Promise<ChatMessage[]> => {
  const q = query(
    collection(db, 'chatMessages'),
    where('userId', '==', userId),
    where('characterId', '==', characterId)
  );
  const snapshot = await getDocs(q);
  const msgs = snapshot.docs.map(doc => doc.data() as ChatMessage);
  return msgs.sort((a: any, b: any) => (a.createdAt || a.timestamp || 0) - (b.createdAt || b.timestamp || 0));
};

export const getLatestChatMessage = async (userId: string, characterId: string): Promise<ChatMessage | null> => {
  try {
    const q = query(
      collection(db, 'chatMessages'),
      where('userId', '==', userId),
      where('characterId', '==', characterId),
      orderBy('createdAt', 'desc'),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return snapshot.docs[0].data() as ChatMessage;
  } catch (error) {
    console.warn('Latest chat optimized query failed; using bounded fallback to protect Firestore quota.', error);
  }

  try {
    const q = query(
      collection(db, 'chatMessages'),
      where('userId', '==', userId),
      where('characterId', '==', characterId),
      limit(30)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const messages = snapshot.docs.map(doc => doc.data() as ChatMessage);
    messages.sort((a, b) => (b.createdAt || b.timestamp || 0) - (a.createdAt || a.timestamp || 0));
    return messages[0] || null;
  } catch (fallbackError) {
    console.warn('Latest chat bounded fallback failed.', fallbackError);
    return null;
  }
};

export const subscribeChatMessages = (userId: string, characterId: string, callback: (msgs: ChatMessage[]) => void) => {
  const q = query(
    collection(db, 'chatMessages'),
    where('userId', '==', userId),
    where('characterId', '==', characterId)
  );
  return onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs.map(doc => doc.data() as ChatMessage);
    msgs.sort((a: any, b: any) => (a.createdAt || a.timestamp || 0) - (b.createdAt || b.timestamp || 0));
    callback(msgs);
  });
};

export const saveChatMessage = async (message: ChatMessage) => {
  await setDoc(doc(db, 'chatMessages', message.id), message);
};

export const updateChatMessage = async (msgId: string, content: string) => {
  await updateDoc(doc(db, 'chatMessages', msgId), { content });
};

export const deleteChatMessages = async (userId: string, characterId: string) => {
  const q = query(
    collection(db, 'chatMessages'),
    where('userId', '==', userId),
    where('characterId', '==', characterId)
  );
  const snapshot = await getDocs(q);
  const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
  await Promise.all(deletePromises);
};

export const getMessageByRequestId = async (requestId: string): Promise<ChatMessage | null> => {
  const q = query(collection(db, 'chatMessages'), where('requestId', '==', requestId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as ChatMessage;
};
