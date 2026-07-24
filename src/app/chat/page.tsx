"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useUserId } from '@/hooks/useUserId';
import { getCharactersByUser, Character, getChatMessages, ChatMessage } from '@/lib/db';
import { Loader2, User } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function ChatList() {
  const router = useRouter();
  const { t, locale } = useLocale();
  const [loading, setLoading] = useState(true);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [lastMessages, setLastMessages] = useState<Record<string, ChatMessage | null>>({});
  const userId = useUserId();

  useEffect(() => {
    if (!userId) return;

    const init = async () => {
      try {
        const chars = await getCharactersByUser(userId);
        
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
          setLastMessages({
            'dummy': {
              id: 'dummy_chat',
              userId: 'dummy',
              characterId: 'dummy',
              role: 'assistant',
              content: t('dummy.chatMsg') || '지금 바빠? 하고싶은 말이 있어.',
              createdAt: Date.now(),
              locale: 'ko'
            } as ChatMessage
          });
          setLoading(false);
          return;
        }

        const messagesObj: Record<string, ChatMessage | null> = {};
        await Promise.all(chars.map(async (char) => {
          const msgs = await getChatMessages(userId, char.id);
          messagesObj[char.id] = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        }));
        
        // Sort chars by recent (LRU) to match home tab
        const recentHistory: string[] = JSON.parse(localStorage.getItem(`recentChars_${userId}`) || '[]');
        chars.sort((a, b) => {
          const idxA = recentHistory.indexOf(a.id) === -1 ? 999 : recentHistory.indexOf(a.id);
          const idxB = recentHistory.indexOf(b.id) === -1 ? 999 : recentHistory.indexOf(b.id);
          return idxA - idxB;
        });

        setCharacters(chars);
        setLastMessages(messagesObj);
      } catch (error) {
        console.error('Failed to load characters:', error);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [userId, t]);

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Loader2 className="animate-spin" size={32} color="var(--point-color)" />
      </div>
    );
  }

  return (
    <div className="app-container diary-bg" style={{ paddingBottom: '65px' }}>
      <header className="header" style={{ borderBottom: '1px solid rgba(0,0,0,0.15)', position: 'relative', display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
        <span>{t('nav.chat')}</span>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {characters.map(char => {
          const lastMsg = lastMessages[char.id];
          const subtitle = lastMsg ? lastMsg.content : t('chat.newMessage');
          
          let showN = false;
          if (typeof window !== 'undefined') {
            const readId = localStorage.getItem(`chat_read_${char.id}`);
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id !== readId) {
              showN = true;
            } else if (!lastMsg) {
              showN = true; // For the initial 'message arrived' state
            }
          }
          
          let timeString = '';
          if (lastMsg) {
            const d = new Date(lastMsg.timestamp || lastMsg.createdAt);
            const today = new Date();
            if (d.toDateString() === today.toDateString()) {
              timeString = d.toLocaleTimeString(locale === 'ja' ? 'ja-JP' : 'ko-KR', { hour: 'numeric', minute: '2-digit' });
            } else {
              timeString = d.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'ko-KR', { month: 'long', day: 'numeric' });
            }
          }

          return (
            <div 
              key={char.id} 
              onClick={() => {
                if (char.id === 'dummy') {
                  router.push('/guide/chat');
                  return;
                }
                // Update recent history
                const history: string[] = JSON.parse(localStorage.getItem(`recentChars_${userId}`) || '[]');
                const newHistory = [char.id, ...history.filter(id => id !== char.id)];
                localStorage.setItem(`recentChars_${userId}`, JSON.stringify(newHistory));
                
                router.push(`/chat/${char.id}`);
              }}
              style={{ 
                backgroundColor: '#FAFAFA', 
                padding: '15px 20px', 
                borderBottom: '1px solid rgba(0,0,0,0.15)', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '15px',
                cursor: 'pointer',
                transition: 'background-color 0.1s'
              }}
              onMouseDown={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-50)'}
              onMouseUp={(e) => e.currentTarget.style.backgroundColor = '#FAFAFA'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#FAFAFA'}
            >
              {/* Pair Image (Only Character, 52.5px size) */}
              <div style={{ flexShrink: 0 }}>
                <div style={{ width: '53px', height: '53px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  {char.image ? <Image src={char.image} alt="char" fill style={{ objectFit: 'cover' }} /> : <User size={24} color="var(--gray-500)" />}
                </div>
              </div>
              
              {/* Character Name & Last Message */}
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--foreground)', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {char.name}
                </h3>
                <p style={{ fontSize: '0.9rem', color: 'var(--gray-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {subtitle}
                </p>
              </div>

              {/* Time & N Badge */}
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                {timeString && <span style={{ fontSize: '0.8rem', color: 'var(--gray-400)' }}>{timeString}</span>}
                {showN && (
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#FF3B30', color: 'white', fontSize: '0.7rem', fontWeight: 'bold', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    N
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
