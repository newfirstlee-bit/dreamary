"use client";

import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2 } from 'lucide-react';

export default function AdminDashboard() {
  const [stats, setStats] = useState({ users: 0, characters: 0, diaries: 0, chats: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const charsSnap = await getDocs(collection(db, 'characters'));
        const diariesSnap = await getDocs(collection(db, 'diaries'));
        const chatsSnap = await getDocs(collection(db, 'chatMessages'));
        
        const uniqueUsers = new Set<string>();
        charsSnap.forEach(d => {
          const data = d.data();
          if (data.userId) uniqueUsers.add(data.userId);
        });

        setStats({
          users: uniqueUsers.size,
          characters: charsSnap.size,
          diaries: diariesSnap.size,
          chats: chatsSnap.size,
        });
      } catch (err) {
        console.error("Failed to load stats:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) return <div><Loader2 className="animate-spin" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>대시보드</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
        <div style={{ backgroundColor: 'white', padding: '25px', borderRadius: '12px', border: '1px solid #ddd', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ color: 'var(--gray-600)', fontWeight: 'bold' }}>총 유저 수 (UUID 기준)</span>
          <span style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--point-color)' }}>{stats.users}명</span>
        </div>
        <div style={{ backgroundColor: 'white', padding: '25px', borderRadius: '12px', border: '1px solid #ddd', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ color: 'var(--gray-600)', fontWeight: 'bold' }}>생성된 페어 수</span>
          <span style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--point-color)' }}>{stats.characters}개</span>
        </div>
        <div style={{ backgroundColor: 'white', padding: '25px', borderRadius: '12px', border: '1px solid #ddd', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ color: 'var(--gray-600)', fontWeight: 'bold' }}>작성된 교환일기 수</span>
          <span style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--point-color)' }}>{stats.diaries}개</span>
        </div>
        <div style={{ backgroundColor: 'white', padding: '25px', borderRadius: '12px', border: '1px solid #ddd', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ color: 'var(--gray-600)', fontWeight: 'bold' }}>누적 채팅 메시지 수</span>
          <span style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--point-color)' }}>{stats.chats}개</span>
        </div>
      </div>
    </div>
  );
}
