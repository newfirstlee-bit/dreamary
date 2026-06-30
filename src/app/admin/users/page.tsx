"use client";

import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, User } from 'lucide-react';

interface UserStat {
  userId: string;
  charactersCount: number;
  diariesCount: number;
  lastActivity: number;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserStat[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div><Loader2 className="animate-spin" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>사용자 로그 조회</h2>
      
      <div style={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #ddd', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--gray-100)', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>UUID</th>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>생성한 페어 수</th>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>일기 작성 수</th>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>마지막 활동</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '15px', color: 'var(--gray-600)', fontFamily: 'monospace' }}>{u.userId}</td>
                <td style={{ padding: '15px', fontWeight: 'bold', color: 'var(--point-color)' }}>{u.charactersCount}개</td>
                <td style={{ padding: '15px', fontWeight: 'bold', color: 'var(--point-color)' }}>{u.diariesCount}개</td>
                <td style={{ padding: '15px', color: 'var(--gray-500)', fontSize: '0.9rem' }}>
                  {u.lastActivity > 0 ? new Date(u.lastActivity).toLocaleString() : '-'}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '30px', textAlign: 'center', color: 'var(--gray-500)' }}>
                  데이터가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
