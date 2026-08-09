"use client";
import { apiFetch, apiPostJson } from '@/lib/api';
import { showAd } from "@/lib/ads";

import { useEffect, useState, useRef, ReactNode, useCallback, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { useUserId } from '@/hooks/useUserId';
import { auth } from '@/lib/firebase';
import { getCharacterById, Character, getUserProfile, UserProfile, getChatMessages, subscribeChatMessages, ChatMessage, saveChatMessage, deleteChatMessages, unlockMessageAd, updateChatMessage, deleteMessage } from '@/lib/db';
import { Loader2, ChevronLeft, MoreVertical, Send, User, MoreHorizontal, Lock, Pencil, Trash2, Siren } from 'lucide-react';
import AdModal from '@/components/AdModal';
import ErrorModal from '@/components/ErrorModal';
import ReportModal, { ReportSubmitPayload } from '@/components/ReportModal';
import { trackEvent } from '@/lib/mixpanel';
import { recordSuccessfulChatTurn, shouldShowChatAd } from '@/lib/adTracker';
import { saveDraft, loadDraft, clearDraft } from '@/lib/draftStorage';
import { useLocale, getDateLocale } from '@/lib/i18n';
import { clearUserCache } from '@/lib/appCache';
import { buildStaticEntityRoute, resolveStaticEntityId } from '@/lib/navigation';
import { ensureInitialPing } from '@/lib/initialPing';
import { logAdDiagnostic } from '@/lib/adDiagnostics';

// polyfill for crypto.randomUUID() which fails on HTTP (non-HTTPS) mobile
const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

function ChatDetailContent({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useLocale();
  const [loading, setLoading] = useState(true);
  const [character, setCharacter] = useState<Character | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null);
  
  // Message Edit/Delete States
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deleteConfirmMessageId, setDeleteConfirmMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabled = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const isSendingRef = useRef(false);
  const draftLoaded = useRef(false);
  const userId = useUserId();
  // Static app builds use /chat/1 as a physical page and keep the real ID in
  // the query string. useSearchParams is reactive during soft navigation,
  // unlike reading window.location during render.
  const characterId = searchParams.get('entityId') || resolveStaticEntityId(params.id);

  const resizeChatInput = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    const style = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(style.lineHeight) || 22;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const maxHeight = Math.ceil(lineHeight * 6 + paddingTop + paddingBottom);
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  const handleEditSave = async (msgId: string) => {
    if (!editContent.trim()) return;
    try {
      await updateChatMessage(msgId, editContent);
      setEditingMessageId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmMessageId) return;
    try {
      await deleteMessage(deleteConfirmMessageId);
      setDeleteConfirmMessageId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleScroll = () => {
    if (!chatAreaRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatAreaRef.current;
    isAutoScrollEnabled.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  const [adModalOpen, setAdModalOpen] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [adFailureMessage, setAdFailureMessage] = useState('');
  const [modalResolver, setModalResolver] = useState<((didOpen: boolean) => void) | null>(null);

  const confirmAd = () => {
    showAd((result) => {
      setAdModalOpen(false);
      if (modalResolver) {
        if (!result.didOpen && result.message) {
          setAdFailureMessage(result.message);
        }
        modalResolver(result.didOpen);
        setModalResolver(null);
      }
    });
  };

  const closeAdModal = () => {
    setAdModalOpen(false);
    if (modalResolver) {
      modalResolver(false);
      setModalResolver(null);
    }
  };

  const submitChatReport = async ({ reasons, otherText }: ReportSubmitPayload) => {
    if (!reportTarget || !character || !userId) return;
    await apiPostJson('/api/reports/create', {
      userId,
      characterId: character.id,
      characterName: character.name,
      source: 'chat',
      targetId: reportTarget.id,
      content: reportTarget.content,
      reasons,
      otherText,
      locale,
    });
    alert(t('report.success'));
  };

  const loadMessages = async () => {
    if (!userId) return;
    const history = await getChatMessages(userId, characterId);
    setMessages(history);
  };

  useEffect(() => {
    if (!userId) return; // auth 초기화 전에는 실행하지 않음
    trackEvent('Chat_Opened', { character_id: characterId });
    
    const init = async () => {
      try {
        const char = await getCharacterById(characterId);
        if (!char) {
          router.replace('/chat');
          return;
        }
        setCharacter(char);

        const draft = loadDraft(char.id, 'chat');
        if (draft) {
          setInputMsg(draft);
          draftLoaded.current = true;
        }

        const profile = await getUserProfile(char.id);
        setUserProfile(profile);

        const history = await getChatMessages(userId, char.id);
        if (history.length === 0) {
          triggerInitialPing(char, profile);
        }

        const unsubscribe = subscribeChatMessages(userId!, char.id, (msgs) => {
          setMessages(msgs);
        });

        return () => unsubscribe();
      } catch (error) {
        console.error('Failed to load chat:', error);
      } finally {
        setLoading(false);
      }
    };
    
    let unsub: (() => void) | void;
    init().then(res => { unsub = res; });
    return () => {
      if (unsub) unsub();
    };
  }, [characterId, router, userId]);

  useEffect(() => {
    if (isAutoScrollEnabled.current && !editingMessageId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    if (messages.length > 0) {
      localStorage.setItem(`chat_read_${characterId}`, messages[messages.length - 1].id);
    }
  }, [messages, isTyping, streamingContent, characterId]);

  useEffect(() => {
    resizeChatInput(inputRef.current);
  }, [inputMsg, resizeChatInput]);

  useEffect(() => {
    if (!adFailureMessage) return;
    const timer = window.setTimeout(() => setAdFailureMessage(''), 3500);
    return () => window.clearTimeout(timer);
  }, [adFailureMessage]);

  useEffect(() => {
    const syncInputAreaHeight = () => {
      const height = inputAreaRef.current?.offsetHeight || 72;
      document.documentElement.style.setProperty('--chat-input-area-height', `${Math.round(height)}px`);
    };

    syncInputAreaHeight();
    const observer = typeof ResizeObserver !== 'undefined' && inputAreaRef.current
      ? new ResizeObserver(syncInputAreaHeight)
      : null;
    if (observer && inputAreaRef.current) observer.observe(inputAreaRef.current);
    window.addEventListener('resize', syncInputAreaHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncInputAreaHeight);
      document.documentElement.style.removeProperty('--chat-input-area-height');
    };
  }, []);

  // Auto-expand edit textarea only when first opening (not on every keystroke)
  useEffect(() => {
    if (editingMessageId) {
      // Lock scroll position to prevent Android from scrolling on cursor move
      const scrollPos = chatAreaRef.current?.scrollTop ?? 0;
      setTimeout(() => {
        const ta = document.getElementById('edit-textarea') as HTMLTextAreaElement;
        if (ta) {
          ta.style.height = 'auto';
          ta.style.height = ta.scrollHeight + 'px';
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
        // Restore scroll after focus (Android may have scrolled)
        if (chatAreaRef.current) {
          chatAreaRef.current.scrollTop = scrollPos;
        }
      }, 50);
    }
  }, [editingMessageId]); // only on open, NOT on editContent change

  const triggerInitialPing = async (char: Character, profile: UserProfile | null) => {
    if (!userId) return;
    setIsTyping(true);
    try {
      await ensureInitialPing({ character: char, userProfile: profile, userId });
      clearUserCache(userId, ['chat', 'home']);
    } catch (error) {
      console.error('Initial ping failed:', error);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSend = async () => {
    if (!inputMsg.trim() || !character || isSendingRef.current) return;
    isSendingRef.current = true;
    const userText = inputMsg.trim();
    const requestId = generateId();

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      userId: userId!,
      characterId: character.id,
      role: 'user',
      content: userText,
      createdAt: Date.now()
    };

    // Note: Since we have subscribeChatMessages, it will automatically update 'messages' state.
    // But for instant UI feedback we can also append locally.
    setMessages(prev => {
      if (!prev.find(m => m.id === userMsg.id)) {
        return [...prev, userMsg];
      }
      return prev;
    });
    
    setInputMsg("");
    trackEvent('Chat_Message_Sent', {
      character_id: character.id,
      message_length: userText.length
    });
    
    if (!localStorage.getItem('core_interaction_tracked')) {
      trackEvent('Core_interaction', { type: 'chat' });
      localStorage.setItem('core_interaction_tracked', 'true');
    }
    
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.blur();
    }

    setIsTyping(true);
    isAutoScrollEnabled.current = true;
    let success = false;
    let savedId = '';
    let attemptedAdTurn = false;
    let userMessagePersisted = false;
    try {
      // Save before calling AI so the server can build context, but remove it again if sending fails.
      await saveChatMessage(userMsg);
      userMessagePersisted = true;
      if (userId) clearUserCache(userId, ['chat', 'home']);

      const isAdTurn = shouldShowChatAd();
      const isNativeChat = Capacitor.isNativePlatform();
      attemptedAdTurn = isAdTurn;
      
      let adWaitPromise = Promise.resolve(true);
      if (isAdTurn) {
        setAdModalOpen(true);
        adWaitPromise = new Promise<boolean>((resolve) => {
          setModalResolver(() => (didOpen: boolean) => resolve(didOpen));
        });
        const adOpened = await adWaitPromise;
        if (!adOpened) {
          logAdDiagnostic('chat', 'ad_open_failed', { characterId: character.id, requestId });
          throw new Error('AD_OPEN_FAILED');
        }
        logAdDiagnostic('chat', 'ad_completed', { characterId: character.id, requestId });
      }

      // Get recent 10 messages for context
      const contextMessages = [...messages, userMsg].slice(-10);

      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character,
          userProfile,
          messages: contextMessages,
          isFirstPing: false,
          userId: userId,
          isAdTurn: false,
          requestId
        })
      });

      if (!res.ok) {
        throw new Error('Failed to fetch from API');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming not supported');

      savedId = res.headers.get('X-Message-Id') || '';
      if (savedId) {
        setStreamingMessageId(savedId);
      }

      const decoder = new TextDecoder('utf-8');
      let done = false;
      let assistantReply = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const pieces = chunk.match(/.{1,3}/g) || [];

          for (const piece of pieces) {
            assistantReply += piece;
            setStreamingContent(assistantReply);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
      }

      setStreamingContent('');
      setStreamingMessageId(null);
      success = true;
      
      if (success) {
        recordSuccessfulChatTurn();
        clearDraft(character.id, 'chat');

        trackEvent('Chat_Response_Received', {
          character_id: character.id,
        });
        // loadMessages() is no longer needed due to subscription
      } else {
        throw new Error('Streaming failed');
      }
    } catch (error) {
      console.error('Send failed:', error);
      closeAdModal();
      setStreamingMessageId(null);
      
      setMessages(prev => prev.filter(m => m.id !== userMsg.id));
      if (userMessagePersisted) {
        deleteMessage(userMsg.id).catch(deleteError => {
          console.warn('Failed to remove unsent chat message:', deleteError);
        });
      }
      setInputMsg(userText);
      saveDraft(character.id, userText, 'chat');
      if ((error as Error)?.message !== 'AD_OPEN_FAILED') {
        if (attemptedAdTurn) {
          logAdDiagnostic('chat', 'app_server_request_failed', { characterId: character.id, requestId }, error);
        }
        setErrorModalOpen(true);
      }
    } finally {
      setIsTyping(false);
      isSendingRef.current = false;
    }
  };

  const handleDeleteChat = async () => {
    try {
      if (!userId) return;
      await deleteChatMessages(userId, characterId);
      setMessages([]);
      setShowSettings(false);
      setShowDeleteConfirm(false);
      if (character) triggerInitialPing(character, userProfile);
    } catch (error) {
      alert(t('chat.deleteFailed'));
    }
  };

  const insertActionBracket = () => {
    if (!inputRef.current) return;
    const start = inputRef.current.selectionStart || 0;
    const end = inputRef.current.selectionEnd || 0;
    
    const newText = inputMsg.substring(0, start) + "()" + inputMsg.substring(end);
    setInputMsg(newText);
    
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(start + 1, start + 1);
      }
    }, 0);
  };

  const formatActionText = (text: string) => {
    let inner = text.trim();
    if (inner.startsWith('(') && inner.endsWith(')')) {
      inner = inner.slice(1, -1).trim();
    }
    const sentences = inner.match(/[^.!?]+[.!?]*/g) || [inner];
    let result = '';
    for (let i = 0; i < sentences.length; i++) {
      result += sentences[i].trim() + ' ';
      if ((i + 1) % 6 === 0 && i !== sentences.length - 1) {
        result += '\n\n';
      }
    }
    return result.trim() || inner;
  };

  const renderMessageContent = (content: string, isUser: boolean) => {
    let text = content;
    // Fix missing opening parenthesis
    const firstClose = text.indexOf(')');
    const firstOpen = text.indexOf('(');
    if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
      text = '(' + text;
    }
    // Fix missing closing parenthesis
    const lastOpen = text.lastIndexOf('(');
    const lastClose = text.lastIndexOf(')');
    if (lastOpen !== -1 && (lastClose === -1 || lastOpen > lastClose)) {
      text = text + ')';
    }

    const parts = text.split(/(\([^)]+\))/g);
    
    return parts.map((part, i) => {
      const trimmed = part.trim();
      if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        const formattedAction = formatActionText(trimmed);
        return (
          <span key={i} style={{ 
            display: 'block',
            fontStyle: 'italic', 
            color: 'var(--gray-600)', 
            margin: '8px 0',
            fontSize: '0.9rem',
            textAlign: isUser ? 'right' : 'left',
            whiteSpace: 'pre-wrap'
          }}>
            {formattedAction}
          </span>
        );
      } else if (trimmed !== '') {
        return (
          <div key={i} style={{
            display: 'inline-block',
            padding: '10px 15px',
            borderRadius: isUser ? '18px 0px 18px 18px' : '0px 18px 18px 18px',
            backgroundColor: isUser ? 'var(--point-color)' : 'white',
            color: isUser ? 'white' : 'var(--foreground)',
            border: isUser ? 'none' : '1px solid var(--border-color)',
            margin: '4px 0',
            maxWidth: '100%',
            lineHeight: 1.5,
            wordBreak: 'break-word',
            textAlign: 'left'
          }}>
            {trimmed.split('\n').map((line, j) => (
              <span key={j}>{line}<br/></span>
            ))}
          </div>
        );
      }
      return null;
    });
  };

  if (loading || !character) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Loader2 className="animate-spin" size={32} color="var(--point-color)" />
      </div>
    );
  }

  return (
    <div className="app-container full-page chat-detail-page status-surface-solid" style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--gray-50)', overflow: 'hidden', position: 'relative' }}>
      {deleteConfirmMessageId && (
        <>
          <div 
            onClick={() => setDeleteConfirmMessageId(null)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3000 }} 
          />
          <div style={{ 
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '90%', maxWidth: '340px', 
            backgroundColor: 'white', borderRadius: '20px', padding: '30px 20px 20px', zIndex: 3001,
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '25px' }}>
              {locale === 'ja' ? 'このメッセージを削除しますか？' : '대화를 삭제할까요?'}
            </h2>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button 
                onClick={handleDeleteConfirm}
                style={{ flex: 1, padding: '15px', backgroundColor: '#FFF0F0', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', color: 'red', cursor: 'pointer' }}
              >
                {locale === 'ja' ? '削除' : '삭제'}
              </button>
              <button 
                onClick={() => setDeleteConfirmMessageId(null)}
                style={{ flex: 1, padding: '15px', backgroundColor: 'var(--gray-200)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', color: 'var(--gray-800)', cursor: 'pointer' }}
              >
                {locale === 'ja' ? 'キャンセル' : '취소하기'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Ad Modal */}
      <header className="header" style={{ 
        backgroundColor: 'white', 
        borderBottom: '1px solid var(--border-color)', 
        position: 'relative', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        padding: '15px',
        zIndex: 100,
        flexShrink: 0
      }}>
        <button onClick={() => router.push('/chat')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--foreground)' }}>
          <ChevronLeft size={24} color="var(--gray-800)" />
        </button>
        <span style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{character.name}</span>
        <button onClick={() => setShowSettings(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--foreground)' }}>
          <MoreVertical size={24} />
        </button>
      </header>

      {/* Chat Area */}
      <div 
        ref={chatAreaRef} 
        className="chat-scroll-area"
        onScroll={handleScroll} 
        style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px', overscrollBehavior: 'none' }}
      >
        {messages.filter(msg => msg.id !== streamingMessageId).map((msg, idx, filteredMessages) => {
          const isUser = msg.role === 'user';
          const showProfile = !isUser && (idx === 0 || filteredMessages[idx - 1].role === 'user');
          const showTime = idx === filteredMessages.length - 1 || filteredMessages[idx + 1].role !== msg.role;
          const timeString = new Date(msg.createdAt).toLocaleTimeString(getDateLocale(locale), { hour: 'numeric', minute: '2-digit', hour12: true });

          if (msg.role === 'assistant') {
            return (
              <div key={msg.id} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-start', flexDirection: editingMessageId === msg.id ? 'column' : 'row', width: '100%' }}>
                {editingMessageId !== msg.id && showProfile && character?.image && (
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                    <Image src={character.image} alt={character.name} fill style={{ objectFit: 'cover' }} />
                  </div>
                )}
                {editingMessageId !== msg.id && !showProfile && character?.image && (
                  <div style={{ width: '32px', flexShrink: 0 }} />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: editingMessageId === msg.id ? '100%' : '75%', flex: 1, width: '100%' }}>
                  {editingMessageId !== msg.id && showProfile && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '4px', marginLeft: '4px' }}>
                      {character?.name}
                    </span>
                  )}
                  {editingMessageId === msg.id && showProfile && character?.image && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                        <Image src={character.image} alt={character.name} fill style={{ objectFit: 'cover' }} />
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                        {character?.name}
                      </span>
                    </div>
                  )}
                  
                  {editingMessageId === msg.id ? (
                    <div style={{ width: '100%', minWidth: '260px', backgroundColor: 'white', padding: '15px', borderRadius: '15px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: 'var(--point-color)' }}>
                        <Pencil size={16} /> <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{locale === 'ja' ? 'メッセージを編集中' : '메시지 수정 중'}</span>
                      </div>
                      <textarea 
                        id="edit-textarea"
                        value={editContent}
                        onChange={e => {
                          setEditContent(e.target.value.slice(0, 4000));
                          e.target.style.height = 'auto';
                          e.target.style.height = e.target.scrollHeight + 'px';
                        }}
                        style={{ width: '100%', minHeight: '120px', backgroundColor: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '10px', color: 'var(--foreground)', fontSize: '0.95rem', resize: 'none', outline: 'none', overflow: 'auto', boxSizing: 'border-box', lineHeight: '1.5' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '5px' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>{editContent.length}/4000</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '15px' }}>
                        <button 
                          onMouseDown={(e) => e.preventDefault()}
                          onTouchStart={(e) => e.preventDefault()}
                          onClick={() => setEditingMessageId(null)} 
                          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--gray-100)', color: 'var(--gray-800)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold' }}
                        >
                          {locale === 'ja' ? 'キャンセル' : '취소'}
                        </button>
                        <button 
                          onMouseDown={(e) => e.preventDefault()}
                          onTouchStart={(e) => e.preventDefault()}
                          onClick={() => handleEditSave(msg.id)} 
                          style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}
                        >
                          {locale === 'ja' ? '修正完了' : '수정 완료'}
                        </button>
                      </div>
                    </div>
                  ) : msg.isAdLocked ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '15px 20px', backgroundColor: 'white', borderRadius: '16px', borderTopLeftRadius: '4px', border: '1px solid var(--border-color)' }}>
                      <div style={{ filter: 'blur(5px)', opacity: 0.5, userSelect: 'none', fontSize: '0.9rem', lineHeight: '1.4' }}>
                        (부드럽게 미소지으며 네 머리카락을 넘겨준다. 심장이 요동친다.) 정말 보고 싶었어. 오늘 하루 어땠어?
                      </div>
                      <button 
                        onClick={async () => {
                          showAd(async (result) => {
                            if (!result.didOpen) {
                              if (result.message) setAdFailureMessage(result.message);
                              logAdDiagnostic('chat', 'ad_open_failed', { characterId: character.id, messageId: msg.id, action: 'unlock_existing_message' });
                              return;
                            }
                            try {
                              await unlockMessageAd(msg.id);
                              logAdDiagnostic('chat', 'ad_completed', { characterId: character.id, messageId: msg.id, action: 'unlock_existing_message' });
                            } catch (e) {
                              logAdDiagnostic('chat', 'ad_unlock_failed', { characterId: character.id, messageId: msg.id, action: 'unlock_existing_message' }, e);
                            }
                            loadMessages();
                          });
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '6px',
                          padding: '8px 16px', backgroundColor: 'var(--point-color)', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', zIndex: 10, marginTop: '-20px'
                        }}
                      >
                        <Lock size={14} />
                        <span style={{ fontSize: '0.85rem' }}>{t('chat.viewReply')}</span>
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
                      {renderMessageContent(msg.content, false)}
                    </div>
                  )}
                  
                  {editingMessageId !== msg.id && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%', gap: '8px', marginTop: '4px' }}>
                      {!msg.isAdLocked && (
                        <button
                          onClick={() => setReportTarget(msg)}
                          aria-label={t('report.button')}
                          title={t('report.button')}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'var(--gray-500)' }}
                        >
                          <Siren size={13} />
                        </button>
                      )}
                      <button onClick={() => { setEditingMessageId(msg.id); setEditContent(msg.content); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'var(--gray-500)' }}>
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => setDeleteConfirmMessageId(msg.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'var(--gray-500)' }}>
                        <Trash2 size={12} />
                      </button>
                      <span style={{ fontSize: '0.65rem', color: 'var(--gray-500)' }}>
                        {showTime ? timeString : ''}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          }
          
          return (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'row-reverse', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', maxWidth: editingMessageId === msg.id ? '100%' : '75%', alignItems: 'flex-end', width: '100%', flex: 1 }}>
                {editingMessageId === msg.id ? (
                  <div style={{ width: '100%', minWidth: '260px', backgroundColor: 'white', padding: '15px', borderRadius: '15px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: 'var(--point-color)' }}>
                      <Pencil size={16} /> <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{locale === 'ja' ? 'メッセージを編集中' : '메시지 수정 중'}</span>
                    </div>
                    <textarea 
                      id="edit-textarea"
                      value={editContent}
                      onChange={e => {
                        setEditContent(e.target.value.slice(0, 4000));
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      style={{ width: '100%', minHeight: '120px', backgroundColor: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '10px', color: 'var(--foreground)', fontSize: '0.95rem', resize: 'none', outline: 'none', overflow: 'auto', boxSizing: 'border-box', lineHeight: '1.5' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '5px' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>{editContent.length}/4000</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '15px' }}>
                      <button 
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => e.preventDefault()}
                        onClick={() => setEditingMessageId(null)} 
                        style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--gray-100)', color: 'var(--gray-800)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold' }}
                      >
                        {locale === 'ja' ? 'キャンセル' : '취소'}
                      </button>
                      <button 
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => e.preventDefault()}
                        onClick={() => handleEditSave(msg.id)} 
                        style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}
                      >
                        {locale === 'ja' ? '修正完了' : '수정 완료'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {renderMessageContent(msg.content, true)}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%', gap: '8px', marginTop: '4px' }}>
                      <button onClick={() => setDeleteConfirmMessageId(msg.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'var(--gray-500)' }}>
                        <Trash2 size={12} />
                      </button>
                      <span style={{ fontSize: '0.65rem', color: 'var(--gray-500)' }}>
                        {timeString}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
        
        {streamingContent && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-start' }}>
            {character?.image && (
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                <Image src={character.image} alt={character.name} fill style={{ objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: '75%' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '4px', marginLeft: '4px' }}>
                {character?.name}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
                {renderMessageContent(streamingContent, false)}
              </div>
            </div>
          </div>
        )}

        {isTyping && !streamingContent && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', alignItems: 'flex-end', marginBottom: '20px' }}>
            {character?.image && (
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                <Image src={character.image} alt="char" fill style={{ objectFit: 'cover' }} />
              </div>
            )}
            <div className="chat-bubble char" style={{ padding: '15px 18px', display: 'flex', alignItems: 'center', gap: '6px', height: '44px' }}>
              <div className="typing-dot" style={{ animationDelay: '0s' }}></div>
              <div className="typing-dot" style={{ animationDelay: '0.2s' }}></div>
              <div className="typing-dot" style={{ animationDelay: '0.4s' }}></div>
            </div>
          </div>
        )}
        <p style={{ fontSize: '0.75rem', color: 'var(--gray-600)', textAlign: 'center', marginTop: '10px', marginBottom: '20px', wordBreak: 'keep-all', lineHeight: '1.4' }}>
          {t('chat.breakHintPre')}<span onClick={() => router.push(buildStaticEntityRoute('/mypage/edit-character', character.id))} style={{ textDecoration: 'underline', cursor: 'pointer', color: 'var(--point-color)' }}>{t('common.edit')}</span>] &gt; <span onClick={() => setShowSettings(true)} style={{ textDecoration: 'underline', cursor: 'pointer', color: 'var(--gray-800)' }}>[{t('chat.deleteAll')}</span>{t('chat.breakHintPost')}
        </p>
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {!editingMessageId && (
        <div ref={inputAreaRef} className="chat-input-area">
          <div style={{ position: 'absolute', top: '-45px', right: '15px', display: 'flex' }}>
            <button 
              onClick={insertActionBracket}
              style={{ padding: '8px 16px', borderRadius: '20px', backgroundColor: 'var(--point-color)', color: 'white', border: 'none', fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
            >
              {t('chat.actionBracket')}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '5px' }}>
            <textarea
              ref={inputRef}
              className="chat-message-input"
              rows={1}
              value={inputMsg}
              onChange={(e) => {
                setInputMsg(e.target.value);
                if (draftLoaded.current) {
                  clearDraft(character?.id || '', 'chat');
                  draftLoaded.current = false;
                }
                resizeChatInput(e.target);
              }}
              onFocus={() => window.setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  // prevents double triggering on Korean IME
                  if (!e.nativeEvent.isComposing) {
                    handleSend();
                  }
                }
              }}
              placeholder={t('chat.placeholder')}
            />
            <button 
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
              onClick={handleSend}
              disabled={!inputMsg.trim() || isSendingRef.current}
              style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: inputMsg.trim() && !isSendingRef.current ? 'var(--point-color)' : 'var(--gray-300)', color: 'white', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: inputMsg.trim() && !isSendingRef.current ? 'pointer' : 'not-allowed', flexShrink: 0, paddingRight: '2px' }}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Settings Bottom Sheet */}
      {showSettings && (
        <>
          <div onClick={() => setShowSettings(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100 }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'white', borderTopLeftRadius: '20px', borderTopRightRadius: '20px', padding: '25px', zIndex: 101, display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '10px' }}>{t('chat.settings')}</h3>
            
            <button 
              onClick={() => router.push(buildStaticEntityRoute('/mypage/edit-user', character.id))}
              style={{ padding: '15px', borderRadius: '12px', backgroundColor: 'var(--gray-50)', border: '1px solid var(--border-color)', color: 'var(--gray-800)', textAlign: 'left', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {t('chat.editProfile')}
            </button>
            <button 
              onClick={() => router.push(buildStaticEntityRoute('/mypage/edit-character', character.id))}
              style={{ padding: '15px', borderRadius: '12px', backgroundColor: 'var(--gray-50)', border: '1px solid var(--border-color)', color: 'var(--gray-800)', textAlign: 'left', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {t('chat.editCharProfile')}
            </button>
            
            <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '10px 0' }} />
            
            <button 
              onClick={() => { setShowDeleteConfirm(true); setShowSettings(false); }}
              style={{ padding: '15px', borderRadius: '12px', backgroundColor: '#FFF0F0', border: '1px solid #FFCDCD', color: 'red', textAlign: 'left', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {t('chat.deleteAll')}
            </button>
          </div>
        </>
      )}
      {/* Custom Delete Confirm Modal */}
      {showDeleteConfirm && (
        <>
          <div 
            onClick={() => setShowDeleteConfirm(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3000 }} 
          />
          <div style={{ 
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '90%', maxWidth: '340px', 
            backgroundColor: 'white', borderRadius: '20px', padding: '30px 20px 20px', zIndex: 3001,
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '10px' }}>
              {t('chat.deleteAll')}
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--gray-500)', marginBottom: '25px', whiteSpace: 'pre-line' }}>
              {t('chat.deleteConfirm')}
            </p>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button 
                onClick={handleDeleteChat}
                style={{ flex: 1, padding: '15px', backgroundColor: '#FF3B30', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {t('common.delete')}
              </button>
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                style={{ flex: 1, padding: '15px', backgroundColor: 'var(--gray-100)', color: 'var(--foreground)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </>
      )}

      <AdModal isOpen={adModalOpen} onConfirm={confirmAd} />
      <ReportModal
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmit={submitChatReport}
      />
      {adFailureMessage && (
        <div style={{ position: 'fixed', left: '50%', bottom: 'calc(var(--safe-bottom) + 16px)', transform: 'translateX(-50%)', zIndex: 4000, width: 'calc(100% - 32px)', maxWidth: '448px', backgroundColor: 'var(--gray-900)', color: 'white', borderRadius: '12px', padding: '12px 14px', fontSize: '0.9rem', textAlign: 'center', lineHeight: 1.4 }}>
          {adFailureMessage}
        </div>
      )}
      <ErrorModal isOpen={errorModalOpen} onConfirm={() => setErrorModalOpen(false)} />
    </div>
  );
}

export default function ChatDetail(props: { params: { id: string } }) {
  return (
    <Suspense fallback={(
      <div className="app-container full-page status-surface-solid" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" />
      </div>
    )}>
      <ChatDetailContent {...props} />
    </Suspense>
  );
}
