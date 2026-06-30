"use client";

import { useEffect, useState, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { getUserId } from '@/lib/auth';
import { getCharactersByUser, getUserProfile, getTopics, getDiariesByUserAndChar, saveDiary, Character, UserProfile, Topic, Diary, unlockDiaryAd } from '@/lib/db';
import { Loader2, Send, ChevronDown, User, Lock } from 'lucide-react';
import Link from 'next/link';
import AdModal from '@/components/AdModal';
import { trackDiaryAndCheckAd } from '@/lib/adTracker';

function DiaryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [adModalOpen, setAdModalOpen] = useState(false);
  const [modalResolver, setModalResolver] = useState<(() => void) | null>(null);

  const confirmAd = () => {
    window.open('https://example.com/adsterra-smart-link', '_blank'); // TODO: Replace with real smartlink
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
    const userId = getUserId();
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
       setTodayDiary(todayD || null);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const userId = getUserId();
        const [chars, topics] = await Promise.all([
          getCharactersByUser(userId),
          getTopics()
        ]);

        if (chars.length === 0) {
          router.replace('/onboarding');
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

        for (const char of chars) {
          const diaries = await getDiariesByUserAndChar(userId, char.id);
          const hasToday = diaries.some(d => d.dateString === dateString);
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
          }
        }

        setLoading(false);
      } catch (err) {
        console.error("Failed to load diary data:", err);
        setLoading(false);
      }
    };
    init();
  }, [router]);

  const handleCharSelect = async (charId: string) => {
    setActiveCharId(charId);
    setUserEntry('');
    setTodayDiary(null);
    setLoading(true);

    try {
      const userId = getUserId();
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
      const userId = getUserId();
      const char = characters.find(c => c.id === activeCharId);
      const activeProfile = userProfiles[activeCharId];
      const dateString = new Date().toISOString().split('T')[0];
      
      const isAdTurn = trackDiaryAndCheckAd();
      
      let adWaitPromise = Promise.resolve();
      if (isAdTurn) {
        setAdModalOpen(true);
        adWaitPromise = new Promise((resolve) => {
          setModalResolver(() => resolve);
        });
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
          isAdTurn
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (isAdTurn) {
        await adWaitPromise;
        await unlockDiaryAd(data.savedId);
      }

      setUserEntry('');
      await loadInitialData();

    } catch (err) {
      console.error(err);
      alert('일기 전송 중 오류가 발생했습니다. ' + err);
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

  let formattedContent = todayTopic?.content || '';
  if (formattedContent && activeChar) {
    formattedContent = formattedContent
      .replace(/{유저}/g, userProfile?.name || '유저')
      .replace(/{캐릭터}/g, activeChar.name);
  }

  return (
    <div className="app-container diary-bg" style={{ paddingBottom: '65px' }}>
      <header className="header" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, position: 'relative', display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
        <span>교환일기</span>
      </header>

      {/* Character Selector (Horizontal Scroll) */}
      {characters.length > 0 && (
        <div style={{ display: 'flex', gap: '15px', overflowX: 'auto', padding: '15px 20px', scrollbarWidth: 'none', backgroundColor: '#F5F0FF' }}>
          {[...characters].sort((a, b) => {
            const userId = getUserId();
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
                  const userId = getUserId();
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
                {todayTopic.order}번째 질문
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
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginRight: '5px' }}>{userProfile?.name || '유저'}</span>
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
                        <span>답변 보기 (AD)</span>
                      </button>
                    </div>
                  ) : (
                    <>{todayDiary.charReply}</>
                  )}
                </div>
              </div>
            </div>
            
            <p style={{ fontSize: '0.75rem', color: 'var(--gray-600)', textAlign: 'center', marginTop: '20px' }}>
              캐붕이 생긴다면 <Link href={`/mypage/edit-character/${activeChar?.id}`} style={{ color: 'var(--point-color)', textDecoration: 'underline' }}>마이페이지</Link>에서 캐릭터 설정을 수정해주세요.
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
              일기 모아보기
            </button>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', marginBottom: '15px' }}>
              <textarea 
                value={userEntry}
                onChange={e => setUserEntry(e.target.value.slice(0, 500))}
                placeholder="여기에 일기를 작성해주세요..."
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
                  <Loader2 className="animate-spin" size={20} />
                  <span>{activeChar?.name}님이 일기를 쓰는 중...</span>
                </>
              ) : (
                <>
                  <Send size={20} />
                  <span>일기 보내기</span>
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
              일기 모아보기
            </button>
          </div>
        )}
        
      </main>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
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
