"use client";

import { useEffect, useState } from 'react';
import { Loader2, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface UserStat {
  userId: string;
  accountId: string;
  charactersCount: number;
  diariesCount: number;
  lastActivity: number;
  createdAt: number;
}

export default function AdminUsers() {
  const router = useRouter();
  const [users, setUsers] = useState<UserStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchUsers = async (cursor?: string | null) => {
    try {
      cursor ? setLoadingMore(true) : setLoading(true);
      const params = new URLSearchParams({ pageSize: '20' });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/admin/users?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Failed to load users');
      setUsers(prev => cursor ? [...prev, ...data.users] : data.users);
      setNextCursor(data.nextCursor || null);
    } catch (err) {
      console.error(err);
      alert('사용자 목록을 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDeleteUser = async (userId: string) => {
    if (!confirm(`정말 ${userId} 의 모든 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며 관련된 캐릭터, 일기, 채팅이 모두 삭제됩니다.`)) return;
    
    try {
      alert('관리자 직접 삭제는 한도 보호를 위해 비활성화했습니다. 회원 탈퇴 API 또는 Firebase 콘솔에서 확인 후 삭제해주세요.');
    } catch (error: any) {
      console.error(error);
      alert('삭제 중 오류 발생: ' + error.message);
    }
  };

  const filteredUsers = users.filter(u => {
    const needle = searchQuery.toLowerCase();
    return u.userId.toLowerCase().includes(needle) || (u.accountId || '').toLowerCase().includes(needle);
  });

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
              <th style={{ padding: '15px', fontWeight: 'bold' }}>아이디 / UID</th>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>생성한 페어 수</th>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>일기 작성 수</th>
              <th style={{ padding: '15px', fontWeight: 'bold' }}>마지막 활동</th>
              <th style={{ padding: '15px', fontWeight: 'bold', textAlign: 'center' }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr 
                key={u.userId} 
                onClick={() => router.push(`/admin/users/${u.userId}`)}
                style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                className="hover-row"
              >
                <td style={{ padding: '15px', color: 'var(--gray-800)', fontFamily: 'monospace' }}>
                  <div style={{ fontWeight: 'bold', color: 'var(--gray-800)' }}>{u.accountId || '-'}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>{u.userId}</div>
                </td>
                <td style={{ padding: '15px', fontWeight: 'bold', color: 'var(--gray-800)' }}>{u.charactersCount}개</td>
                <td style={{ padding: '15px', fontWeight: 'bold', color: 'var(--gray-800)' }}>{u.diariesCount}개</td>
                <td style={{ padding: '15px', color: 'var(--gray-500)', fontSize: '0.9rem' }}>
                  {u.lastActivity > 0 ? new Date(u.lastActivity).toLocaleString() : '-'}
                </td>
                <td style={{ padding: '15px', textAlign: 'center' }}>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteUser(u.userId); }}
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
      {nextCursor && (
        <button
          onClick={() => fetchUsers(nextCursor)}
          disabled={loadingMore}
          style={{
            alignSelf: 'center',
            padding: '12px 24px',
            borderRadius: '999px',
            border: '1px solid var(--border-color)',
            backgroundColor: 'white',
            color: 'var(--gray-700)',
            fontWeight: 'bold',
            cursor: loadingMore ? 'default' : 'pointer',
          }}
        >
          {loadingMore ? '불러오는 중...' : '20명 더보기'}
        </button>
      )}
    </div>
  );
}
