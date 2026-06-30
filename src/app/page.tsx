"use client";

import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { getUserId } from '@/lib/auth';
import { getCharactersByUser, Character, updateCharacter, getDiariesByUserAndChar, getTopics, Topic, getUserProfile, UserProfile } from '@/lib/db';
import { uploadImageToImgbb } from '@/lib/imgbb';
import { Loader2, User, Settings, Camera, Image as ImageIcon, ChevronRight } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [unwrittenChars, setUnwrittenChars] = useState<Set<string>>(new Set());
  const [charTopics, setCharTopics] = useState<Record<string, Topic | null>>({});
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile | null>>({});

  useEffect(() => {
    const init = async () => {
      try {
        const userId = getUserId();
        const chars = await getCharactersByUser(userId);
        
        if (chars.length === 0) {
          router.replace('/onboarding');
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

          for (const char of chars) {
            const diaries = await getDiariesByUserAndChar(userId, char.id);
            const todayD = diaries.find(d => d.dateString === dateString);
            if (!todayD) unwritten.add(char.id);

            const profile = await getUserProfile(userId, char.id);
            newUserProfiles[char.id] = profile;

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
  }, [router]);

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
  const textColor = hasBg ? 'white' : 'var(--gray-800)';
  const textShadow = hasBg ? '0 2px 10px rgba(0,0,0,0.5)' : 'none';
  const todayTopic = charTopics[selectedCharId] || null;
  const userProfile = selectedCharId ? userProfiles[selectedCharId] : null;

  let formattedContent = todayTopic?.content || '';
  if (formattedContent && selectedChar) {
    formattedContent = formattedContent
      .replace(/{유저}/g, userProfile?.name || '유저')
      .replace(/{캐릭터}/g, selectedChar.name);
  }

  return (
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
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.0) 30%, rgba(0,0,0,0.0) 70%, rgba(0,0,0,0.5) 100%)', 
          pointerEvents: 'none' 
        }} />
      )}

      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Character Selector (Horizontal Scroll) */}
        {characters.length > 0 && (
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
                    backgroundColor: hasBg ? 'rgba(255, 255, 255, 0.15)' : 'white',
                    backdropFilter: hasBg ? 'blur(10px)' : 'none',
                    padding: '12px',
                    borderRadius: '20px',
                    border: isSelected ? (hasBg ? '3px solid white' : '3px solid var(--point-color)') : '3px solid transparent',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
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
                    <span style={{ position: 'relative', fontSize: '0.9rem', fontWeight: 'bold', color: hasBg ? 'white' : 'var(--foreground)' }}>
                      {char.name.length > 5 ? char.name.slice(0, 5) + '...' : char.name}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* D-Day Display */}
        <div style={{ marginTop: '20px', padding: '0 25px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 'bold', color: textColor, textShadow }}>
                  {selectedChar?.name}
                </span>
                <button 
                  onClick={() => router.push(`/home-settings/${selectedChar.id}`)}
                  style={{ 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', 
                    width: '36px', height: '36px', padding: 0,
                    backgroundColor: hasBg ? 'rgba(255, 255, 255, 0.15)' : 'white', 
                    color: hasBg ? 'white' : 'var(--gray-600)', 
                    border: hasBg ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--border-color)', 
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
              <span style={{ fontSize: '1rem', fontWeight: 'normal', color: hasBg ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)', textShadow: hasBg ? '0 1px 4px rgba(0,0,0,0.5)' : 'none' }}>
                {new Date(selectedChar?.dDayStartDate || selectedChar?.createdAt || Date.now()).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\.\s/g, '.').replace(/\.$/, '')}
              </span>
            </div>
            
            <h2 style={{ fontSize: '3rem', fontWeight: '600', color: textColor, textShadow, letterSpacing: '-1px', lineHeight: 1, textAlign: 'right' }}>
              {Math.abs(dDay)}일
            </h2>
          </div>
        </div>
          
        <div style={{ padding: '0 25px 25px 25px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {selectedCharId && unwrittenChars.has(selectedCharId) && todayTopic && (
            <div 
              onClick={() => router.push('/diary?charId=' + selectedCharId)}
              style={{ 
                marginTop: 'auto', 
                marginBottom: '20px',
                padding: '20px', 
                borderRadius: '15px', 
                backgroundColor: hasBg ? 'rgba(255, 255, 255, 0.15)' : 'white', 
                border: hasBg ? '1px solid rgba(255, 255, 255, 0.5)' : '1px solid var(--border-color)', 
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
                <p style={{ color: hasBg ? 'rgba(255,255,255,0.9)' : 'var(--point-color)', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px' }}>
                  {todayTopic.order}번째 질문
                </p>
                <h3 style={{ fontSize: '1.2rem', lineHeight: '1.4', color: hasBg ? 'white' : 'var(--foreground)' }}>
                  {formattedContent}
                </h3>
              </div>
              <ChevronRight size={24} color={hasBg ? "rgba(255,255,255,0.8)" : "var(--gray-400)"} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
