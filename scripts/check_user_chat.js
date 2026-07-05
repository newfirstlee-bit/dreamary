const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, orderBy } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyAyBvC5LKN8YW7z-Bz6cekWufjvLk0-fzI",
  authDomain: "dreamary-1a9af.firebaseapp.com",
  projectId: "dreamary-1a9af",
  storageBucket: "dreamary-1a9af.firebasestorage.app",
  messagingSenderId: "169959391337",
  appId: "1:169959391337:web:278553b615bb52d01b62f8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const TARGET_USER_ID = 'bce3efd8-630d-4637-a579-53684132d960';

async function main() {
  console.log(`\n=== 유저 ${TARGET_USER_ID} 채팅 메시지 조회 ===\n`);

  // 1. 해당 유저의 모든 채팅 메시지 조회
  const chatQ = query(
    collection(db, 'chatMessages'),
    where('userId', '==', TARGET_USER_ID)
  );
  const chatSnap = await getDocs(chatQ);
  
  if (chatSnap.empty) {
    console.log('채팅 메시지가 없습니다.');
    process.exit(0);
  }
  
  const allMessages = chatSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
  allMessages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  
  // 캐릭터별로 그룹핑
  const grouped = {};
  for (const msg of allMessages) {
    const charId = msg.characterId;
    if (!grouped[charId]) grouped[charId] = [];
    grouped[charId].push(msg);
  }
  
  console.log(`총 메시지 수: ${allMessages.length}`);
  console.log(`캐릭터 수: ${Object.keys(grouped).length}\n`);
  
  for (const [charId, msgs] of Object.entries(grouped)) {
    console.log(`\n--- 캐릭터: ${charId} (${msgs.length}개 메시지) ---`);
    
    // 마지막 10개 메시지만 표시
    const recentMsgs = msgs.slice(-15);
    
    for (const msg of recentMsgs) {
      const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : 'N/A';
      const role = msg.role === 'user' ? '👤 USER' : '🤖 AI';
      const locked = msg.isAdLocked ? ' [AD LOCKED]' : '';
      const content = (msg.content || '').substring(0, 80);
      console.log(`  [${time}] ${role}${locked}: ${content}${msg.content?.length > 80 ? '...' : ''}`);
    }
    
    // 분석: 연속 user 메시지 확인
    let consecutiveUser = 0;
    let maxConsecutiveUser = 0;
    let lastMsgWasUser = false;
    
    for (const msg of msgs) {
      if (msg.role === 'user') {
        consecutiveUser++;
        if (consecutiveUser > maxConsecutiveUser) maxConsecutiveUser = consecutiveUser;
        lastMsgWasUser = true;
      } else {
        consecutiveUser = 0;
        lastMsgWasUser = false;
      }
    }
    
    const lastMsg = msgs[msgs.length - 1];
    console.log(`\n  📊 분석:`);
    console.log(`    마지막 메시지: ${lastMsg.role} (${new Date(lastMsg.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);
    console.log(`    최대 연속 user 메시지: ${maxConsecutiveUser}`);
    console.log(`    현재 연속 user 메시지: ${consecutiveUser}`);
    
    if (consecutiveUser >= 2) {
      console.log(`    ⚠️  AI 응답 미생성 감지! 마지막 ${consecutiveUser}개 user 메시지에 AI 응답 없음`);
    }
  }
  
  // 2. 해당 유저의 캐릭터 정보 조회
  console.log(`\n\n=== 유저 캐릭터 조회 ===`);
  const charQ = query(
    collection(db, 'characters'),
    where('userId', '==', TARGET_USER_ID)
  );
  const charSnap = await getDocs(charQ);
  
  if (charSnap.empty) {
    console.log('캐릭터가 없습니다.');
  } else {
    for (const d of charSnap.docs) {
      const data = d.data();
      console.log(`  캐릭터 ID: ${d.id}, 이름: ${data.name}`);
    }
  }
  
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
