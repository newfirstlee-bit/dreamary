"use client";

import React, { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { getUserId } from '@/lib/auth';
import { useAuth } from '@/components/AuthContext';
import { useLocale } from '@/lib/i18n';
import { getCharactersByUser, Character, updateCharacter, getDiariesByUserAndChar, getTopics, Topic, getUserProfile, UserProfile, getChatMessages, ChatMessage } from '@/lib/db';
import { uploadImageToImgbb } from '@/lib/imgbb';
import { Loader2, User, Settings, Camera, Image as ImageIcon, ChevronRight } from 'lucide-react';
import { trackEvent } from '@/lib/mixpanel';
import EmptyCharacterModal from '@/components/EmptyCharacterModal';


class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }
  static getDerivedStateFromError(error) {
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
  const { loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [unwrittenChars, setUnwrittenChars] = useState<Set<string>>(new Set());
  const [charTopics, setCharTopics] = useState<Record<string, Topic | null>>({});
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile | null>>({});
  const [latestChat, setLatestChat] = useState<ChatMessage | null>(null);
  const [showEmptyModal, setShowEmptyModal] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    trackEvent('Home_Viewed');
    
    const init = async () => {
      try {
        let userId = getUserId();
        
        // 데모 링크 처리 (?demo=true)
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('demo') === 'true') {
          userId = '4b0b39a0-d691-4f5d-b562-0fc49a02e790'; // 유저님이 직접 제공해주신 완성된 UUID
          localStorage.setItem('dreamary_user_id', userId);
          // 쿠키도 함께 업데이트해줍니다
          document.cookie = "dreamary_user_id=" + userId + "; path=/; max-age=31536000";
        }

        const chars = await getCharactersByUser(userId);
        
        if (chars.length === 0) {
          if (localStorage.getItem('has_seen_onboarding') !== 'true') {
            router.replace('/onboarding');
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
            
            let topics: Topic[] = [];
            try {
              topics = await getTopics();
            } catch (err) {
              console.error("Failed to fetch topics for dummy:", err);
            }
            if (topics.length > 0) {
              setCharTopics({ dummy: topics[0] });
            } else {
              setCharTopics({ dummy: { id: 'dummy', order: 1, content: t('dummy.firstTopic') || '오늘 하루는 어땠어?' } as Topic });
            }
            
            setLoading(false);
          }
        } else {
          setCharacters(chars);
          
          const recentHistory: string[] = JSON.parse(localStorage.getItem(`recentChars_${userId}`) || '[]');
          let initialCharId = chars[0].id;
          
          if (recentHistory.length > 0) {
            const lastId = recentHistory[0];
            if (chars.some(c => c.id === lastId)) {
              initialCharId = lastId;
            }
          }
          setSelectedCharId(initialCharId);

          const now = new Date();
          const dateString = now.toISOString().split('T')[0];
          const unwritten = new Set<string>();
          const topics = await getTopics();
          const newCharTopics: Record<string, Topic | null> = {};
          const newUserProfiles: Record<string, UserProfile | null> = {};

          const [diariesArrays, profilesArrays] = await Promise.all([
            Promise.all(chars.map(c => getDiariesByUserAndChar(userId, c.id))),
            Promise.all(chars.map(c => getUserProfile(userId, c.id)))
          ]);
          for (let i = 0; i < chars.length; i++) {
            const char = chars[i];
            const diaries = diariesArrays[i];
            const todayD = diaries.find(d => d.dateString === dateString);
            if (!todayD) unwritten.add(char.id);

            newUserProfiles[char.id] = profilesArrays[i];

            if (topics.length > 0) {
              if (todayD) {
                const matchedTopic = topics.find(t => t.id === todayD.topicId);
                newCharTopics[char.id] = matchedTopic || topics[0];
              } else {
                const nextIdx = diaries.length % topics.length;
                newCharTopics[char.id] = topics[nextIdx] || topics[0];
              }
            }
          }
          setUnwrittenChars(unwritten);
          setCharTopics(newCharTopics);
          setUserProfiles(newUserProfiles);

          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load user data:", err);
        setLoading(false);
      }
    };
    
    init();
  }, [router, authLoading]);

  
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
          const msgs = await getChatMessages(getUserId(), selectedCharId);
          if (msgs.length > 0) {
            setLatestChat(msgs[msgs.length - 1]);
          } else {
            setLatestChat(null);
            if (!localStorage.getItem(`hasPinged_${selectedCharId}`)) {
              localStorage.setItem(`hasPinged_${selectedCharId}`, 'true');
              
              const char = characters.find(c => c.id === selectedCharId);
              const profile = userProfiles[selectedCharId] || null;
              
              if (char) {
                const res = await fetch('/api/chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    character: char,
                    userProfile: profile,
                    messages: [],
                    isFirstPing: true,
                    userId: getUserId()
                  })
                });
                const data = await res.json();
                if (res.ok && data.reply) {
                  const newMsg = {
                    id: data.savedId || Date.now().toString(),
                    userId: getUserId(),
                    characterId: selectedCharId,
                    role: 'assistant',
                    content: data.reply,
                    createdAt: Date.now()
                  };
                  setLatestChat(newMsg as ChatMessage);
                }
              }
            }
          }
        } catch (e) {
          console.error("Failed to fetch latest chat", e);
        }
      };
      fetchLatestChat();
    }
  }, [selectedCharId]);

  const selectedChar = characters.find(c => c.id === selectedCharId) || characters[0];

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
      const todayTopic = charTopics[selectedCharId] || null;
  const userProfile = selectedCharId ? userProfiles[selectedCharId] : null;

  let formattedContent = (locale === 'ja' && todayTopic?.contentJa) ? todayTopic.contentJa : (todayTopic?.content || '');
  if (formattedContent && selectedChar) {
    formattedContent = formattedContent
      .replace(/{유저}/g, userProfile?.name || (locale === 'ja' ? t('common.user') : '유저'))
      .replace(/{캐릭터}/g, selectedChar.name);
  }

  return (
    <ErrorBoundary>
    <div 
      className={`app-container ${!hasBg ? 'diary-bg' : ''}`}
      style={{ 
        paddingBottom: '65px',
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

      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Character Selector (Horizontal Scroll) */}
        <div style={{ display: 'flex', gap: '15px', overflowX: 'auto', padding: '25px', scrollbarWidth: 'none' }}>
            {[...characters].sort((a, b) => {
              const userId = getUserId();
              const history: string[] = JSON.parse(localStorage.getItem(`recentChars_${userId}`) || '[]');
              
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
                    const userId = getUserId();
                    const history: string[] = JSON.parse(localStorage.getItem(`recentChars_${userId}`) || '[]');
                    const newHistory = [char.id, ...history.filter(id => id !== char.id)];
                    localStorage.setItem(`recentChars_${userId}`, JSON.stringify(newHistory));
                  }}
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
                  <div style={{ 
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
        <main className="content" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 25px 25px 25px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 'bold', color: textColor, textShadow }}>
                  {selectedChar?.pairName || selectedChar?.name}
                </span>
                <button 
                  onClick={() => {
                    if (selectedChar?.id === 'dummy') {
                      setShowEmptyModal(true);
                    } else {
                      router.push(`/home-settings/${selectedChar.id}`);
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
                {new Date(selectedChar?.dDayStartDate || selectedChar?.createdAt || Date.now()).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\.\s/g, '.').replace(/\.$/, '')}
              </span>
            </div>
            
            <h2 style={{ fontSize: '3rem', fontWeight: '600', color: textColor, textShadow, letterSpacing: '-1px', lineHeight: 1, textAlign: 'right' }}>
              {Math.abs(dDay)}{t('common.daysUnit')}
            </h2>
          </div>
          
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {latestChat && (
              <div 
                onClick={() => {
                  if (selectedChar?.id === 'dummy') {
                    setShowEmptyModal(true);
                  } else {
                    router.push('/chat/' + selectedCharId);
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
                  {latestChat.role === 'assistant' ? (
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
                        {latestChat.role === 'assistant' ? selectedChar?.name : (userProfiles[selectedCharId || '']?.name || '나')}
                      </p>
                      {(typeof window !== 'undefined' && ((latestChat.role === 'assistant' && latestChat.id !== localStorage.getItem('chat_read_' + selectedCharId)) || !latestChat)) && (
                        <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#FF3B30', color: 'white', fontSize: '0.6rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          N
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: selectedCharId === 'dummy' ? 'var(--gray-600)' : (hasBg ? (isLightMode ? 'var(--gray-600)' : 'rgba(255,255,255,0.7)') : 'var(--gray-400)') }}>
                      {new Date((latestChat as any).createdAt || (latestChat as any).timestamp || Date.now()).toLocaleTimeString(locale === 'ja' ? 'ja-JP' : 'ko-KR', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <p style={{ color: hasBg ? (isLightMode ? 'var(--gray-800)' : 'rgba(255,255,255,0.9)') : 'var(--gray-600)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {(latestChat.content || '').split('\n')[0]}
                  </p>
                </div>
              </div>
            )}

            {selectedCharId && unwrittenChars.has(selectedCharId) && todayTopic ? (
              <div 
                onClick={() => router.push('/diary?charId=' + selectedCharId)}
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

      <EmptyCharacterModal isOpen={showEmptyModal} onClose={() => setShowEmptyModal(false)} />
    </div>
    </ErrorBoundary>
  );
}
