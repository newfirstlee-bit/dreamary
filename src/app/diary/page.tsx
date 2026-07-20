"use client";

import { useEffect, useState, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUserId } from '@/hooks/useUserId';
import { getCharactersByUser, getUserProfile, getTopics, getDiariesByUserAndChar, subscribeDiaries, saveDiary, Character, UserProfile, Topic, Diary, unlockDiaryAd } from '@/lib/db';
import { Loader2, Send, ChevronDown, User, Lock } from 'lucide-react';
import Link from 'next/link';
import AdModal from '@/components/AdModal';
import ErrorModal from '@/components/ErrorModal';
import EmptyCharacterModal from '@/components/EmptyCharacterModal';
import { trackDiaryAndCheckAd } from '@/lib/adTracker';
import { trackEvent } from '@/lib/mixpanel';
import { saveDraft, loadDraft, clearDraft } from '@/lib/draftStorage';
import { useRef } from 'react';
import { useLocale } from '@/lib/i18n';

function DiaryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = useUserId();
  const { t, locale } = useLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const draftLoaded = useRef(false);
  
  const [adModalOpen, setAdModalOpen] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [showEmptyModal, setShowEmptyModal] = useState(false);
  const [modalResolver, setModalResolver] = useState<(() => void) | null>(null);

  const confirmAd = () => {
    window.open('https://www.effectivecpmnetwork.com/rk8wuv0t?key=d9c3569d98ad59723168cace64459dd2', '_blank');
    setAdModalOpen(false);
    if (modalResolver) {
      modalResolver();
      setModalResolver(null);
    }
  };

  const closeAdModal = () => {
    setAdModalOpen(false);
    if (modalResolver) {
      modalResolver();
      setModalResolver(null);
    }
  };
  
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharId, setActiveCharId] = useState<string>('');
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile | null>>({});
  
  const [todayTopic, setTodayTopic] = useState<Topic | null>(null);
  const [allTopics, setAllTopics] = useState<Topic[]>([]);
  const [todayDiary, setTodayDiary] = useState<Diary | null>(null);
  const [userEntry, setUserEntry] = useState('');

  const loadInitialData = async () => {
    if (!userId) return;
    const now = new Date();
    const dateString = now.toISOString().split('T')[0];
    const [chars, topics] = await Promise.all([
      getCharactersByUser(userId),
      getTopics()
    ]);
    const profiles = await Promise.all(chars.map(c => getUserProfile(c.id)));
    const profileMap: Record<string, UserProfile | null> = {};
    chars.forEach((c, idx) => {
      profileMap[c.id] = profiles[idx];
    });
    setCharacters(chars);
    setUserProfiles(profileMap);
    setAllTopics(topics);
    
    if (activeCharId) {
       const diaries = await getDiariesByUserAndChar(userId, activeCharId);
       const todayD = diaries.find(d => d.dateString === dateString);
       // We use subscribeDiaries in a separate useEffect for real-time updates.
       // setTodayDiary(todayD || null); is handled by subscription now.
    }
  };

  useEffect(() => {
    if (!activeCharId || !userId) return;
    const now = new Date();
    const dateString = now.toISOString().split('T')[0];
    
    const unsubscribe = subscribeDiaries(userId, activeCharId, (diaries) => {
      const todayD = diaries.find(d => d.dateString === dateString);
      setTodayDiary(todayD || null);
    });
    
    return () => unsubscribe();
  }, [activeCharId, userId]);

  useEffect(() => {
    const init = async () => {
      if (!userId) return;
      try {
        const [chars, topics] = await Promise.all([
          getCharactersByUser(userId),
          getTopics()
        ]);

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
          setLoading(false);
          return;
        }

        const profiles = await Promise.all(chars.map(c => getUserProfile(c.id)));
        const profileMap: Record<string, UserProfile | null> = {};
        chars.forEach((c, idx) => {
          profileMap[c.id] = profiles[idx];
        });

        setCharacters(chars);
        setUserProfiles(profileMap);
        
        const now = new Date();
        const dateString = now.toISOString().split('T')[0];

        let initialCharId = chars[0].id;
        let allAnswered = true;

        const diariesArrays = await Promise.all(chars.map(c => getDiariesByUserAndChar(userId, c.id)));
        for (let i = 0; i < chars.length; i++) {
          const char = chars[i];
          const hasToday = diariesArrays[i].some(d => d.dateString === dateString);
          if (!hasToday) {
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

        // Pick topic based on day of year
        if (topics.length > 0) {
          setAllTopics(topics);
          const diaries = await getDiariesByUserAndChar(userId, initialCharId);
          const todayD = diaries.find(d => d.dateString === dateString);
          
          if (todayD) {
            setTodayDiary(todayD);
            const matchedTopic = topics.find(t => t.id === todayD.topicId);
            setTodayTopic(matchedTopic || topics[0]);
          } else {
            const nextIdx = diaries.length % topics.length;
            setTodayTopic(topics[nextIdx]);
            
            const draft = loadDraft(initialCharId);
            if (draft) {
              setUserEntry(draft);
              draftLoaded.current = true;
            }
          }
        }

        setLoading(false);
      } catch (err) {
        console.error("Failed to load diary data:", err);
        setLoading(false);
      }
    };
    init();
  }, [router, userId]);

  useEffect(() => {
    loadInitialData();
  }, [userId]);

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

  const handleCharSelect = async (charId: string) => {
    setActiveCharId(charId);
    setUserEntry('');
    setTodayDiary(null);
    setLoading(true);

    try {

      const now = new Date();
      const dateString = now.toISOString().split('T')[0];
      const diaries = await getDiariesByUserAndChar(userId, charId);
      const todayD = diaries.find(d => d.dateString === dateString);
      if (todayD) {
        setTodayDiary(todayD);
        const matchedTopic = allTopics.find(t => t.id === todayD.topicId);
        setTodayTopic(matchedTopic || allTopics[0]);
      } else {
        const nextIdx = diaries.length % allTopics.length;
        setTodayTopic(allTopics[nextIdx] || allTopics[0]);
        
        const draft = loadDraft(charId);
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

  const handleSend = async () => {
    if (!userEntry.trim() || !todayTopic || !activeCharId) return;

    setSaving(true);
    try {

      const char = characters.find(c => c.id === activeCharId);
      const activeProfile = userProfiles[activeCharId];
      const dateString = new Date().toISOString().split('T')[0];
      
      const isAdTurn = trackDiaryAndCheckAd();
      
      let adWaitPromise = Promise.resolve();
      if (isAdTurn) {
        setAdModalOpen(true);
        adWaitPromise = new Promise<void>((resolve) => {
          setModalResolver(() => () => resolve());
        });
      }

      const requestId = crypto.randomUUID();
      
      let success = false;
      let savedId = '';
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (typeof window !== 'undefined' && localStorage.getItem('dev_force_error') === 'true') {
            throw new Error('Forced error for testing');
          }

          const res = await fetch('/api/diary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              character: char,
              userProfile: activeProfile,
              topic: todayTopic.content,
              userEntry,
              userId,
              topicId: todayTopic.id,
              dateString,
              isAdTurn,
              requestId
            })
          });

          const data = await res.json();
          if (res.ok && !data.error) {
            success = true;
            savedId = data.savedId;
            break;
          }
        } catch (e) {
          console.error(`Attempt ${attempt} failed:`, e);
        }

        if (!success && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (!success) {
        throw new Error('All 3 attempts failed');
      }

      if (isAdTurn) {
        await adWaitPromise;
        await unlockDiaryAd(savedId);
      }

      trackEvent('Diary_Written', {
        topic_order: todayTopic.order,
        topic_id: todayTopic.id,
        character_id: char.id,
        content_length: userEntry.length
      });

      setUserEntry('');
      clearDraft(char!.id);
      // subscribeDiaries가 실시간으로 Firestore 업데이트를 감지하므로 별도 재조회 불필요

    } catch (err) {
      console.error(err);
      closeAdModal();
      saveDraft(activeCharId, userEntry);
      setErrorModalOpen(true);
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

  let formattedContent = (locale === 'ja' && todayTopic?.contentJa) ? todayTopic.contentJa : (todayTopic?.content || '');
  if (formattedContent && activeChar) {
    formattedContent = formattedContent
      .replace(/{유저}/g, userProfile?.name || (locale === 'ja' ? t('common.user') : '유저'))
      .replace(/{캐릭터}/g, activeChar.name);
  }

  return (
    <div className="app-container diary-bg" style={{ paddingBottom: '65px' }}>
      <header className="header" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, position: 'relative', display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
        <span>{t('diary.header')}</span>
      </header>

      {/* Character Selector (Horizontal Scroll) */}
      {characters.length > 0 && (
        <div style={{ display: 'flex', gap: '15px', overflowX: 'auto', padding: '15px 20px', scrollbarWidth: 'none', backgroundColor: '#F5F0FF' }}>
          {[...characters].sort((a, b) => {
      
            const history: string[] = JSON.parse(localStorage.getItem(`recentChars_${userId}`) || '[]');
            const idxA = a.id === activeCharId ? -1 : (history.indexOf(a.id) === -1 ? 999 : history.indexOf(a.id));
            const idxB = b.id === activeCharId ? -1 : (history.indexOf(b.id) === -1 ? 999 : history.indexOf(b.id));
            return idxA - idxB;
          }).map(char => {
            const isSelected = char.id === activeCharId;
            return (
              <div 
                key={char.id} 
                onClick={() => {
                  handleCharSelect(char.id);
            
                  const history: string[] = JSON.parse(localStorage.getItem(`recentChars_${userId}`) || '[]');
                  const newHistory = [char.id, ...history.filter(id => id !== char.id)];
                  localStorage.setItem(`recentChars_${userId}`, JSON.stringify(newHistory));
                }}
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
                <div style={{ 
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

      <main className="content" style={{ display: 'flex', flexDirection: 'column' }}>
        
        {/* Topic Display */}
        {todayTopic && (
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', border: '1px solid var(--border-color)', marginBottom: '20px', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
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
                <div className="notebook-paper" style={{ width: '100%', maxWidth: '85%', lineHeight: '1.6', fontSize: '0.95rem', minHeight: '100px' }}>
                  {todayDiary.isAdLocked ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', padding: '10px 0' }}>
                      <div style={{ filter: 'blur(5px)', opacity: 0.5, userSelect: 'none' }}>
                        (부드럽게 미소지으며 네 머리카락을 넘겨준다. 심장이 요동친다.) 정말 보고 싶었어. 오늘 하루 어땠어?
                      </div>
                      <button 
                        onClick={async () => {
                          window.open('https://www.effectivecpmnetwork.com/rk8wuv0t?key=d9c3569d98ad59723168cace64459dd2', '_blank');
                          await unlockDiaryAd(todayDiary.id);
                          loadInitialData();
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
              </div>
            </div>
            
            <p style={{ fontSize: '0.75rem', color: 'var(--gray-600)', textAlign: 'center', marginTop: '20px' }}>
              {t('diary.breakHintPre')}<Link href={`/mypage/edit-character/${activeChar?.id}`} style={{ color: 'var(--point-color)', textDecoration: 'underline' }}>{t('nav.mypage')}</Link>{t('diary.breakHintPost')}
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
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '27px', padding: '20px 10px', marginTop: '10px' }}>
                  {/* User Message */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', opacity: 0, animation: 'fadeInUp 0.6s ease 0.5s forwards' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginRight: '5px' }}>{t('common.me')}</span>
                    <div className="post-it" style={{ maxWidth: '85%', lineHeight: '1.6', fontSize: '1rem' }} dangerouslySetInnerHTML={{ __html: t('dummy.diaryUserMsg') }}>
                    </div>
                  </div>

                  {/* Character Message */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', opacity: 0, animation: 'fadeInUp 0.6s ease 1.2s forwards' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginLeft: '5px' }}>{t('dummy.charName') || '드림캐'}</span>
                    <div className="notebook-paper" style={{ maxWidth: '85%', lineHeight: '1.6', fontSize: '1rem' }} dangerouslySetInnerHTML={{ __html: t('dummy.diaryCharMsg') }}>
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: '16px', color: 'var(--gray-500)', textAlign: 'center', marginBottom: '20px', lineHeight: '1.5' }} dangerouslySetInnerHTML={{ __html: t('dummy.diaryGuide') }}>
                </p>
                <button 
                  onClick={() => router.push('/onboarding?skip=true')}
                  style={{
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
                <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', marginBottom: '15px' }}>
                  <textarea 
                    value={userEntry}
                    onChange={e => {
                      setUserEntry(e.target.value.slice(0, 500));
                      if (draftLoaded.current) {
                        clearDraft(activeCharId);
                        draftLoaded.current = false;
                      }
                    }}
                    placeholder={t('diary.placeholder')}
                    style={{
                      flex: 1,
                      minHeight: '60px',
                      padding: '15px',
                      paddingBottom: '30px',
                      borderRadius: '15px',
                      border: '1px solid var(--border-color)',
                      outline: 'none',
                      resize: 'none',
                      fontSize: '1rem',
                      lineHeight: '1.5',
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
        <ErrorModal isOpen={errorModalOpen} onConfirm={() => setErrorModalOpen(false)} />
        <EmptyCharacterModal isOpen={showEmptyModal} onClose={() => setShowEmptyModal(false)} />
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
