"use client";

import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Diary, ChatMessage, Character } from '@/lib/db';

export default function AdminPairDetail({ params }: { params: { id: string; characterId: string } }) {
  const router = useRouter();
  const { id: userId, characterId } = params;

  const [loading, setLoading] = useState(true);
  const [character, setCharacter] = useState<Character | null>(null);
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [chats, setChats] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const fetchPairData = async () => {
      try {
        setLoading(true);

        // Fetch Character Info
        const charDoc = await getDoc(doc(db, 'characters', characterId));
        if (charDoc.exists()) {
          setCharacter(charDoc.data() as Character);
        }

        // Fetch Diaries
        const diaryQ = query(collection(db, 'diaries'), where('characterId', '==', characterId));
        const diarySnap = await getDocs(diaryQ);
        const fetchedDiaries = diarySnap.docs.map(d => d.data() as Diary);
        fetchedDiaries.sort((a, b) => a.createdAt - b.createdAt); // oldest first
        setDiaries(fetchedDiaries);

        // Fetch Chats
        const chatQ = query(collection(db, 'chatMessages'), where('characterId', '==', characterId));
        const chatSnap = await getDocs(chatQ);
        const fetchedChats = chatSnap.docs.map(d => d.data() as ChatMessage);
        fetchedChats.sort((a, b) => a.createdAt - b.createdAt); // oldest first
        setChats(fetchedChats);

      } catch (err) {
        console.error(err);
        alert('데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    fetchPairData();
  }, [characterId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" />
      </div>
    );
  }

  const pairName = character ? (character.pairName || character.name || '이름 없음') : '이름 없음';
  const charName = character ? (character.name || '캐릭터') : '캐릭터';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '20px' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>페어 상세 로그 ({pairName})</h2>
      </div>

      <div style={{ display: 'flex', flex: 1, gap: '20px', overflow: 'hidden' }}>
        
        {/* Diaries Panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #ddd', overflow: 'hidden' }}>
          <div style={{ backgroundColor: 'var(--gray-100)', padding: '15px', borderBottom: '1px solid #ddd', fontWeight: 'bold' }}>
            일기 상세 로그 (총 {diaries.length}개)
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {diaries.length === 0 ? (
              <div style={{ color: 'var(--gray-500)', textAlign: 'center', marginTop: '20px' }}>작성된 일기가 없습니다.</div>
            ) : (
              diaries.map(diary => (
                <div key={diary.id} style={{ backgroundColor: 'var(--gray-50)', padding: '15px', borderRadius: '10px', border: '1px solid #eee' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '8px' }}>
                    {new Date(diary.createdAt).toLocaleString()} • {diary.topicContent || '일기 작성'}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: 'var(--gray-800)' }}>
                    <strong>[유저]</strong><br/>
                    {diary.userEntry}
                    {diary.charReply && (
                      <>
                        <br/><br/>
                        <strong>[{charName}]</strong><br/>
                        {diary.charReply}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Chats Panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #ddd', overflow: 'hidden' }}>
          <div style={{ backgroundColor: 'var(--gray-100)', padding: '15px', borderBottom: '1px solid #ddd', fontWeight: 'bold' }}>
            채팅 상세 로그 (총 {chats.length}개 / 턴 수: {chats.filter(c => c.role === 'user').length}턴)
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {chats.length === 0 ? (
              <div style={{ color: 'var(--gray-500)', textAlign: 'center', marginTop: '20px' }}>채팅 내역이 없습니다.</div>
            ) : (
              chats.map(chat => {
                const isUser = chat.role === 'user';
                return (
                  <div key={chat.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', width: '100%' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)', marginBottom: '4px', marginLeft: isUser ? 0 : '5px', marginRight: isUser ? '5px' : 0 }}>
                      {isUser ? '유저' : charName} • {new Date(chat.createdAt).toLocaleString()}
                    </div>
                    <div style={{ 
                      backgroundColor: isUser ? 'var(--point-color)' : 'var(--gray-100)', 
                      color: isUser ? 'white' : 'var(--gray-800)',
                      padding: '10px 15px', 
                      borderRadius: '15px', 
                      borderTopRightRadius: isUser ? '0' : '15px',
                      borderTopLeftRadius: isUser ? '15px' : '0',
                      maxWidth: '85%',
                      whiteSpace: 'pre-wrap',
                      lineHeight: '1.5'
                    }}>
                      {chat.content}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
