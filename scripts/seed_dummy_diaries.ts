import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, getDocs, setDoc, doc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const run = async () => {
  try {
    const q = query(collection(db, 'characters'));
    const snapshot = await getDocs(q);
    
    for (const charDoc of snapshot.docs) {
      const charData = charDoc.data();
      const charId = charData.id;
      const userId = charData.userId;
      
      // skip invalid character without userId
      if (!userId) continue;
      
      console.log(`Inserting for ${charData.name}! charId: ${charId}, userId: ${userId}`);
      
      const now = new Date();
      
      // Yesterday
      const d1 = new Date(now);
      d1.setDate(d1.getDate() - 1);
      const dateStr1 = d1.toISOString().split('T')[0];
      
      const diary1 = {
        id: `dummy-diary-1-${charId}-${Date.now()}`,
        userId,
        characterId: charId,
        topicId: 'topic-0',
        topicContent: '가장 최근에 크게 웃었던 일은 뭐야?',
        userEntry: 'ㅇㅇ',
        charReply: 'ㅇㅇ',
        dateString: dateStr1,
        createdAt: d1.getTime()
      };
      
      await setDoc(doc(db, 'diaries', diary1.id), diary1);
      console.log(`Inserted diary for ${dateStr1}`);
      
      // Day before yesterday
      const d2 = new Date(now);
      d2.setDate(d2.getDate() - 2);
      const dateStr2 = d2.toISOString().split('T')[0];
      
      const diary2 = {
        id: `dummy-diary-2-${charId}-${Date.now()}`,
        userId,
        characterId: charId,
        topicId: 'topic-1',
        topicContent: '만약 초능력을 가질 수 있다면 어떤 능력을 갖고 싶어?',
        userEntry: 'ㅇㅇ',
        charReply: 'ㅇㅇ',
        dateString: dateStr2,
        createdAt: d2.getTime()
      };
      
      await setDoc(doc(db, 'diaries', diary2.id), diary2);
      console.log(`Inserted diary for ${dateStr2}`);
    }
    
    console.log('Done!');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

run();
