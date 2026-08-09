"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useUserId } from '@/hooks/useUserId';
import { Character, getLatestChatMessage, ChatMessage } from '@/lib/db';
import { Loader2, User } from 'lucide-react';
import { useLocale, getDateLocale } from '@/lib/i18n';
import { trackEvent } from '@/lib/mixpanel';
import { withTimeout } from '@/lib/async';
import { readUserCache, writeUserCache } from '@/lib/appCache';
import { useAuth } from '@/components/AuthContext';
import { sortCharactersByRecent, touchRecentCharacter } from '@/lib/characterOrder';
import { getCharactersWithGuestRecovery } from '@/lib/ownership';
import { buildStaticEntityRoute } from '@/lib/navigation';
import { useAppStore } from '@/store/useAppStore';

interface ChatListCache {
  characters: Character[];
  lastMessages: Record<string, ChatMessage | null>;
}

export default function ChatList() {
  const router = useRouter();
  const { t, locale } = useLocale();
  const [loading, setLoading] = useState(true);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [lastMessages, setLastMessages] = useState<Record<string, ChatMessage | null>>({});
  const userId = useUserId();
  const { status } = useAuth();
  const { loadCharacters } = useAppStore();

  useEffect(() => {
    if (!userId) return;

    const cachedChat = readUserCache<ChatListCache>(userId, 'chat');
    if (cachedChat) {
      setCharacters(cachedChat.characters);
      setLastMessages(cachedChat.lastMessages);
      setLoading(false);
    }

    const showGuestChat = () => {
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
      const dummyMessages = {
        dummy: {
          id: 'dummy_chat',
          userId: 'dummy',
          characterId: 'dummy',
          role: 'assistant',
          content: t('dummy.chatMsg') || '지금 바빠? 하고싶은 말이 있어.',
          createdAt: Date.now(),
          locale: 'ko'
        } as ChatMessage
      };
      setLastMessages(dummyMessages);
      writeUserCache<ChatListCache>(userId, 'chat', {
        characters: [dummyChar],
        lastMessages: dummyMessages
      });
    };

    const init = async () => {
      try {
        const chars = sortCharactersByRecent(
          await withTimeout(loadCharacters(userId, status === 'authenticated')),
          userId
        );
        
        if (chars.length === 0) {
          if (status === 'guest') showGuestChat();
          else {
            setCharacters([]);
            setLastMessages({});
            writeUserCache<ChatListCache>(userId, 'chat', { characters: [], lastMessages: {} });
          }
          setLoading(false);
          return;
        }

        setCharacters(chars);
        setLoading(false);

        const messagesObj: Record<string, ChatMessage | null> = {};
        await withTimeout(Promise.all(chars.map(async (char) => {
          messagesObj[char.id] = await getLatestChatMessage(userId, char.id);
        })));

        const sortedChars = [...chars].sort((a, b) => {
          const msgA = messagesObj[a.id];
          const msgB = messagesObj[b.id];
          // Use message time if exists, otherwise 0
          const timeA = msgA ? new Date(msgA.timestamp || msgA.createdAt).getTime() : 0;
          const timeB = msgB ? new Date(msgB.timestamp || msgB.createdAt).getTime() : 0;
          
          if (timeA !== timeB && !isNaN(timeA) && !isNaN(timeB)) {
            return timeB - timeA;
          }
          // Secondary sort by character creation date if both have no messages or same time
          const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return createdB - createdA;
        });

        setCharacters(sortedChars);
        setLastMessages(messagesObj);
        writeUserCache<ChatListCache>(userId, 'chat', {
          characters: sortedChars,
          lastMessages: messagesObj
        });
      } catch (error) {
        console.error('Failed to load characters:', error);
        if (!cachedChat && status === 'guest') showGuestChat();
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [userId, t, status]);

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Loader2 className="animate-spin" size={32} color="var(--point-color)" />
      </div>
    );
  }

  return (
    <div className="app-container tab-page diary-bg status-surface-check">
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
              timeString = d.toLocaleTimeString(getDateLocale(locale), { hour: 'numeric', minute: '2-digit', hour12: true });
            } else {
              timeString = d.toLocaleDateString(getDateLocale(locale), { month: 'long', day: 'numeric' });
            }
          }

          return (
            <div 
              key={char.id} 
              onClick={() => {
                if (char.id === 'dummy') {
                  trackEvent('locked_feature_tapped', { feature_name: 'chat_list', screen: 'chat' });
                  router.push('/guide/chat');
                  return;
                }
                touchRecentCharacter(userId, char.id);
                
                router.push(buildStaticEntityRoute('/chat', char.id));
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
