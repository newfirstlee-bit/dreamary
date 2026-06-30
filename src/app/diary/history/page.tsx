"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getUserId } from '@/lib/auth';
import { getCharactersByUser, getDiariesByUserAndChar, Character, Diary } from '@/lib/db';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function DiaryHistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharId, setActiveCharId] = useState<string>('');
  const [diaries, setDiaries] = useState<Diary[]>([]);

  useEffect(() => {
    const init = async () => {
      try {
        const userId = getUserId();
        const chars = await getCharactersByUser(userId);

        if (chars.length === 0) {
          router.replace('/onboarding');
          return;
        }

        setCharacters(chars);
        const queryCharId = searchParams.get('charId');
        const charId = (queryCharId && chars.some(c => c.id === queryCharId)) ? queryCharId : chars[0].id;
        setActiveCharId(charId);

        await fetchDiaries(userId, charId);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router]);

  const fetchDiaries = async (userId: string, charId: string) => {
    const data = await getDiariesByUserAndChar(userId, charId);
    // Sort newest first
    data.sort((a, b) => b.createdAt - a.createdAt);
    setDiaries(data);
  };

  const handleCharSelect = async (charId: string) => {
    setActiveCharId(charId);
    setLoading(true);
    await fetchDiaries(getUserId(), charId);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="app-container diary-bg" style={{ paddingBottom: '65px' }}>
      <header className="header" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <button onClick={() => router.push('/diary')} style={{ position: 'absolute', left: '20px', background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
        <span>일기 모아보기</span>
      </header>

      {/* Character Selector */}
      {characters.length > 1 && (
        <div style={{ display: 'flex', gap: '10px', padding: '15px 20px', backgroundColor: 'var(--point-color)', color: 'white', overflowX: 'auto' }}>
          {characters.map(char => (
            <button 
              key={char.id}
              onClick={() => handleCharSelect(char.id)}
              style={{
                padding: '6px 12px',
                borderRadius: '20px',
                backgroundColor: activeCharId === char.id ? 'white' : 'transparent',
                color: activeCharId === char.id ? 'var(--point-color)' : 'white',
                border: activeCharId === char.id ? 'none' : '1px solid rgba(255,255,255,0.5)',
                fontWeight: 'bold',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {char.name}
            </button>
          ))}
        </div>
      )}

      <main className="content" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {diaries.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: '50px', color: 'var(--text-muted)' }}>
            <p>아직 작성된 일기가 없습니다.</p>
          </div>
        ) : (
          diaries.map(diary => (
            <Link key={diary.id} href={`/diary/history/${diary.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ 
                backgroundColor: 'var(--white)', 
                padding: '20px', 
                borderRadius: '15px', 
                border: '1px solid var(--border-color)', 
                boxShadow: '0 4px 10px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--point-color)', fontSize: '0.8rem', fontWeight: 'bold' }}>
                    {Number(diary.topicId.split('-')[1] || 0) + 1}번째 질문
                  </span>
                  <span style={{ color: 'var(--gray-500)', fontSize: '0.8rem', fontWeight: 500 }}>
                    {diary.dateString.replace(/-/g, '.')}
                  </span>
                </div>
                <h3 style={{ fontSize: '1.05rem', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {diary.topicContent}
                </h3>
              </div>
            </Link>
          ))
        )}
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}
