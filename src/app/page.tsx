"use client";

import React, { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useUserId } from '@/hooks/useUserId';
import { useAuth } from '@/components/AuthContext';
import { useLocale, getDateLocale } from '@/lib/i18n';
import { Character, getTodayDiaryByUserAndChar, getDiaryCountByUserAndChar, getTopics, Topic, getUserProfile, UserProfile, getLatestChatMessage, ChatMessage } from '@/lib/db';
import { uploadImageToImgbb } from '@/lib/imgbb';
import { Loader2, User, Settings, Camera, Image as ImageIcon, ChevronRight } from 'lucide-react';
import { trackEvent } from '@/lib/mixpanel';
import { readUserCache, writeUserCache } from '@/lib/appCache';
import { getRecentCharacterIds, sortCharactersByRecent, touchRecentCharacter } from '@/lib/characterOrder';
import { getCharactersWithGuestRecovery } from '@/lib/ownership';
import { useAppStore } from '@/store/useAppStore';
import { buildStaticEntityRoute } from '@/lib/navigation';
import { INITIAL_PING_EVENT, ensureInitialPing, isInitialPingPending } from '@/lib/initialPing';

interface HomeCache {
  characters: Character[];
  selectedCharId: string | null;
  unwrittenCharIds: string[];
  charTopics: Record<string, Topic | null>;
  userProfiles: Record<string, UserProfile | null>;
}

const withTimeout = <T,>(promise: Promise<T>, timeoutMs = 12000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('데이터 요청 시간이 초과되었습니다.')), timeoutMs)
    ),
  ]);

interface ErrorBoundaryProps { children: React.ReactNode }
interface ErrorBoundaryState { hasError: boolean; errorMsg: string }

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error.toString() + '\n' + error.stack };
  }
  render() {
    if (this.state.hasError) {
      return <div style={{padding: 20, color: 'red', wordBreak: 'break-all'}}><p>CRASH ERROR:</p><pre>{this.state.errorMsg}</pre></div>;
    }
    return this.props.children;
  }
}

