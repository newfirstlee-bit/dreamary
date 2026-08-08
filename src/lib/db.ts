import { db } from './firebase';
import { collection, doc, getDocs, setDoc, updateDoc, deleteDoc, getDoc, query, where, orderBy, limit, getCountFromServer, onSnapshot, writeBatch, DocumentReference } from 'firebase/firestore';

export interface OwnershipMigration {
  refs: DocumentReference[];
}

export const prepareOwnershipMigration = async (sourceUserId: string): Promise<OwnershipMigration> => {
  const collections = ['characters', 'diaries', 'chatMessages'];
  const snapshots = await Promise.all(
    collections.map(name => getDocs(query(collection(db, name), where('userId', '==', sourceUserId))))
  );
  return { refs: snapshots.flatMap(snapshot => snapshot.docs.map(item => item.ref)) };
};

export const completeOwnershipMigration = async (migration: OwnershipMigration, targetUserId: string) => {
  for (let start = 0; start < migration.refs.length; start += 500) {
    const batch = writeBatch(db);
    migration.refs.slice(start, start + 500).forEach(ref => batch.update(ref, { userId: targetUserId }));
    await batch.commit();
  }
};

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
  await setDoc(doc(db, 'characters', char.id), char);
};

export const deleteMessage = async (msgId: string) => {
  await deleteDoc(doc(db, 'chatMessages', msgId));
};

export const unlockMessageAd = async (msgId: string) => {
  await updateDoc(doc(db, 'chatMessages', msgId), { isAdLocked: false });
};

export const deleteCharacter = async (id: string) => {
  await deleteDoc(doc(db, 'characters', id));
  // Delete related diaries
  const diaryQ = query(collection(db, 'diaries'), where('characterId', '==', id));
  const diarySnap = await getDocs(diaryQ);
  for (const d of diarySnap.docs) await deleteDoc(d.ref);
  // Delete related chat messages
  const chatQ = query(collection(db, 'chatMessages'), where('characterId', '==', id));
  const chatSnap = await getDocs(chatQ);
  for (const c of chatSnap.docs) await deleteDoc(c.ref);
};

// Users CRUD
export const getUserProfile = async (id: string): Promise<UserProfile | null> => {
  const d = await getDoc(doc(db, 'users', id));
  if (d.exists()) return d.data() as UserProfile;
  return null;
};

export const saveUserProfile = async (user: UserProfile) => {
  await setDoc(doc(db, 'users', user.id), user);
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

// Topics CRUD
export const getTopics = async (): Promise<Topic[]> => {
  const snapshot = await getDocs(collection(db, 'topics'));
  return snapshot.docs.map(doc => doc.data() as Topic).sort((a, b) => a.order - b.order);
};

export const saveTopic = async (topic: Topic) => {
  await setDoc(doc(db, 'topics', topic.id), topic);
};

export const deleteTopic = async (topicId: string) => {
  await deleteDoc(doc(db, 'topics', topicId));
};

export const getTopicAnswerCount = async (topicId: string): Promise<number> => {
  const q = query(collection(db, 'diaries'), where('topicId', '==', topicId));
  const snapshot = await getCountFromServer(q);
  return snapshot.data().count;
};

// Diaries CRUD
export const getDiariesByUserAndChar = async (userId: string, characterId: string): Promise<Diary[]> => {
  const q = query(collection(db, 'diaries'), where('userId', '==', userId), where('characterId', '==', characterId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as Diary).sort((a, b) => b.createdAt - a.createdAt);
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
    console.warn('Today diary optimized query failed; falling back to full diary list.', error);
    const diaries = await getDiariesByUserAndChar(userId, characterId);
    return diaries.find(d => d.dateString === dateString) || null;
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
    console.warn('Diary count optimized query failed; falling back to full diary list.', error);
    const diaries = await getDiariesByUserAndChar(userId, characterId);
    return diaries.length;
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
      callback(snapshot.empty ? null : (snapshot.docs[0].data() as Diary));
    },
    (error) => {
      console.warn('Today diary subscription failed; falling back to one-time full diary read.', error);
      getDiariesByUserAndChar(userId, characterId)
        .then(diaries => callback(diaries.find(d => d.dateString === dateString) || null))
        .catch(() => callback(null));
    }
  );
};

export const saveDiary = async (diary: Diary) => {
  await setDoc(doc(db, 'diaries', diary.id), diary);
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
    console.warn('Latest chat optimized query failed; falling back to full chat history.', error);
    const msgs = await getChatMessages(userId, characterId);
    return msgs.length > 0 ? msgs[msgs.length - 1] : null;
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
