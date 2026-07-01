"use client";

import { useEffect, useState } from 'react';
import { collection, getDocs, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, Search, Trash2 } from 'lucide-react';

interface UserStat {
  userId: string;
  charactersCount: number;
  diariesCount: number;
  lastActivity: number;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const charsSnap = await getDocs(collection(db, 'characters'));
        const diariesSnap = await getDocs(collection(db, 'diaries'));
        
        const userMap = new Map<string, UserStat>();

        const initUser = (userId: string) => {
          if (!userMap.has(userId)) {
            userMap.set(userId, { userId, charactersCount: 0, diariesCount: 0, lastActivity: 0 });
          }
          return userMap.get(userId)!;
        };

        charsSnap.forEach(d => {
          const data = d.data();
          if (data.userId) {
            const u = initUser(data.userId);
            u.charactersCount += 1;
            if (data.createdAt && data.createdAt > u.lastActivity) u.lastActivity = data.createdAt;
          }
        });

        diariesSnap.forEach(d => {
          const data = d.data();
          if (data.userId) {
            const u = initUser(data.userId);
            u.diariesCount += 1;
            if (data.createdAt && data.createdAt > u.lastActivity) u.lastActivity = data.createdAt;
          }
        });

        const sortedUsers = Array.from(userMap.values()).sort((a, b) => b.lastActivity - a.lastActivity);
        setUsers(sortedUsers);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const handleDeleteUser = async (userId: string) => {
    if (!confirm(`정말 ${userId} 의 모든 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며 관련된 캐릭터, 일기, 채팅이 모두 삭제됩니다.`)) return;
    
    try {
      setLoading(true);
      await deleteDoc(doc(db, 'users', userId));
      await deleteDoc(doc(db, 'characters', userId));
      
      const charQ = query(collection(db, 'characters'), where('userId', '==', userId));
      const charSnap = await getDocs(charQ);
      for (const d of charSnap.docs) await deleteDoc(d.ref);

      const diaryQ1 = query(collection(db, 'diaries'), where('userId', '==', userId));
      const diarySnap1 = await getDocs(diaryQ1);
      for (const d of diarySnap1.docs) await deleteDoc(d.ref);

      const diaryQ2 = query(collection(db, 'diaries'), where('characterId', '==', userId));
      const diarySnap2 = await getDocs(diaryQ2);
      for (const d of diarySnap2.docs) await deleteDoc(d.ref);

      const chatQ1 = query(collection(db, 'chatMessages'), where('userId', '==', userId));
      const chatSnap1 = await getDocs(chatQ1);
      for (const d of chatSnap1.docs) await deleteDoc(d.ref);

      const chatQ2 = query(collection(db, 'chatMessages'), where('characterId', '==', userId));
      const chatSnap2 = await getDocs(chatQ2);
      for (const d of chatSnap2.docs) await deleteDoc(d.ref);

      alert('삭제 완료되었습니다.');
      setUsers(prev => prev.filter(u => u.userId !== userId));
    } catch (error: any) {
      console.error(error);
      alert('삭제 중 오류 발생: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter(u => u.userId.toLowerCase().includes(searchQuery.toLowerCase()));

  if (loading && users.length === 0) return <div><Loader2 className="animate-spin" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>사용자 데이터 관리</h2>
        
        <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '8px', padding: '5px 15px', width: '300px' }}>
          <Search size={18} color="var(--gray-500)" />
          <input 
            type="text" 
            placeholder="UUID로 검색..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: 'none', outline: 'none', padding: '10px', width: '100%', fontSize: '0.95rem' }}
          />
        </div>
      </div>
      
      {loading && users.length > 0 && <div style={{ color: 'var(--point-color)', fontWeight: 'bold' }}><Loader2 className="animate-spin" size={20} style={{ display: 'inline', marginRight: '8px' }}/> 삭제 진행 중...</div>}

      <div style={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #ddd', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--gray-100)', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>UUID</th>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>생성한 페어 수</th>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>일기 작성 수</th>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>마지막 활동</th>
              <th style={{ padding: '15px', fontWeight: 'bold', textAlign: 'center' }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr key={u.userId} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '15px', color: 'var(--gray-600)', fontFamily: 'monospace' }}>{u.userId}</td>
                <td style={{ padding: '15px', fontWeight: 'bold', color: 'var(--point-color)' }}>{u.charactersCount}개</td>
                <td style={{ padding: '15px', fontWeight: 'bold', color: 'var(--point-color)' }}>{u.diariesCount}개</td>
                <td style={{ padding: '15px', color: 'var(--gray-500)', fontSize: '0.9rem' }}>
                  {u.lastActivity > 0 ? new Date(u.lastActivity).toLocaleString() : '-'}
                </td>
                <td style={{ padding: '15px', textAlign: 'center' }}>
                  <button 
                    onClick={() => handleDeleteUser(u.userId)}
                    style={{ backgroundColor: '#FFF0F0', color: 'red', border: '1px solid #FFCDCD', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem', fontWeight: 'bold' }}
                  >
                    <Trash2 size={16} /> 전체 삭제
                  </button>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: 'var(--gray-500)' }}>
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
