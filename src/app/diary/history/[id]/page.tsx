"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';
import { useLocale } from '@/lib/i18n';
import { getUserId } from '@/lib/auth';
import { getDiaryById, getCharacterById, getUserProfile, getDiariesByUserAndChar, getTopics, Diary, Character, UserProfile, Topic } from '@/lib/db';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

export default function DiaryHistoryDetailPage() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const params = useParams();
  const diaryId = params.id as string;
  
  const [loading, setLoading] = useState(true);
  const [diary, setDiary] = useState<Diary | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  
  const [prevDiaryId, setPrevDiaryId] = useState<string | null>(null);
  const [nextDiaryId, setNextDiaryId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const userId = getUserId();
        const d = await getDiaryById(diaryId);

        if (!d) {
          router.replace('/diary/history');
          return;
        }

        const [profile, char, allDiaries, topics] = await Promise.all([
          getUserProfile(d.characterId),
          getCharacterById(d.characterId),
          getDiariesByUserAndChar(userId, d.characterId),
          getTopics()
        ]);

        setDiary(d);
        setUserProfile(profile);
        setCharacter(char);
        setTopic(topics.find(t => t.id === d.topicId) || null);

        // allDiaries are sorted newest first.
        // allDiaries are sorted newest first. 
        // So chronological next is the one before it in array (index - 1)
        // chronological prev is the one after it in array (index + 1)
        const currentIndex = allDiaries.findIndex(item => item.id === d.id);
        
        if (currentIndex > 0) {
          setNextDiaryId(allDiaries[currentIndex - 1].id);
        }
        if (currentIndex < allDiaries.length - 1) {
          setPrevDiaryId(allDiaries[currentIndex + 1].id);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [diaryId, router]);

  if (loading || !diary || !character) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="app-container diary-bg" style={{ paddingBottom: '80px' }}>
      <header className="header" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <button onClick={() => router.push('/diary/history')} style={{ position: 'absolute', left: '20px', background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
        <span>{diary.dateString.replace(/-/g, '.')} {t('common.diary')}</span>
      </header>

      <main className="content" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Topic Display */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', border: '1px solid var(--border-color)', marginBottom: '20px', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
          <p style={{ color: 'var(--point-color)', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px' }}>
            {topic ? `${topic.order}${t('common.nthQuestion')}` : t('common.question')}
          </p>
          <h3 style={{ fontSize: '1.2rem', lineHeight: '1.4' }}>
            {(locale === 'ja' && topic?.contentJa) ? topic.contentJa : diary.topicContent}
          </h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* User Entry */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 1 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginRight: '5px' }}>{userProfile?.name || (locale === 'ja' ? t('common.user') : '유저')}</span>
              <div className="post-it" style={{ width: '100%', maxWidth: '85%', lineHeight: '1.6', fontSize: '0.95rem' }}>
                {diary.userEntry}
              </div>
            </div>
            {userProfile?.image && (
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0, marginTop: '25px' }}>
                <Image src={userProfile.image} alt="user" fill style={{ objectFit: 'cover' }} />
              </div>
            )}
          </div>

          {/* Char Reply */}
          {diary.charReply && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', alignItems: 'flex-start' }}>
              {character.image && (
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0, marginTop: '25px' }}>
                  <Image src={character.image} alt="char" fill style={{ objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginLeft: '5px' }}>{character.name}</span>
                <div className="notebook-paper" style={{ width: '100%', maxWidth: '85%', lineHeight: '1.6', fontSize: '0.95rem' }}>
                  {diary.charReply}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Prev/Next Navigation */}
      <div style={{ 
        position: 'fixed', 
        bottom: '90px', 
        left: '50%', 
        transform: 'translateX(-50%)', 
        display: 'flex', 
        justifyContent: 'center',
        alignItems: 'center',
        gap: '30px',
        zIndex: 100
      }}>
        <button 
          onClick={() => prevDiaryId && router.push(`/diary/history/${prevDiaryId}`)}
          disabled={!prevDiaryId}
          style={{ 
            display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', 
            cursor: prevDiaryId ? 'pointer' : 'default', 
            color: prevDiaryId ? 'var(--gray-700)' : 'var(--gray-400)', 
            fontWeight: 'bold', fontSize: '1.05rem', padding: '10px' 
          }}
        >
          <ChevronLeft size={20} />
          <span>이전</span>
        </button>
        
        <button 
          onClick={() => nextDiaryId && router.push(`/diary/history/${nextDiaryId}`)}
          disabled={!nextDiaryId}
          style={{ 
            display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', 
            cursor: nextDiaryId ? 'pointer' : 'default', 
            color: nextDiaryId ? 'var(--gray-700)' : 'var(--gray-400)', 
            fontWeight: 'bold', fontSize: '1.05rem', padding: '10px' 
          }}
        >
          <span>다음</span>
          <ChevronRight size={20} />
        </button>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}
