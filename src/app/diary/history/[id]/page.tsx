"use client";

import { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useLocale } from '@/lib/i18n';
import { useUserId } from '@/hooks/useUserId';
import { getDiaryById, getCharacterById, getUserProfile, getDiariesByUserAndChar, getTopics, Diary, Character, UserProfile, Topic } from '@/lib/db';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { buildStaticEntityRoute, resolveStaticEntityId } from '@/lib/navigation';

function DiaryHistoryDetailContent() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  // Static app builds reuse /diary/history/1 and carry the real diary ID in
  // the query string. Subscribe to that query so list/detail and prev/next
  // navigation never fall back to the build-only ID.
  const diaryId = searchParams.get('entityId') || resolveStaticEntityId(params.id as string);
  
  const [loading, setLoading] = useState(true);
  const [diary, setDiary] = useState<Diary | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  
  const [prevDiaryId, setPrevDiaryId] = useState<string | null>(null);
  const [nextDiaryId, setNextDiaryId] = useState<string | null>(null);
  const userId = useUserId();

  useEffect(() => {
    if (!userId) return;

    const init = async () => {
      try {
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
  }, [diaryId, router, userId]);

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

      <main className="content" style={{ display: 'flex', flexDirection: 'column', paddingBottom: '100px' }}>
        {/* Topic Display */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', border: '1px solid var(--border-color)', marginBottom: '20px', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
          <p style={{ color: 'var(--point-color)', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px' }}>
            {topic ? `${topic.order}${t('common.nthQuestion')}` : t('common.question')}
          </p>
          <h3 style={{ fontSize: '1.2rem', lineHeight: '1.4' }}>
            {((locale === 'ja' && topic?.contentJa) ? topic.contentJa : (diary?.topicContent || ''))
              .replace(/{유저}/g, userProfile?.name || (locale === 'ja' ? t('common.user') : '유저'))
              .replace(/{캐릭터}/g, character?.name || '')
              .replace(/{ユーザー}/g, userProfile?.name || (locale === 'ja' ? t('common.user') : '유저'))
              .replace(/{キャラクター}/g, character?.name || '')}
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
            {/* Prev/Next Navigation moved inside main to flow naturally and not overlap */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center',
              alignItems: 'center',
              gap: '30px',
              marginTop: '60px' // Margin above buttons (below char reply)
            }}>
              <button 
                onClick={() => prevDiaryId && router.push(buildStaticEntityRoute('/diary/history', prevDiaryId))}
                disabled={!prevDiaryId}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', 
                  cursor: prevDiaryId ? 'pointer' : 'default', 
                  color: prevDiaryId ? 'var(--gray-700)' : 'var(--gray-400)', 
                  fontWeight: 'bold', fontSize: '1.05rem', padding: '10px' 
                }}
              >
                <ChevronLeft size={20} />
                <span>{locale === 'ja' ? '前へ' : '이전'}</span>
              </button>
              
              <button 
                onClick={() => nextDiaryId && router.push(buildStaticEntityRoute('/diary/history', nextDiaryId))}
                disabled={!nextDiaryId}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', 
                  cursor: nextDiaryId ? 'pointer' : 'default', 
                  color: nextDiaryId ? 'var(--gray-700)' : 'var(--gray-400)', 
                  fontWeight: 'bold', fontSize: '1.05rem', padding: '10px' 
                }}
              >
                <span>{locale === 'ja' ? '次へ' : '다음'}</span>
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}

export default function DiaryHistoryDetailPage() {
  return (
    <Suspense fallback={(
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" />
      </div>
    )}>
      <DiaryHistoryDetailContent />
    </Suspense>
  );
}
