"use client";

import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Character, UserProfile, Diary, ChatMessage } from '@/lib/db';

interface PairStat {
  characterId: string;
  characterName: string;
  pairName: string;
  userName: string;
  diariesCount: number;
  chatTurns: number;
}

export default function AdminUserDetail({ params }: { params: { id: string } }) {
  const router = useRouter();
  const userId = params.id;

  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  
  const [stats, setStats] = useState({
    firstLogin: 0,
    lastLogin: 0,
    charactersCount: 0,
    diariesCount: 0,
    chatTurns: 0,
  });

  const [pairs, setPairs] = useState<PairStat[]>([]);

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        setLoading(true);

        // Fetch User Profile
        const userDoc = await getDoc(doc(db, 'users', userId));
        let userName = '알 수 없음';
        if (userDoc.exists()) {
          const profile = userDoc.data() as UserProfile;
          setUserProfile(profile);
          userName = profile.name || userName;
        }

        // Fetch Characters
        const charQ = query(collection(db, 'characters'), where('userId', '==', userId));
        const charSnap = await getDocs(charQ);
        const characters = charSnap.docs.map(d => d.data() as Character);

        // Fetch Diaries
        const diaryQ = query(collection(db, 'diaries'), where('userId', '==', userId));
        const diarySnap = await getDocs(diaryQ);
        const diaries = diarySnap.docs.map(d => d.data() as Diary);

        // Fetch Chat Messages
        const chatQ = query(collection(db, 'chatMessages'), where('userId', '==', userId));
        const chatSnap = await getDocs(chatQ);
        const chats = chatSnap.docs.map(d => d.data() as ChatMessage);

        // Calculate Global Stats
        let firstLogin = Number.MAX_SAFE_INTEGER;
        let lastLogin = 0;
        let chatTurns = 0;

        const allDates: number[] = [];
        if (userDoc.exists() && userDoc.data().createdAt) allDates.push(userDoc.data().createdAt);
        characters.forEach(c => c.createdAt && allDates.push(c.createdAt));
        diaries.forEach(d => d.createdAt && allDates.push(d.createdAt));
        chats.forEach(c => {
          if (c.createdAt) allDates.push(c.createdAt);
          if (c.role === 'user') chatTurns++;
        });

        if (allDates.length > 0) {
          firstLogin = Math.min(...allDates);
          lastLogin = Math.max(...allDates);
        } else {
          firstLogin = 0;
        }

        setStats({
          firstLogin,
          lastLogin,
          charactersCount: characters.length,
          diariesCount: diaries.length,
          chatTurns
        });

        // Calculate Pair Stats
        const pairStats: PairStat[] = characters.map(char => {
          const charDiaries = diaries.filter(d => d.characterId === char.id).length;
          const charChats = chats.filter(c => c.characterId === char.id && c.role === 'user').length;

          return {
            characterId: char.id,
            characterName: char.name || '이름 없음',
            pairName: char.pairName || char.name || '이름 없음',
            userName: userName,
            diariesCount: charDiaries,
            chatTurns: charChats,
          };
        });

        setPairs(pairStats);
      } catch (err) {
        console.error(err);
        alert('데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [userId]);

  const formatDate = (ts: number) => {
    if (!ts || ts === Number.MAX_SAFE_INTEGER) return '-';
    return new Date(ts).toLocaleString();
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>사용자 상세 정보 ({userId})</h2>
      </div>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <StatCard title="첫 접속일" value={formatDate(stats.firstLogin)} />
        <StatCard title="마지막 접속일시" value={formatDate(stats.lastLogin)} />
        <StatCard title="생성한 페어 수" value={`${stats.charactersCount}개`} />
        <StatCard title="일기 작성 수" value={`${stats.diariesCount}개`} />
        <StatCard title="채팅 턴 수" value={`${stats.chatTurns}턴`} />
      </div>

      <div>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '15px' }}>유저가 생성한 페어 리스트</h3>
        <div style={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #ddd', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--gray-100)', borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '15px', fontWeight: 'bold' }}>페어명</th>
                <th style={{ padding: '15px', fontWeight: 'bold' }}>캐릭터명</th>
                <th style={{ padding: '15px', fontWeight: 'bold' }}>유저명</th>
                <th style={{ padding: '15px', fontWeight: 'bold' }}>일기 작성 수</th>
                <th style={{ padding: '15px', fontWeight: 'bold' }}>채팅 턴 수</th>
                <th style={{ padding: '15px', fontWeight: 'bold', textAlign: 'center' }}>상세 보기</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={p.characterId} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '15px', fontWeight: 'bold', color: 'var(--gray-800)' }}>{p.pairName}</td>
                  <td style={{ padding: '15px', color: 'var(--gray-600)' }}>{p.characterName}</td>
                  <td style={{ padding: '15px', color: 'var(--gray-600)' }}>{p.userName}</td>
                  <td style={{ padding: '15px', fontWeight: 'bold', color: 'var(--point-color)' }}>{p.diariesCount}개</td>
                  <td style={{ padding: '15px', fontWeight: 'bold', color: 'var(--point-color)' }}>{p.chatTurns}턴</td>
                  <td style={{ padding: '15px', textAlign: 'center' }}>
                    <Link href={`/admin/users/${userId}/pair/${p.characterId}`}>
                      <button style={{ backgroundColor: 'var(--point-color)', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' }}>
                        상세 보기
                      </button>
                    </Link>
                  </td>
                </tr>
              ))}
              {pairs.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: 'var(--gray-500)' }}>
                    생성한 페어가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div style={{ flex: 1, minWidth: '200px', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #ddd', padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <span style={{ color: 'var(--gray-500)', fontSize: '0.9rem', fontWeight: 'bold' }}>{title}</span>
      <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--point-color)' }}>{value}</span>
    </div>
  );
}