export default function Home() {
  const router = useRouter();
  const { t, locale } = useLocale();
  const { user, loading: authLoading, error: authError, status } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [unwrittenChars, setUnwrittenChars] = useState<Set<string>>(new Set());
  const [charTopics, setCharTopics] = useState<Record<string, Topic | null>>({});
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile | null>>({});
  const [latestChat, setLatestChat] = useState<ChatMessage | null>(null);
  const [initialPingCharIds, setInitialPingCharIds] = useState<Set<string>>(new Set());

  const { loadCharacters, loadTopics } = useAppStore();

  const baseUserId = useUserId();
  const userId = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'true' 
    ? '4b0b39a0-d691-4f5d-b562-0fc49a02e790' 
    : baseUserId;

  useEffect(() => {
    if (authLoading || !userId) return;

    // 첫 실행만 교환일기에서 시작하고, 사용자가 홈을 누른 뒤에는 홈 이동을 존중합니다.
    if (!user && !sessionStorage.getItem('has_redirected_to_diary')) {
      sessionStorage.setItem('has_redirected_to_diary', 'true');
      router.replace('/diary');
      return;
    }

    const cachedHome = readUserCache<HomeCache>(userId, 'home');
    if (cachedHome) {
      setCharacters(cachedHome.characters);
      setSelectedCharId(cachedHome.selectedCharId);
      setUnwrittenChars(new Set(cachedHome.unwrittenCharIds));
      setCharTopics(cachedHome.charTopics);
      setUserProfiles(cachedHome.userProfiles);
      setLoading(false);
      setLoadError(null);
    }

    const init = async () => {

      try {
        if (!cachedHome) setLoading(true);
        setLoadError(null);
        // 데모 링크 처리 (?demo=true)
        if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'true') {
          localStorage.setItem('dreamary_user_id', userId);
          // 쿠키도 함께 업데이트해줍니다
          document.cookie = "dreamary_user_id=" + userId + "; path=/; max-age=31536000";
        }

        const rawChars = await withTimeout(loadCharacters(userId, status === 'authenticated'));
        const chars = sortCharactersByRecent(rawChars, userId);
        
        const hasCharacter = chars.length > 0 && chars[0]?.id !== 'dummy';
        trackEvent('main_screen_view', {
          has_character: hasCharacter
        });
        
        if (chars.length === 0) {
          if (!sessionStorage.getItem('has_redirected_to_diary')) {
            sessionStorage.setItem('has_redirected_to_diary', 'true');
            router.replace('/diary');
            return;
          } else {
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
            setSelectedCharId('dummy');
            setUnwrittenChars(new Set(['dummy']));
            setLoading(false);
            
            let topics: Topic[] = [];
            try {
              topics = await withTimeout(loadTopics());
            } catch (err) {
              console.error("Failed to fetch topics for dummy:", err);
            }
            if (topics.length > 0) {
              setCharTopics({ dummy: topics[0] });
              writeUserCache<HomeCache>(userId, 'home', {
                characters: [dummyChar],
                selectedCharId: 'dummy',
                unwrittenCharIds: ['dummy'],
                charTopics: { dummy: topics[0] },
                userProfiles: {}
              });
            } else {
              const dummyTopic = { id: 'dummy', order: 1, content: t('dummy.firstTopic') || '오늘 하루는 어땠어?' } as Topic;
              setCharTopics({ dummy: dummyTopic });
              writeUserCache<HomeCache>(userId, 'home', {
                characters: [dummyChar],
                selectedCharId: 'dummy',
                unwrittenCharIds: ['dummy'],
                charTopics: { dummy: dummyTopic },
                userProfiles: {}
              });
            }
          }
        } else {
          setCharacters(chars);
          
          const recentHistory = getRecentCharacterIds(userId);
          let initialCharId = chars[0].id;
          
          if (recentHistory.length > 0) {
            const lastId = recentHistory[0];
            if (chars.some(c => c.id === lastId)) {
              initialCharId = lastId;
            }
          }
          setSelectedCharId(initialCharId);
          setLoading(false);

          const now = new Date();
          const dateString = now.toISOString().split('T')[0];
          const unwritten = new Set<string>();
          const topics = await withTimeout(loadTopics());
          const newCharTopics: Record<string, Topic | null> = {};
          const newUserProfiles: Record<string, UserProfile | null> = {};

          const todayDiaries = await withTimeout(Promise.all(
            chars.map(c => getTodayDiaryByUserAndChar(userId, c.id, dateString))
          ));
          const diaryCounts = await withTimeout(Promise.all(
            chars.map((c, index) => todayDiaries[index] ? Promise.resolve(0) : getDiaryCountByUserAndChar(userId, c.id))
          ));
          const selectedProfile = await withTimeout(getUserProfile(initialCharId));
          newUserProfiles[initialCharId] = selectedProfile;

          for (let i = 0; i < chars.length; i++) {
            const char = chars[i];
            const todayD = todayDiaries[i];
            if (!todayD) unwritten.add(char.id);

            if (topics.length > 0) {
              if (todayD) {
                const matchedTopic = topics.find(t => t.id === todayD.topicId);
                newCharTopics[char.id] = matchedTopic || topics[0];
              } else {
                const nextIdx = diaryCounts[i] % topics.length;
                newCharTopics[char.id] = topics[nextIdx] || topics[0];
              }
            }
          }
          setUnwrittenChars(unwritten);
          setCharTopics(newCharTopics);
          setUserProfiles(newUserProfiles);
          writeUserCache<HomeCache>(userId, 'home', {
            characters: chars,
            selectedCharId: initialCharId,
            unwrittenCharIds: Array.from(unwritten),
            charTopics: newCharTopics,
            userProfiles: newUserProfiles
          });
        }
      } catch (err) {
        console.error("Failed to load user data:", err);
        if (cachedHome) {
          setLoading(false);
          return;
        }
        if (!user) {
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
          setCharacters([dummyChar]);
          setSelectedCharId('dummy');
          setUnwrittenChars(new Set(['dummy']));
          setCharTopics({
            dummy: { id: 'dummy', order: 1, content: t('dummy.firstTopic') || '오늘 하루는 어땠어?' } as Topic
          });
          writeUserCache<HomeCache>(userId, 'home', {
            characters: [dummyChar],
            selectedCharId: 'dummy',
            unwrittenCharIds: ['dummy'],
            charTopics: { dummy: { id: 'dummy', order: 1, content: t('dummy.firstTopic') || '오늘 하루는 어땠어?' } as Topic },
            userProfiles: {}
          });
          setLoading(false);
          return;
        }
        setLoadError('데이터를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
        setLoading(false);
      }
    };
    
    init();
  }, [authLoading, user, userId, status, retryCount, router]);

  
  useEffect(() => {
    if (selectedCharId) {
      if (selectedCharId === 'dummy') {
        setLatestChat({
          id: 'dummy_chat',
          userId: 'dummy',
          characterId: 'dummy',
          role: 'assistant',
          content: t('dummy.chatMsg') || '지금 바빠? 하고싶은 말이 있어.',
          createdAt: Date.now(),
          locale: locale
        } as ChatMessage);
        return;
      }

      const fetchLatestChat = async () => {
        try {
          if (isInitialPingPending(userId!, selectedCharId)) {
            setInitialPingCharIds(prev => new Set(prev).add(selectedCharId));
          }
          const latestMessage = await getLatestChatMessage(userId!, selectedCharId);
          if (latestMessage) {
            setLatestChat(latestMessage);
            setInitialPingCharIds(prev => {
              const next = new Set(prev);
              next.delete(selectedCharId);
              return next;
            });
          } else {
            setLatestChat(null);
            const char = characters.find(c => c.id === selectedCharId);
            const profile = userProfiles[selectedCharId] || null;

            if (char) {
              setInitialPingCharIds(prev => new Set(prev).add(selectedCharId));
              const data = await ensureInitialPing({
                character: char,
                userProfile: profile,
                userId: userId!,
              });
              setLatestChat({
                id: data.savedId || Date.now().toString(),
                userId: userId!,
                characterId: selectedCharId,
                role: 'assistant',
                content: data.reply,
                createdAt: Date.now()
              } as ChatMessage);
              setInitialPingCharIds(prev => {
                const next = new Set(prev);
                next.delete(selectedCharId);
                return next;
              });
            }
          }
        } catch (e) {
          console.error("Failed to fetch latest chat", e);
          setInitialPingCharIds(prev => {
            const next = new Set(prev);
            next.delete(selectedCharId);
            return next;
          });
        }
      };
      fetchLatestChat();
    }
  }, [selectedCharId, userId]);

  useEffect(() => {
    if (!userId) return;

    const handleInitialPingState = (event: Event) => {
      const detail = (event as CustomEvent<{
        status: 'started' | 'completed' | 'failed';
        userId: string;
        characterId: string;
        reply?: string;
        savedId?: string;
      }>).detail;

      if (!detail || detail.userId !== userId) return;

      if (detail.status === 'started') {
        setInitialPingCharIds(prev => new Set(prev).add(detail.characterId));
        return;
      }

      setInitialPingCharIds(prev => {
        const next = new Set(prev);
        next.delete(detail.characterId);
        return next;
      });

      if (detail.status === 'completed' && detail.characterId === selectedCharId && detail.reply) {
        setLatestChat({
          id: detail.savedId || Date.now().toString(),
          userId,
          characterId: detail.characterId,
          role: 'assistant',
          content: detail.reply,
          createdAt: Date.now(),
          locale
        } as ChatMessage);
      }
    };

    window.addEventListener(INITIAL_PING_EVENT, handleInitialPingState);
    return () => window.removeEventListener(INITIAL_PING_EVENT, handleInitialPingState);
  }, [locale, selectedCharId, userId]);

  useEffect(() => {
    if (!selectedCharId || !userId || selectedCharId === 'dummy') return;
    if (Object.prototype.hasOwnProperty.call(userProfiles, selectedCharId)) return;

    let cancelled = false;
    getUserProfile(selectedCharId)
      .then(profile => {
        if (cancelled) return;
        setUserProfiles(prev => ({ ...prev, [selectedCharId]: profile }));
      })
      .catch(error => console.warn('Failed to load selected profile:', error));

    return () => {
      cancelled = true;
    };
  }, [selectedCharId, userId, userProfiles]);

  const selectedChar = characters.find(c => c.id === selectedCharId) || characters[0];

  if (authError || loadError) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center', gap: '16px' }}>
        <p style={{ color: 'var(--gray-700)', lineHeight: 1.6 }}>{authError || loadError}</p>
        <button
          onClick={() => {
            if (authError) window.location.reload();
            else setRetryCount(count => count + 1);
          }}
          style={{ border: 'none', borderRadius: '12px', padding: '14px 24px', background: 'var(--point-color)', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
        <style dangerouslySetInnerHTML={{__html: `@keyframes spin { 100% { transform: rotate(360deg); } }`}} />
      </div>
    );
  }

  // Calculate D-day
  const calculateDDay = () => {
    if (!selectedChar) return 1;
    const startTs = selectedChar.dDayStartDate || selectedChar.createdAt || Date.now();
    const diff = Date.now() - startTs;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    return days >= 0 ? days + 1 : days;
  };

  const dDay = calculateDDay();
  const bgImage = selectedChar?.homeBackgroundImage || selectedChar?.image;
  const hasBg = !!bgImage;
  const isLightMode = selectedChar?.homeTheme === 'light';
  const textColor = hasBg ? (isLightMode ? 'var(--gray-800)' : 'white') : 'var(--gray-800)';
  const textShadow = hasBg ? (isLightMode ? 'none' : '0 2px 10px rgba(0,0,0,0.5)') : 'none';
  const todayTopic = selectedCharId ? charTopics[selectedCharId] || null : null;
  const userProfile = selectedCharId ? userProfiles[selectedCharId] : null;
  const isInitialPingTyping = Boolean(selectedCharId && selectedCharId !== 'dummy' && initialPingCharIds.has(selectedCharId) && !latestChat);

  let formattedContent = (locale === 'ja' && todayTopic?.contentJa) ? todayTopic.contentJa : (todayTopic?.content || '');
  if (formattedContent && selectedChar) {
    formattedContent = formattedContent
      .replace(/{유저}/g, userProfile?.name || (locale === 'ja' ? t('common.user') : '유저'))
      .replace(/{캐릭터}/g, selectedChar.name);
  }

  return (
    <ErrorBoundary>
    <div 
      className={`app-container tab-page home-page ${!hasBg ? 'diary-bg status-surface-check' : 'status-surface-home-bg'}`}
      style={{ 
        position: 'relative',
        ...(hasBg ? {
          backgroundImage: `url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        } : {})
      }}
    >
      {/* Semi-transparent overlay if there is a background, to ensure UI is readable */}
      {hasBg && (
        <div style={{ 
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
          background: isLightMode 
            ? 'linear-gradient(to bottom, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.0) 30%, rgba(255,255,255,0.0) 70%, rgba(255,255,255,0.6) 100%)'
            : 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.0) 30%, rgba(0,0,0,0.0) 70%, rgba(0,0,0,0.5) 100%)', 
          pointerEvents: 'none' 
        }} />
      )}

      <div className="home-shell" style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column' }}>
        {/* Character Selector (Horizontal Scroll) */}
        <div className="home-character-selector" style={{ display: 'flex', gap: '15px', overflowX: 'auto', padding: '25px', scrollbarWidth: 'none', flexShrink: 0 }}>
            {[...characters].sort((a, b) => {
              const history = getRecentCharacterIds(userId);
              
              // Ensure currently selected is ALWAYS first (index -1 artificially)
              const idxA = a.id === selectedCharId ? -1 : (history.indexOf(a.id) === -1 ? 999 : history.indexOf(a.id));
              const idxB = b.id === selectedCharId ? -1 : (history.indexOf(b.id) === -1 ? 999 : history.indexOf(b.id));
              
              return idxA - idxB;
            }).map(char => {
              const isSelected = char.id === selectedCharId;
              return (
                <div 
                  key={char.id} 
                  onClick={() => {
                    setSelectedCharId(char.id);
                    touchRecentCharacter(userId, char.id);
                  }}
                  className="home-character-card"
                  style={{ 
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flexShrink: 0, cursor: 'pointer',
                    backgroundColor: hasBg ? (isLightMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.15)') : 'white',
                    backdropFilter: hasBg ? 'blur(10px)' : 'none',
                    padding: '12px',
                    borderRadius: '20px',
                    border: 'none',
                    boxShadow: isLightMode ? (isSelected ? 'inset 0 0 0 1.5px var(--gray-700)' : 'inset 0 0 0 1px rgba(0,0,0,0.1)') : (isSelected ? (hasBg ? 'inset 0 0 0 1.5px white' : 'inset 0 0 0 1.5px var(--point-color)') : 'inset 0 0 0 1px rgba(255,255,255,0.15)'),
                    transition: 'all 0.2s'
                  }}
                >
                  <div className="home-character-avatar" style={{
                    width: '70px', height: '70px', borderRadius: '15px', overflow: 'hidden', backgroundColor: 'var(--gray-200)', position: 'relative'
                  }}>
                    {char.image ? (
                      <Image src={char.image} alt={char.name} fill style={{ objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <User size={32} color="var(--gray-500)" />
                      </div>
                    )}
                    {unwrittenChars.has(char.id) && (
                      <div style={{
                        position: 'absolute', top: '4px', right: '4px', width: '12px', height: '12px', 
                        backgroundColor: '#FF3B30', borderRadius: '50%'
                      }} />
                    )}
                  </div>
                  <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                    <span style={{ position: 'relative', fontSize: '0.9rem', fontWeight: 'bold', color: hasBg ? (isLightMode ? 'var(--gray-800)' : 'white') : 'var(--foreground)' }}>
                      {char.name.length > 5 ? char.name.slice(0, 5) + '...' : char.name}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

                {/* Main Content Area */}
        <main className="content home-main" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 25px 25px 25px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 'bold', color: textColor, textShadow }}>
                  {selectedChar?.pairName || selectedChar?.name}
                </span>
                <button 
                  onClick={() => {
                    if (selectedChar?.id === 'dummy') {
                      trackEvent('locked_feature_tapped', { feature_name: 'settings', screen: 'home' });
                      router.push('/onboarding?skip=true&entry_point=home_settings');
                  } else {
                      router.push(buildStaticEntityRoute('/home-settings', selectedChar.id));
                    }
                  }}
                  style={{ 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', 
                    width: '36px', height: '36px', padding: 0,
                    backgroundColor: hasBg ? (isLightMode ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.15)') : 'white', 
                    color: hasBg ? (isLightMode ? 'var(--gray-600)' : 'white') : 'var(--gray-600)', 
                    border: hasBg ? (isLightMode ? '1px solid rgba(0,0,0,0.15)' : '1px solid rgba(255,255,255,0.2)') : '1px solid var(--border-color)', 
                    borderRadius: '50%', cursor: 'pointer',
                    backdropFilter: hasBg ? 'blur(10px)' : 'none', 
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                    transition: 'all 0.2s'
                  }}
                  title="홈화면 설정"
                >
                  <Settings size={20} />
                </button>
              </div>
              <span style={{ fontSize: '1rem', fontWeight: 'normal', color: hasBg ? (isLightMode ? 'var(--gray-600)' : 'rgba(255,255,255,0.8)') : 'var(--text-muted)', textShadow: hasBg ? (isLightMode ? 'none' : '0 1px 4px rgba(0,0,0,0.5)') : 'none' }}>
                {new Date(selectedChar?.dDayStartDate || selectedChar?.createdAt || Date.now()).toLocaleDateString(getDateLocale(locale), { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\.\s/g, '.').replace(/\.$/, '')}
              </span>
            </div>
            
            <h2 style={{ fontSize: '3rem', fontWeight: '600', color: textColor, textShadow, letterSpacing: '-1px', lineHeight: 1, textAlign: 'right' }}>
              {Math.abs(dDay)}{t('common.daysUnit')}
            </h2>
          </div>
          
          <div className="home-bottom-cards" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '14px', flexShrink: 0 }}>
            {(latestChat || isInitialPingTyping) && (
              <div 
                onClick={() => {
                  if (selectedChar?.id === 'dummy') {
                    trackEvent('locked_feature_tapped', { feature_name: 'chat', screen: 'home' });
                    router.push('/guide/chat');
                  } else {
                    router.push(buildStaticEntityRoute('/chat', selectedCharId!));
                  }
                }}
                style={{ 
                  order: selectedCharId === 'dummy' ? 2 : 1,
                  padding: '12px', 
                  borderRadius: '15px', 
                  backgroundColor: selectedCharId === 'dummy' ? '#F5F0FF' : (hasBg ? (isLightMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.15)') : 'white'), 
                  border: selectedCharId === 'dummy' ? '1px solid #D8C4FF' : (hasBg ? (isLightMode ? '1px solid rgba(0, 0, 0, 0.1)' : '1px solid rgba(255, 255, 255, 0.5)') : '1px solid var(--border-color)'), 
                  boxShadow: hasBg ? '0 4px 15px rgba(0,0,0,0.1)' : '0 4px 10px rgba(0,0,0,0.02)',
                  backdropFilter: hasBg ? 'blur(10px)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}
              >
                <div style={{ width: '42px', height: '42px', borderRadius: '50%', overflow: 'hidden', backgroundColor: selectedCharId === 'dummy' ? 'white' : 'var(--gray-200)', flexShrink: 0, position: 'relative' }}>
                  {isInitialPingTyping || latestChat?.role === 'assistant' ? (
                    selectedChar?.image ? (
                      <Image src={selectedChar.image} alt={selectedChar.name} fill style={{ objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={20} color={selectedCharId === 'dummy' ? 'var(--gray-400)' : 'var(--gray-500)'} /></div>
                    )
                  ) : (
                    userProfiles[selectedCharId || '']?.image ? (
                      <Image src={userProfiles[selectedCharId || '']!.image!} alt="User" fill style={{ objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={20} color="var(--gray-500)" /></div>
                    )
                  )}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <p style={{ color: hasBg ? (isLightMode ? 'var(--gray-900)' : 'white') : 'var(--foreground)', fontSize: '0.9rem', fontWeight: 'bold' }}>
                        {isInitialPingTyping || latestChat?.role === 'assistant' ? selectedChar?.name : (userProfiles[selectedCharId || '']?.name || '나')}
                      </p>
                      {(isInitialPingTyping || (typeof window !== 'undefined' && latestChat?.role === 'assistant' && latestChat.id !== localStorage.getItem('chat_read_' + selectedCharId))) && (
                        <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#FF3B30', color: 'white', fontSize: '0.6rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          N
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: selectedCharId === 'dummy' ? 'var(--gray-600)' : (hasBg ? (isLightMode ? 'var(--gray-600)' : 'rgba(255,255,255,0.7)') : 'var(--gray-400)') }}>
                      {isInitialPingTyping ? (locale === 'ja' ? '作成中' : '작성 중') : new Date((latestChat as any).createdAt || (latestChat as any).timestamp || Date.now()).toLocaleTimeString(getDateLocale(locale), { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                  </div>
                  {isInitialPingTyping ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', height: '18px' }}>
                      <span className="typing-dot" style={{ animationDelay: '0s' }} />
                      <span className="typing-dot" style={{ animationDelay: '0.2s' }} />
                      <span className="typing-dot" style={{ animationDelay: '0.4s' }} />
                    </div>
                  ) : (
                    <p style={{ color: hasBg ? (isLightMode ? 'var(--gray-800)' : 'rgba(255,255,255,0.9)') : 'var(--gray-600)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {(latestChat?.content || '').split('\n')[0]}
                    </p>
                  )}
                </div>
              </div>
            )}

            {selectedCharId && unwrittenChars.has(selectedCharId) && todayTopic ? (
              <div 
                onClick={() => {
                  if (selectedCharId === 'dummy') {
                    trackEvent('locked_feature_tapped', { feature_name: 'diary', screen: 'home' });
                    router.push('/diary?charId=dummy');
                  } else {
                    router.push('/diary?charId=' + selectedCharId);
                  }
                }}
                style={{ 
                  order: selectedCharId === 'dummy' ? 1 : 2,
                  padding: '14px', 
                  borderRadius: '15px', 
                  backgroundColor: selectedCharId === 'dummy' ? '#F5F0FF' : (hasBg ? (isLightMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.15)') : 'white'), 
                  border: selectedCharId === 'dummy' ? '1px solid #D8C4FF' : (hasBg ? (isLightMode ? '1px solid rgba(0, 0, 0, 0.1)' : '1px solid rgba(255, 255, 255, 0.5)') : '1px solid var(--border-color)'), 
                  boxShadow: hasBg ? '0 4px 15px rgba(0,0,0,0.1)' : '0 4px 10px rgba(0,0,0,0.02)',
                  backdropFilter: hasBg ? 'blur(10px)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ flex: 1, paddingRight: '10px' }}>
                  <p style={{ color: hasBg ? (isLightMode ? '#000000' : 'rgba(255,255,255,0.9)') : 'var(--point-color)', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px' }}>
                    {todayTopic.order}{t('common.nthQuestion')}
                  </p>
                  <h3 style={{ fontSize: '1.2rem', lineHeight: '1.4', color: hasBg ? (isLightMode ? 'var(--gray-700)' : 'white') : 'var(--foreground)' }}>
                    {formattedContent}
                  </h3>
                </div>
                <ChevronRight size={24} color={hasBg ? (isLightMode ? 'var(--gray-600)' : 'rgba(255,255,255,0.8)') : 'var(--gray-400)'} />
              </div>
            ) : null}
          </div>
        </main>
      </div>

    </div>
    </ErrorBoundary>
  );
}
