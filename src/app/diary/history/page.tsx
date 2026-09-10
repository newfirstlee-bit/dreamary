"use client";

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUserId } from '@/hooks/useUserId';
import { getDiariesByUserAndCharPage, getTopics, getUserProfile, Character, Diary, Topic } from '@/lib/db';
import { useAppStore } from '@/store/useAppStore';
import { useAuth } from '@/components/AuthContext';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { Loader2, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useLocale } from '@/lib/i18n';
import { buildStaticEntityRoute } from '@/lib/navigation';
import { formatKoreanNameTemplate } from '@/lib/koreanJosa';

const DIARY_HISTORY_PAGE_SIZE = 10;

function DiaryHistoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useLocale();
  const [loading, setLoading] = useState(true);
  
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharId, setActiveCharId] = useState<string>('');
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [diaryCursor, setDiaryCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  const userId = useUserId();
  const { status } = useAuth();
  const loadCharacters = useAppStore(state => state.loadCharacters);

  const fetchDiaries = async (userId: string, charId: string, cursor?: QueryDocumentSnapshot<DocumentData> | null, isCurrent = () => true) => {
    const [page, profile] = await Promise.all([
      getDiariesByUserAndCharPage(userId, charId, DIARY_HISTORY_PAGE_SIZE, cursor),
      getUserProfile(charId)
    ]);
    if (!isCurrent()) return;
    setDiaries(prev => {
      const nextDiaries = cursor ? [...prev, ...page.diaries] : page.diaries;
      return nextDiaries.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    });
    setDiaryCursor(page.nextCursor);
    setUserProfile(profile);
    setLoadError(false);
  };

  useEffect(() => {
    if (!userId || status === 'checking') return;
    let cancelled = false;
    setLoading(true);

    const init = async () => {
      try {
        const [chars, loadedTopics] = await Promise.all([
          loadCharacters(userId, status === 'authenticated'),
          getTopics(),
        ]);
        if (cancelled) return;

        if (chars.length === 0) {
          router.replace('/onboarding');
          return;
        }

        setTopics(loadedTopics);

        setCharacters(chars);
        const queryCharId = searchParams.get('charId');
        const charId = (queryCharId && chars.some(c => c.id === queryCharId)) ? queryCharId : chars[0].id;
        setActiveCharId(charId);

        setDiaries([]);
        setDiaryCursor(null);
        await fetchDiaries(userId, charId, null, () => !cancelled);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, [router, userId, status, loadCharacters]);

  const handleCharSelect = async (charId: string) => {
    setActiveCharId(charId);
    setLoading(true);
    setLoadError(false);
    setDiaries([]);
    setDiaryCursor(null);
    try {
      await fetchDiaries(userId!, charId);
    } catch (error) {
      console.error(error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!userId || !activeCharId) return;
    setLoading(true);
    setLoadError(false);
    setDiaries([]);
    setDiaryCursor(null);
    try {
      await fetchDiaries(userId, activeCharId);
    } catch (error) {
      console.error(error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!userId || !activeCharId || !diaryCursor) return;
    try {
      setLoadingMore(true);
      await fetchDiaries(userId, activeCharId, diaryCursor);
    } catch (error) {
      console.error(error);
      alert(locale === 'ja' ? '日記を追加で読み込めませんでした。' : '일기를 추가로 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
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
        <span>{t('diary.viewAll')}</span>
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

      <main className="content" style={{ display: 'flex', flexDirection: 'column', gap: '15px', paddingBottom: '100px' }}>
        {loadError ? (
          <div style={{ textAlign: 'center', marginTop: '50px', color: 'var(--text-muted)' }}>
            <p>{locale === 'ja' ? '日記を読み込めませんでした。' : '일기를 불러오지 못했습니다.'}</p>
            <button
              onClick={handleRetry}
              style={{
                marginTop: '16px',
                padding: '12px 22px',
                borderRadius: '999px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'white',
                color: 'var(--gray-700)',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              {locale === 'ja' ? 'もう一度試す' : '다시 시도'}
            </button>
          </div>
        ) : diaries.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: '50px', color: 'var(--text-muted)' }}>
            <p>{t('diary.noDiaries')}</p>
          </div>
        ) : (
          diaries.map(diary => (
            <Link key={diary.id} href={buildStaticEntityRoute('/diary/history', diary.id)} style={{ textDecoration: 'none', color: 'inherit' }}>
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
                    {(topics.find(t => t.id === diary.topicId)?.order || 1)}{t('common.nthQuestion')}
                  </span>
                  <span style={{ color: 'var(--gray-500)', fontSize: '0.8rem', fontWeight: 500 }}>
                    {(diary.dateString || '').replace(/-/g, '.')}
                  </span>
                </div>
                <h3 style={{ fontSize: '1.05rem', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {(() => {
                    const matchedTopic = topics.find(t => t.id === diary.topicId);
                    const rawTopic = (locale === 'ja' && matchedTopic?.contentJa) ? matchedTopic.contentJa : (diary.topicContent || '');
                    const activeChar = characters.find(c => c.id === activeCharId);
                    return formatKoreanNameTemplate(rawTopic, {
                      userName: userProfile?.name || (locale === 'ja' ? t('common.user') : '유저'),
                      characterName: activeChar?.name || '',
                    });
                  })()}
                </h3>
              </div>
            </Link>
          ))
        )}
        {diaryCursor && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            style={{
              alignSelf: 'center',
              marginTop: '8px',
              padding: '12px 22px',
              borderRadius: '999px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'white',
              color: 'var(--gray-700)',
              fontWeight: 'bold',
              cursor: loadingMore ? 'default' : 'pointer',
            }}
          >
            {loadingMore ? (locale === 'ja' ? '読み込み中...' : '불러오는 중...') : (locale === 'ja' ? 'さらに10件見る' : '10개 더보기')}
          </button>
        )}
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}

export default function DiaryHistoryPage() {
  return (
    <Suspense fallback={<div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}><Loader2 className="animate-spin" size={32} color="var(--point-color)" /></div>}>
      <DiaryHistoryContent />
    </Suspense>
  );
}
