"use client";
import { showAd } from "@/lib/ads";
import { apiPostJson } from '@/lib/api';

import { useCallback, useEffect, useState, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUserId } from '@/hooks/useUserId';
import { getUserProfile, getTopics, getTodayDiaryByUserAndChar, getDiaryCountByUserAndChar, subscribeTodayDiary, saveDiary, Character, UserProfile, Topic, Diary, unlockDiaryAd } from '@/lib/db';
import { Loader2, Send, ChevronDown, User, Lock } from 'lucide-react';
import Link from 'next/link';
import AdModal from '@/components/AdModal';
import ErrorModal from '@/components/ErrorModal';
import ReportModal, { ReportSubmitPayload } from '@/components/ReportModal';
import { trackDiaryAndCheckAd } from '@/lib/adTracker';
import { trackEvent } from '@/lib/mixpanel';
import { saveDraft, loadDraft, clearDraft } from '@/lib/draftStorage';
import { useRef } from 'react';
import { useLocale } from '@/lib/i18n';
import { clearUserCache, readUserCache, writeUserCache } from '@/lib/appCache';
import { sortCharactersByRecent, touchRecentCharacter } from '@/lib/characterOrder';
import { getCharactersWithGuestRecovery } from '@/lib/ownership';
import { useAuth } from '@/components/AuthContext';
import { useAppStore } from '@/store/useAppStore';
import { buildStaticEntityRoute } from '@/lib/navigation';
import { logAdDiagnostic } from '@/lib/adDiagnostics';

interface DiaryCache {
  dateString: string;
  characters: Character[];
  activeCharId: string;
  userProfiles: Record<string, UserProfile | null>;
  allTopics: Topic[];
  todayTopic: Topic | null;
  todayDiary: Diary | null;
}

const withTimeout = <T,>(promise: Promise<T>, timeoutMs = 10000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Diary data request timed out')), timeoutMs)
    ),
  ]);

function DiaryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = useUserId();
  const { status } = useAuth();
  const { t, locale } = useLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const draftLoaded = useRef(false);
  
  const [adModalOpen, setAdModalOpen] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [adFailureMessage, setAdFailureMessage] = useState('');
  const [modalResolver, setModalResolver] = useState<((didOpen: boolean) => void) | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const diaryInputRef = useRef<HTMLTextAreaElement>(null);

  const { loadCharacters, loadTopics } = useAppStore();

  const confirmAd = () => {
    showAd((result) => {
      setAdModalOpen(false);
      if (modalResolver) {
        if (!result.didOpen && result.message) {
          setAdFailureMessage(result.message);
        }
        modalResolver(result.didOpen);
      }
    });
    setModalResolver(null);
  };

  const closeAdModal = () => {
    setAdModalOpen(false);
    if (modalResolver) {
      modalResolver(false);
      setModalResolver(null);
    }
  };

  const submitDiaryReport = async ({ reasons, otherText }: ReportSubmitPayload) => {
    if (!todayDiary || !activeChar || !userId || !todayDiary.charReply) return;
    await apiPostJson('/api/reports/create', {
      userId,
      characterId: activeChar.id,
      characterName: activeChar.name,
      source: 'diary',
      targetId: todayDiary.id,
      content: todayDiary.charReply,
      reasons,
      otherText,
      locale,
    });
    alert(t('report.success'));
  };
  
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharId, setActiveCharId] = useState<string>('');
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile | null>>({});
  
  const [todayTopic, setTodayTopic] = useState<Topic | null>(null);
  const [allTopics, setAllTopics] = useState<Topic[]>([]);
  const [todayDiary, setTodayDiary] = useState<Diary | null>(null);
  const [userEntry, setUserEntry] = useState('');

  const resizeDiaryInput = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(120, textarea.scrollHeight)}px`;
    textarea.style.overflowY = 'hidden';
  }, []);

  const refreshActiveDiary = async () => {
    if (!userId || !activeCharId) return;
    const now = new Date();
    const dateString = now.toISOString().split('T')[0];
    const todayD = await getTodayDiaryByUserAndChar(userId, activeCharId, dateString);
    setTodayDiary(todayD);
    if (todayD) {
      const matchedTopic = allTopics.find(t => t.id === todayD.topicId);
      setTodayTopic(matchedTopic || allTopics[0] || null);
    }
  };

  useEffect(() => {
    if (!activeCharId || !userId) return;
    const now = new Date();
    const dateString = now.toISOString().split('T')[0];
    
    const unsubscribe = subscribeTodayDiary(userId, activeCharId, dateString, setTodayDiary);
    
    return () => unsubscribe();
  }, [activeCharId, userId]);

  useEffect(() => {
    if (!userId) return;
    const dateString = new Date().toISOString().split('T')[0];
    const cachedDiary = readUserCache<DiaryCache>(userId, 'diary');
    const hasUsableCache = cachedDiary?.dateString === dateString;

    if (cachedDiary && hasUsableCache) {
      setCharacters(cachedDiary.characters);
      setActiveCharId(cachedDiary.activeCharId);
      setUserProfiles(cachedDiary.userProfiles);
      setAllTopics(cachedDiary.allTopics);
      setTodayTopic(cachedDiary.todayTopic);
      setTodayDiary(cachedDiary.todayDiary);
      setLoading(false);
    }

    const init = async () => {
      try {
        const [loadedChars, topics] = await withTimeout(Promise.all([
          loadCharacters(userId, status === 'authenticated'),
          loadTopics()
        ]));
        const chars = sortCharactersByRecent(loadedChars, userId);

        if (chars.length === 0) {
          const dummyChar: Character = {
            id: 'dummy',
            userId: userId,
            name: t('dummy.charName') || '드림캐',
            feeling: '',
            title: '',
            exampleChat: '',
            negative: '',
            createdAt: Date.now(),
            dDayStartDate: Date.now()
          };
          setCharacters([dummyChar]);
          setActiveCharId('dummy');
          
          if (topics.length > 0) {
            setAllTopics(topics);
            setTodayTopic(topics[0]);
          } else {
            const dummyTopic = { id: 'dummy', order: 1, content: t('dummy.firstTopic') || '오늘 하루는 어땠어?' } as Topic;
            setAllTopics([dummyTopic]);
            setTodayTopic(dummyTopic);
          }
          writeUserCache<DiaryCache>(userId, 'diary', {
            dateString,
            characters: [dummyChar],
            activeCharId: 'dummy',
            userProfiles: {},
            allTopics: topics.length > 0 ? topics : [{ id: 'dummy', order: 1, content: t('dummy.firstTopic') || '오늘 하루는 어땠어?' } as Topic],
            todayTopic: topics.length > 0 ? topics[0] : ({ id: 'dummy', order: 1, content: t('dummy.firstTopic') || '오늘 하루는 어땠어?' } as Topic),
            todayDiary: null
          });
          setLoading(false);
          return;
        }

        setAllTopics(topics);
        if (topics.length > 0) setTodayTopic(topics[0]);

        let initialCharId = chars[0].id;
        let allAnswered = true;

        const todayDiaries = await withTimeout(Promise.all(
          chars.map(c => getTodayDiaryByUserAndChar(userId, c.id, dateString))
        ));
        for (let i = 0; i < chars.length; i++) {
          const char = chars[i];
          if (!todayDiaries[i]) {
            initialCharId = char.id;
            allAnswered = false;
            break;
          }
        }

        const queryCharId = searchParams.get('charId');
        if (queryCharId && chars.some(c => c.id === queryCharId)) {
          initialCharId = queryCharId;
          allAnswered = false; // Prevent redirect if explicit query param is passed
        }

        if (allAnswered) {
          router.replace('/diary/history');
          return;
        }

        setActiveCharId(initialCharId);
        setCharacters(chars);
        setLoading(false);

        let resolvedTopic: Topic | null = topics[0] || null;
        let resolvedDiary: Diary | null = null;
        const profileMap: Record<string, UserProfile | null> = {};

        // Pick topic based on day of year
        if (topics.length > 0) {
          setAllTopics(topics);
          const selectedCharIndex = chars.findIndex(c => c.id === initialCharId);
          const todayD = selectedCharIndex >= 0 ? todayDiaries[selectedCharIndex] : null;
          
          if (todayD) {
            setTodayDiary(todayD);
            const matchedTopic = topics.find(t => t.id === todayD.topicId);
            resolvedDiary = todayD;
            resolvedTopic = matchedTopic || topics[0];
            setTodayTopic(resolvedTopic);
          } else {
            const diaryCount = await withTimeout(getDiaryCountByUserAndChar(userId, initialCharId));
            const nextIdx = diaryCount % topics.length;
            resolvedTopic = topics[nextIdx];
            setTodayTopic(resolvedTopic);
            
            const draft = loadDraft(initialCharId, 'diary');
            if (draft) {
              setUserEntry(draft);
              draftLoaded.current = true;
            }
          }
        }

        profileMap[initialCharId] = await withTimeout(getUserProfile(initialCharId));
        setUserProfiles(profileMap);

        writeUserCache<DiaryCache>(userId, 'diary', {
          dateString,
          characters: chars,
          activeCharId: initialCharId,
          userProfiles: profileMap,
          allTopics: topics,
          todayTopic: resolvedTopic,
          todayDiary: resolvedDiary
        });
        setLoading(false);
      } catch (err) {
        console.error("Failed to load diary data:", err);
        if (hasUsableCache) {
          setLoading(false);
          return;
        }
        // 첫 조회 실패가 앱 진입을 막지 않도록 비로그인 체험 화면을 표시합니다.
        const dummyChar: Character = {
          id: 'dummy',
          userId,
          name: t('dummy.charName') || '드림캐',
          feeling: '',
          title: '',
          exampleChat: '',
          negative: '',
          createdAt: Date.now(),
          dDayStartDate: Date.now()
        };
        const dummyTopic = {
          id: 'dummy',
          order: 1,
          content: t('dummy.firstTopic') || '오늘 하루는 어땠어?'
        } as Topic;
        setCharacters([dummyChar]);
        setActiveCharId('dummy');
        setAllTopics([dummyTopic]);
        setTodayTopic(dummyTopic);
        setLoading(false);
      }
    };
    init();
  }, [router, userId, status]);

  useEffect(() => {
    if (todayDiary && !todayDiary.isAdLocked && todayDiary.charReply) {
      // Check if we already tracked it for this diary to prevent spam
      const trackedKey = `tracked_diary_view_${todayDiary.id}`;
      if (!sessionStorage.getItem(trackedKey)) {
        trackEvent('Diary_Response_Viewed', {
          diary_id: todayDiary.id,
          character_id: activeCharId
        });
        sessionStorage.setItem(trackedKey, 'true');
      }
    }
  }, [todayDiary, activeCharId]);

  useEffect(() => {
    resizeDiaryInput(diaryInputRef.current);
  }, [userEntry, resizeDiaryInput]);

  useEffect(() => {
    if (!adFailureMessage) return;
    const timer = window.setTimeout(() => setAdFailureMessage(''), 3500);
    return () => window.clearTimeout(timer);
  }, [adFailureMessage]);

  const handleCharSelect = async (charId: string) => {
    if (!userId) return;
    setActiveCharId(charId);
    setUserEntry('');
    setTodayDiary(null);
    setLoading(true);

    try {

      const now = new Date();
      const dateString = now.toISOString().split('T')[0];
      const todayD = await getTodayDiaryByUserAndChar(userId, charId, dateString);
      if (todayD) {
        setTodayDiary(todayD);
        const matchedTopic = allTopics.find(t => t.id === todayD.topicId);
        setTodayTopic(matchedTopic || allTopics[0]);
      } else {
        const diaryCount = await getDiaryCountByUserAndChar(userId, charId);
        const nextIdx = allTopics.length > 0 ? diaryCount % allTopics.length : 0;
        setTodayTopic(allTopics[nextIdx] || allTopics[0]);
        
        const draft = loadDraft(charId, 'diary');
        if (draft) {
          setUserEntry(draft);
          draftLoaded.current = true;
        }
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!activeCharId || activeCharId === 'dummy') return;
    if (Object.prototype.hasOwnProperty.call(userProfiles, activeCharId)) return;

    let cancelled = false;
    getUserProfile(activeCharId)
      .then(profile => {
        if (cancelled) return;
        setUserProfiles(prev => ({ ...prev, [activeCharId]: profile }));
      })
      .catch(error => console.warn('Failed to load active profile:', error));

    return () => {
      cancelled = true;
    };
  }, [activeCharId, userProfiles]);

  const handleSend = async () => {
    if (!userEntry.trim() || !todayTopic || !activeCharId || !userId) return;

    setSaving(true);
    let attemptedAdTurn = false;
    let requestId = '';
    try {

      const char = characters.find(c => c.id === activeCharId);
      if (!char) {
        setSaving(false);
        return;
      }
      const activeProfile = userProfiles[activeCharId];
      const dateString = new Date().toISOString().split('T')[0];
      
      const isAdTurn = trackDiaryAndCheckAd();
      attemptedAdTurn = isAdTurn;
      
      let adWaitPromise = Promise.resolve(true);
      if (isAdTurn) {
        setAdModalOpen(true);
        adWaitPromise = new Promise<boolean>((resolve) => {
          setModalResolver(() => (didOpen: boolean) => resolve(didOpen));
        });
      }

      requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
      
      let success = false;
      let savedId = '';
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (typeof window !== 'undefined' && localStorage.getItem('dev_force_error') === 'true') {
            throw new Error('Forced error for testing');
          }

          if (isAdTurn && attempt === 1) {
            const adOpened = await adWaitPromise;
            if (!adOpened) {
              logAdDiagnostic('diary', 'ad_open_failed', { characterId: char.id, requestId });
              throw new Error('AD_OPEN_FAILED');
            }
            logAdDiagnostic('diary', 'ad_completed', { characterId: char.id, requestId });
          }

          const data = await apiPostJson<{ reply?: string; savedId?: string }>('/api/diary', {
            character: char,
            userProfile: activeProfile,
            topic: todayTopic.content,
            userEntry,
            userId,
            topicId: todayTopic.id,
            dateString,
            isAdTurn: false,
            requestId
          });

          if (data.reply || data.savedId) {
            success = true;
            savedId = data.savedId || '';
            break;
          }
        } catch (e) {
          if ((e as Error)?.message === 'AD_OPEN_FAILED') throw e;
          console.error(`Attempt ${attempt} failed:`, e);
        }

        if (!success && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (!success) {
        throw new Error('All 3 attempts failed');
      }

      trackEvent('Diary_Written', {
        topic_order: todayTopic.order,
        topic_id: todayTopic.id,
        character_id: char.id,
        content_length: userEntry.length
      });
      
      if (!localStorage.getItem('core_interaction_tracked')) {
        trackEvent('Core_interaction', { type: 'diary' });
        localStorage.setItem('core_interaction_tracked', 'true');
      }

      setUserEntry('');
      clearDraft(char!.id, 'diary');
      if (userId) clearUserCache(userId, ['home', 'diary']);
      // 오늘 일기 구독이 Firestore 업데이트를 감지하므로 별도 전체 재조회 불필요

    } catch (err) {
      console.error(err);
      closeAdModal();
      saveDraft(activeCharId, userEntry, 'diary');
      if ((err as Error)?.message !== 'AD_OPEN_FAILED') {
        if (attemptedAdTurn) {
          logAdDiagnostic('diary', 'app_server_request_failed', { characterId: activeCharId, requestId }, err);
        }
        setErrorModalOpen(true);
      }
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
      </div>
    );
  }

  const activeChar = characters.find(c => c.id === activeCharId);
  const userProfile = activeCharId ? userProfiles[activeCharId] : null;
  const hasPair = characters.some(character => character.id !== 'dummy');

  let formattedContent = (locale === 'ja' && todayTopic?.contentJa) ? todayTopic.contentJa : (todayTopic?.content || '');
  if (formattedContent && activeChar) {
    formattedContent = formattedContent
      .replace(/{유저}/g, userProfile?.name || (locale === 'ja' ? t('common.user') : '유저'))
      .replace(/{캐릭터}/g, activeChar.name);
  }

  const handleDummyClick = () => {
    trackEvent('locked_feature_tapped', { feature_name: 'diary_create_btn', screen: 'diary' });
    router.push('/onboarding?skip=true&entry_point=diary_dummy');
  };

  return (
    <div className="app-container tab-page diary-page diary-bg status-surface-check">
      <header className="header" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, position: 'relative', display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
        <span>{t('diary.header')}</span>
      </header>

      {/* Character Selector (Horizontal Scroll) */}
      {hasPair && (
        <div className="diary-character-selector" style={{ display: 'flex', gap: '15px', overflowX: 'auto', padding: '15px 20px', scrollbarWidth: 'none', backgroundColor: '#F5F0FF', flexShrink: 0 }}>
          {characters.map(char => {
            const isSelected = char.id === activeCharId;
            return (
              <div 
                key={char.id} 
                onClick={() => {
                  handleCharSelect(char.id);
            
                  touchRecentCharacter(userId, char.id);
                }}
                className="diary-character-card"
                style={{ 
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flexShrink: 0, cursor: 'pointer',
                  backgroundColor: 'white',
                  padding: '12px',
                  borderRadius: '20px',
                  border: isSelected ? '3px solid var(--point-color)' : '3px solid transparent',
                  boxShadow: '0 4px 10px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s'
                }}
              >
                <div className="diary-character-avatar" style={{
                  width: '60px', height: '60px', borderRadius: '15px', overflow: 'hidden', backgroundColor: 'var(--gray-200)', position: 'relative'
                }}>
                  {char.image ? (
                    <Image src={char.image} alt={char.name} fill style={{ objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      <User size={24} color="var(--gray-500)" />
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--gray-800)' }}>
                  {char.name.length > 5 ? char.name.slice(0,5)+'...' : char.name}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <main className="content diary-content" style={{ display: 'flex', flexDirection: 'column', paddingBottom: '100px' }}>
        
        {/* Topic Display */}
        {todayTopic && (
          <div className="diary-topic-card" style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', border: '1px solid var(--border-color)', marginBottom: '20px', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
            <div style={{ flex: 1, paddingRight: '15px' }}>
              <p style={{ color: 'var(--point-color)', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px' }}>
                {todayTopic.order}{t('common.nthQuestion')}
              </p>
              <h3 style={{ fontSize: '1.2rem', lineHeight: '1.4' }}>
                {formattedContent}
              </h3>
            </div>
          </div>
        )}

        {/* Diary Status */}
        {todayDiary ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* User Entry */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 1 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginRight: '5px' }}>{userProfile?.name || t('common.user')}</span>
                <div className="post-it" style={{ width: '100%', maxWidth: '85%', lineHeight: '1.6', fontSize: '0.95rem' }}>
                  {todayDiary.userEntry}
                </div>
              </div>
              {userProfile?.image && (
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0, marginTop: '25px' }}>
                  <Image src={userProfile.image} alt="user" fill style={{ objectFit: 'cover' }} />
                </div>
              )}
            </div>

            {/* Char Reply */}
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', alignItems: 'flex-start' }}>
              {activeChar?.image && (
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0, marginTop: '25px' }}>
                  <Image src={activeChar.image} alt="char" fill style={{ objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginLeft: '5px' }}>{activeChar?.name}</span>
                <div className="notebook-paper" style={{ width: '100%', maxWidth: '100%', lineHeight: '1.6', fontSize: '0.95rem', minHeight: '100px' }}>
                  {todayDiary.isAdLocked ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', padding: '10px 0' }}>
                      <div style={{ filter: 'blur(5px)', opacity: 0.5, userSelect: 'none' }}>
                        (부드럽게 미소지으며 네 머리카락을 넘겨준다. 심장이 요동친다.) 정말 보고 싶었어. 오늘 하루 어땠어?
                      </div>
                      <button 
                        onClick={() => {
                          showAd(async (result) => {
                            if (!result.didOpen) {
                              if (result.message) setAdFailureMessage(result.message);
                              logAdDiagnostic('diary', 'ad_open_failed', { characterId: activeCharId, diaryId: todayDiary.id, action: 'unlock_existing_diary' });
                              return;
                            }
                            try {
                              await unlockDiaryAd(todayDiary.id);
                              logAdDiagnostic('diary', 'ad_completed', { characterId: activeCharId, diaryId: todayDiary.id, action: 'unlock_existing_diary' });
                            } catch (e) {
                              logAdDiagnostic('diary', 'ad_unlock_failed', { characterId: activeCharId, diaryId: todayDiary.id, action: 'unlock_existing_diary' }, e);
                            }
                            refreshActiveDiary();
                          });
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '10px 20px', backgroundColor: 'var(--point-color)', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', zIndex: 10, marginTop: '-30px'
                        }}
                      >
                        <Lock size={16} />
                        <span>{t('diary.viewReply')}</span>
                      </button>
                    </div>
                  ) : (
                    <>{todayDiary.charReply}</>
                  )}
                </div>
                {!todayDiary.isAdLocked && todayDiary.charReply && (
                  <button
                    onClick={() => setReportModalOpen(true)}
                    style={{
                      marginTop: '8px',
                      marginLeft: '5px',
                      padding: '4px 0',
                      background: 'none',
                      border: 'none',
                      color: 'var(--gray-500)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    {t('report.button')}
                  </button>
                )}
              </div>
            </div>
            
            <p style={{ fontSize: '0.75rem', color: 'var(--gray-600)', textAlign: 'center', marginTop: '20px' }}>
              {t('diary.breakHintPre')}<Link href={buildStaticEntityRoute('/mypage/edit-character', activeChar?.id || '')} style={{ color: 'var(--point-color)', textDecoration: 'underline' }}>{t('nav.mypage')}</Link>{t('diary.breakHintPost')}
            </p>
            <button 
              onClick={() => router.push('/diary/history?charId=' + activeCharId)}
              style={{
                marginTop: '10px',
                padding: '15px',
                backgroundColor: 'white',
                color: 'var(--point-color)',
                border: '1px solid var(--point-color)',
                borderRadius: '10px',
                fontWeight: 'bold',
                fontSize: '1.1rem',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
            >
              {t('diary.viewAll')}
            </button>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {activeCharId === 'dummy' ? (
              <>
                <div 
                  onClick={handleDummyClick}
                  className="diary-dummy-flow"
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '15px', padding: '20px 10px', marginTop: '-10px', cursor: 'pointer' }}
                >
                  {/* User Message */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', opacity: 0, animation: 'fadeInUp 0.6s ease 0.5s forwards' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginRight: '5px' }}>{t('common.me')}</span>
                    <div className="post-it" style={{ maxWidth: '85%', lineHeight: '1.6', fontSize: '1rem' }} dangerouslySetInnerHTML={{ __html: t('dummy.diaryUserMsg') }}>
                    </div>
                  </div>

                  {/* Character Message */}
                  <div className="diary-dummy-message" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', opacity: 0, animation: 'fadeInUp 0.6s ease 1.2s forwards' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginLeft: '5px' }}>{t('dummy.charName') || '드림캐'}</span>
                    <div className="notebook-paper" style={{ maxWidth: '85%', lineHeight: '1.6', fontSize: '1rem' }} dangerouslySetInnerHTML={{ __html: t('dummy.diaryCharMsg') }}>
                    </div>
                  </div>
                </div>
                <p 
                  onClick={handleDummyClick}
                  className="diary-guide"
                  style={{ fontSize: '16px', color: 'var(--gray-500)', textAlign: 'center', marginBottom: '20px', lineHeight: '1.5', cursor: 'pointer' }} 
                  dangerouslySetInnerHTML={{ __html: t('dummy.diaryGuide') }}
                >
                </p>
                <button 
                  onClick={handleDummyClick}
                  className="diary-cta"
                  style={{
                    position: 'relative',
                    marginTop: 'auto',
                    padding: '15px',
                    backgroundColor: 'var(--point-color)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    fontWeight: 'bold',
                    fontSize: '1.1rem',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.1)'
                  }}
                >
                  {t('dummy.createCharBtn')}
                </button>
              </>
            ) : (
              <>
                <div className="diary-writing-input-wrap" style={{ position: 'relative', display: 'flex', flexDirection: 'column', marginBottom: '15px' }}>
                  <textarea 
                    ref={diaryInputRef}
                    className="diary-entry-textarea"
                    value={userEntry}
                    onChange={e => {
                      setUserEntry(e.target.value.slice(0, 500));
                      if (draftLoaded.current) {
                        clearDraft(activeCharId, 'diary');
                        draftLoaded.current = false;
                      }
                      resizeDiaryInput(e.target);
                    }}
                    onFocus={() => window.setTimeout(() => diaryInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)}
                    placeholder={t('diary.placeholder')}
                    style={{
                      padding: '15px',
                      paddingBottom: '30px',
                      borderRadius: '15px',
                      border: '1px solid var(--border-color)',
                      outline: 'none',
                      resize: 'none',
                      fontSize: '1rem',
                      lineHeight: '1.5',
                      overflowY: 'hidden',
                    }}
                    disabled={saving}
                  />
                  <span style={{ position: 'absolute', bottom: '15px', right: '15px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{userEntry.length}/500</span>
                </div>
                
                <button 
                  onClick={handleSend}
                  disabled={!userEntry.trim() || saving}
                  style={{
                    padding: '15px',
                    backgroundColor: userEntry.trim() && !saving ? 'var(--point-color)' : 'var(--gray-400)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    fontWeight: 'bold',
                    fontSize: '1.1rem',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: userEntry.trim() && !saving ? 'pointer' : 'not-allowed',
                    transition: 'background-color 0.2s'
                  }}
                >
                  {saving ? (
                    <>
                      <Loader2 className="animate-spin" size={20} style={{ animation: 'spin 2s linear infinite' }} />
                      <span>{t('diary.writing').replace('{name}', activeChar?.name || '')}</span>
                    </>
                  ) : (
                    <>
                      <Send size={20} />
                      <span>{t('diary.sendBtn')}</span>
                    </>
                  )}
                </button>
                <button 
                  onClick={() => router.push('/diary/history?charId=' + activeCharId)}
                  style={{
                    marginTop: '10px',
                    padding: '15px',
                    backgroundColor: 'white',
                    color: 'var(--point-color)',
                    border: '1px solid var(--point-color)',
                    borderRadius: '10px',
                    fontWeight: 'bold',
                    fontSize: '1.1rem',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s'
                  }}
                >
                  {t('diary.viewAll')}
                </button>
              </>
            )}
          </div>
        )}
        
        <AdModal isOpen={adModalOpen} onConfirm={confirmAd} />
        {adFailureMessage && (
          <div style={{ position: 'fixed', left: '50%', bottom: 'calc(var(--safe-bottom) + 16px)', transform: 'translateX(-50%)', zIndex: 4000, width: 'calc(100% - 32px)', maxWidth: '448px', backgroundColor: 'var(--gray-900)', color: 'white', borderRadius: '12px', padding: '12px 14px', fontSize: '0.9rem', textAlign: 'center', lineHeight: 1.4 }}>
            {adFailureMessage}
          </div>
        )}
        <ErrorModal isOpen={errorModalOpen} onConfirm={() => setErrorModalOpen(false)} />
        <ReportModal
          isOpen={reportModalOpen}
          onClose={() => setReportModalOpen(false)}
          onSubmit={submitDiaryReport}
        />
      </main>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />
    </div>
  );
}

export default function DiaryPage() {
  return (
    <Suspense fallback={<div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}><Loader2 className="animate-spin" size={32} color="var(--point-color)" /></div>}>
      <DiaryContent />
    </Suspense>
  );
}
