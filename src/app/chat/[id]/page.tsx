"use client";
import { apiPostJson } from '@/lib/api';
import { sendChatRequest } from '@/lib/chatRequest';
import { MAX_CHAT_INPUT } from '@/lib/productLimits';
import { showAd } from "@/lib/ads";

import { useEffect, useState, useRef, ReactNode, useCallback, Suspense } from 'react';
import ResilientImage from '@/components/ResilientImage';
import { useRouter, useSearchParams } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { useUserId } from '@/hooks/useUserId';
import { auth } from '@/lib/firebase';
import { getCharacterById, Character, getUserProfile, UserProfile, getChatMessages, getChatMessagesPage, ChatPage, subscribeChatMessages, ChatMessage, saveChatMessage, deleteChatMessages, unlockMessageAd, updateChatMessage, deleteMessage } from '@/lib/db';
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
import { useAsyncActionLock } from '@/hooks/useAsyncActionLock';
import { useChatKeyboard } from '@/hooks/useChatKeyboard';
import { readPendingChat, pendingReply, type PendingChat } from '@/lib/pendingChat';

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
  const [historyCursor, setHistoryCursor] = useState<ChatPage['nextCursor']>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const historyLoadingRef = useRef(false);
  const viewGeneration = useRef(0);
  const pendingSend = useRef<PendingChat | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [inputMsg, setInputMsg] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const { isPending: isSending, runLocked: runChatSendLocked } = useAsyncActionLock();
  const { isPending: isDeletingChat, runLocked: runDeleteLocked } = useAsyncActionLock();
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const deleteFailureRef = useRef(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null);
  
  // Message Edit/Delete States
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deleteConfirmMessageId, setDeleteConfirmMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  useChatKeyboard(chatAreaRef);
  const isAutoScrollEnabled = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
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

  const adResolverRef = useRef<((didOpen: boolean) => void) | null>(null);
  const confirmAd = () => {
    showAd((result) => {
      setAdModalOpen(false);
      if (modalResolver) {
        if (!result.didOpen && result.message) {
          setAdFailureMessage(result.message);
        }
        modalResolver(result.didOpen);
        setModalResolver(null);
        adResolverRef.current = null;
      }
    });
  };

  const closeAdModal = () => {
    setAdModalOpen(false);
    if (modalResolver) {
      modalResolver(false);
      adResolverRef.current = null;
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

  useEffect(() => {
    if (!userId) return; // auth 초기화 전에는 실행하지 않음
    trackEvent('Chat_Opened', { character_id: characterId });
    
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let recoveryChecks = 0;
    viewGeneration.current++;
    setMessages([]);
    setCharacter(null);
    setIsTyping(false);
    setStreamingContent('');
    historyLoadingRef.current = false;
    setLoadingHistory(false);
    setHistoryCursor(null);
    setLoading(true);
    const pending = readPendingChat(userId, characterId);
    pendingSend.current = pending;
    setInputMsg(pending ? '' : (loadDraft(characterId, 'chat') || ''));
    setRecoveryPending(Boolean(pending));
    const completePending = () => {
      localStorage.removeItem(`chat_pending_${userId}_${characterId}`);
      clearDraft(characterId, 'chat');
      pendingSend.current = null;
      setRecoveryPending(false);
      if (recoveryTimer) clearTimeout(recoveryTimer);
    };
    const recoverPending = async () => {
      if (cancelled || !pending || !pendingSend.current) return;
      try {
        const result = await apiPostJson<{ status: string; reply?: ChatMessage }>('/api/chat/status', { userId, characterId, requestId: pending.id });
        if (cancelled || !pendingSend.current) return;
        if (result.status === 'complete' && result.reply) {
          const reply = result.reply;
          if (reply.userId !== userId || reply.characterId !== characterId || reply.requestId !== pending.id) throw new Error('Reply identity mismatch');
          setMessages(previous => previous.some(m => m.id === reply.id) ? previous : [...previous, reply]);
          completePending();
          clearUserCache(userId, ['chat', 'home']);
          return;
        }
        if (result.status === 'failed' || (result.status === 'missing' && Date.now() - pending.createdAt > 15000)) {
          setRecoveryPending(false);
          setInputMsg(pending.text);
          saveDraft(characterId, pending.text, 'chat');
          setErrorModalOpen(true);
          return;
        }
      } catch {
        if (cancelled) return;
        // A network failure is not evidence that the server stopped generating.
      }
      if (!cancelled && ++recoveryChecks < 12) recoveryTimer = setTimeout(recoverPending, 5000);
      else if (!cancelled) { setRecoveryPending(false); setErrorModalOpen(true); }
    };
    const init = async () => {
      try {
        const char = await getCharacterById(characterId);
        if (cancelled) return;
        if (!char || char.userId !== userId) { router.replace('/chat'); return; }
        setCharacter(char);
        const [profile, page] = await Promise.all([getUserProfile(char.id), getChatMessagesPage(userId, char.id)]);
        if (cancelled) return;
        setUserProfile(profile);
        setMessages(page.messages);
        setHistoryCursor(page.nextCursor);
        if (pending && pendingReply(page.messages, pending)) completePending();
        else if (pending) void recoverPending();
        if (!page.messages.length) void triggerInitialPing(char, profile);
        let previousWindow = new Set(page.messages.map(m => m.id));
        unsubscribe = subscribeChatMessages(userId, char.id, incoming => {
          if (cancelled) return;
          if (pendingSend.current && pendingReply(incoming, pendingSend.current)) completePending();
          if (!incoming.length) { setMessages([]); setHistoryCursor(null); return; }
          const ids = new Set(incoming.map(m => m.id));
          const oldest = incoming[0];
          const oldWindow = previousWindow;
          setMessages(previous => {
            const older = previous.filter(m => !ids.has(m.id) && (!oldWindow.has(m.id) ||
              (oldest && (m.createdAt < oldest.createdAt || (m.createdAt === oldest.createdAt && m.id < oldest.id)))));
            return [...older, ...incoming].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
          });
          previousWindow = ids;
        }, () => { if (!cancelled) setErrorModalOpen(true); });
      } catch {
        if (!cancelled) setErrorModalOpen(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void init();
    return () => { cancelled = true; if (recoveryTimer) clearTimeout(recoveryTimer); viewGeneration.current++; adResolverRef.current?.(false); adResolverRef.current = null; unsubscribe?.(); };
  }, [characterId, router, userId]);

  useEffect(() => {
    if (isAutoScrollEnabled.current && !editingMessageId) {
      chatAreaRef.current?.scrollTo({ top: chatAreaRef.current.scrollHeight, behavior: 'smooth' });
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
    const generation = viewGeneration.current;
    setIsTyping(true);
    try {
      await ensureInitialPing({ character: char, userProfile: profile, userId });
      clearUserCache(userId, ['chat', 'home', 'chat-preview:' + characterId]);
    } catch (error) {
      console.error('Initial ping failed:', error);
    } finally {
      if (generation === viewGeneration.current) setIsTyping(false);
    }
  };

  const loadOlderMessages = async () => {
    if (!userId || !historyCursor || historyLoadingRef.current) return;
    const generation = viewGeneration.current;
    historyLoadingRef.current = true;
    setLoadingHistory(true);
    isAutoScrollEnabled.current = false;
    const oldHeight = chatAreaRef.current?.scrollHeight || 0;
    const oldTop = chatAreaRef.current?.scrollTop || 0;
    try {
      const page = await getChatMessagesPage(userId, characterId, historyCursor);
      if (generation !== viewGeneration.current) return;
      setHistoryCursor(page.nextCursor);
      setMessages(previous => Array.from(new Map([...page.messages, ...previous].map(m => [m.id, m])).values())
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)));
      requestAnimationFrame(() => {
        if (generation === viewGeneration.current && chatAreaRef.current)
          chatAreaRef.current.scrollTop = oldTop + chatAreaRef.current.scrollHeight - oldHeight;
      });
    } catch { if (generation === viewGeneration.current) setErrorModalOpen(true); }
    finally { if (generation === viewGeneration.current) { historyLoadingRef.current = false; setLoadingHistory(false); } }
  };

  const handleSend = async () => {
    if (!inputMsg.trim() || !character || !userId || isDeletingChat || isTyping || recoveryPending || inputMsg.trim().length > MAX_CHAT_INPUT) return;

    await runChatSendLocked(async () => {
      const generation = viewGeneration.current;
      const isCurrent = () => generation === viewGeneration.current;
      const userText = inputMsg.trim();
      const pendingKey = `chat_pending_${userId}_${character.id}`;
      let previous = pendingSend.current;
      try { previous = JSON.parse(localStorage.getItem(pendingKey) || 'null') || previous; } catch {};
      const pending = previous && previous.text === userText && previous.owner === userId && previous.character === character.id
        ? previous : { text: userText, owner: userId!, character: character.id, id: generateId(), createdAt: Date.now() };
      pendingSend.current = pending;
      localStorage.setItem(pendingKey, JSON.stringify(pending));
      saveDraft(character.id, userText, 'chat');
      const requestId = pending.id;

      const userMsg: ChatMessage = {
        id: 'user_' + requestId,
        userId: userId!,
        characterId: character.id,
        role: 'user',
        content: userText,
        createdAt: pending.createdAt,
        requestId,
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
      let aiRequested = false;
      try {
        // Save before calling AI so the server can build context, but remove it again if sending fails.
        await saveChatMessage(userMsg);
        userMessagePersisted = true;
        if (!isCurrent()) throw new Error('VIEW_CHANGED');
        if (userId) clearUserCache(userId, ['chat', 'home']);

        const isAdTurn = shouldShowChatAd();
        attemptedAdTurn = isAdTurn;

        let adWaitPromise = Promise.resolve(true);
        if (isAdTurn) {
          setAdModalOpen(true);
          adWaitPromise = new Promise<boolean>((resolve) => {
            adResolverRef.current = resolve;
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
        if (!isCurrent()) throw new Error('VIEW_CHANGED');
        const contextMessages = [...messages.filter(m => m.id !== userMsg.id), userMsg].slice(-10);

        aiRequested = true;
        localStorage.setItem(pendingKey, JSON.stringify({ ...pending, phase: 'requested' }));
        clearDraft(character.id, 'chat');
        const result = await sendChatRequest({
          character, userProfile, messages: contextMessages, isFirstPing: false,
          userId, isAdTurn: false, requestId,
        }, (text, id) => { if (isCurrent()) { setStreamingContent(text); setStreamingMessageId(id); } });
        if (!result.savedId || typeof result.reply !== 'string') throw new Error('Missing saved reply');
        savedId = result.savedId;
        localStorage.removeItem(pendingKey);
        clearDraft(character.id, 'chat');
        recordSuccessfulChatTurn();
        if (!isCurrent()) return;
        setMessages(previous => previous.some(m => m.id === savedId) ? previous : [...previous, {
          id: savedId, userId: userId!, characterId: character.id, role: 'assistant',
          content: result.reply, createdAt: Date.now(), requestId,
        }].sort((a, b) => a.createdAt - b.createdAt) as ChatMessage[]);
        pendingSend.current = null;
        setStreamingContent('');
        setStreamingMessageId(null);
        success = true;

        if (success) {

          trackEvent('Chat_Response_Received', {
            character_id: character.id,
          });
          // loadMessages() is no longer needed due to subscription
        } else {
          throw new Error('Streaming failed');
        }
      } catch (error) {
        console.error('Send failed:', error);
        if (userMessagePersisted && !aiRequested) await deleteMessage(userMsg.id).catch(() => {});
        if (!isCurrent()) return;
        closeAdModal();
        setStreamingMessageId(null);

        if (!aiRequested) {
          setMessages(prev => prev.filter(m => m.id !== userMsg.id));
          setInputMsg(userText);
          saveDraft(character.id, userText, 'chat');
        } else {
          // The request may have reached the server even when the client timed
          // out. Keep the composer empty and show the pending indicator until
          // the subscription/recovery path observes the matching reply.
          setRecoveryPending(true);
          window.setTimeout(() => {
            if (pendingSend.current?.id !== requestId || !isCurrent()) return;
            pendingSend.current = null;
            localStorage.removeItem(pendingKey);
            setRecoveryPending(false);
            setInputMsg(userText);
            saveDraft(character.id, userText, 'chat');
            setErrorModalOpen(true);
          }, 60000);
        }
        if ((error as Error)?.message !== 'AD_OPEN_FAILED') {
          if (attemptedAdTurn) {
            logAdDiagnostic('chat', 'app_server_request_failed', { characterId: character.id, requestId }, error);
          }
          setErrorModalOpen(true);
        }
      } finally {
        if (isCurrent()) { setIsTyping(false); setStreamingContent(''); }
      }
    });
  };

  const handleDeleteChat = () => runDeleteLocked(async () => {
    if (deleteFailureRef.current || isSending || isTyping || recoveryPending) return;
    const generation = viewGeneration.current;
    try {
      if (!userId) return;
      await deleteChatMessages(userId, characterId);
      clearDraft(characterId, 'chat');
      clearUserCache(userId, ['chat', 'home', `chat-preview:${characterId}`]);
      if (generation !== viewGeneration.current) return;
      pendingSend.current = null;
      localStorage.removeItem(`chat_pending_${userId}_${characterId}`);
      setHistoryCursor(null);
      setMessages([]);
      setShowSettings(false);
      setShowDeleteConfirm(false);
      setInputMsg('');
      if (character) void triggerInitialPing(character, userProfile);
    } catch (error) {
      if (generation === viewGeneration.current) {
        deleteFailureRef.current = true;
        setDeleteFailed(true);
        alert(t('chat.deleteFailed'));
      }
    }
  });

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
        style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px', overscrollBehavior: 'none' }}
      >
        {historyCursor && <button onClick={loadOlderMessages} disabled={loadingHistory}
          style={{ alignSelf: 'center', padding: '10px 16px', borderRadius: '12px', background: 'white', color: 'var(--foreground)', border: '1px solid var(--border-color)' }}>
          {loadingHistory ? (locale === 'ja' ? '読み込み中…' : '불러오는 중…') : (locale === 'ja' ? '以前の会話をもっと見る' : '이전 대화 더보기')}
        </button>}
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
                    <ResilientImage src={character.image} alt={character.name} kind="character_profile" fill style={{ objectFit: 'cover' }} fallback={<User size={22} color="var(--gray-500)" />} />
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
                        <ResilientImage src={character.image} alt={character.name} kind="character_profile" fill style={{ objectFit: 'cover' }} fallback={<User size={22} color="var(--gray-500)" />} />
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
                              setMessages(previous => previous.map(item => item.id === msg.id ? { ...item, isAdLocked: false } : item));
                              logAdDiagnostic('chat', 'ad_completed', { characterId: character.id, messageId: msg.id, action: 'unlock_existing_message' });
                            } catch (e) {
                              logAdDiagnostic('chat', 'ad_unlock_failed', { characterId: character.id, messageId: msg.id, action: 'unlock_existing_message' }, e);
                            }
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
                    <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', width: '100%', gap: '8px', marginTop: '4px' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--gray-500)' }}>
                        {showTime ? timeString : ''}
                      </span>
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
                <ResilientImage src={character.image} alt={character.name} kind="character_profile" fill style={{ objectFit: 'cover' }} fallback={<User size={22} color="var(--gray-500)" />} />
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

        {(isTyping || recoveryPending) && !streamingContent && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', alignItems: 'flex-end', marginBottom: '20px' }}>
            {character?.image && (
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                <ResilientImage src={character.image} alt="char" kind="character_profile" fill style={{ objectFit: 'cover' }} fallback={<User size={22} color="var(--gray-500)" />} />
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
              maxLength={MAX_CHAT_INPUT}
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
              onFocus={() => window.setTimeout(() => chatAreaRef.current?.scrollTo({ top: chatAreaRef.current.scrollHeight, behavior: 'smooth' }), 100)}
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
              disabled={!inputMsg.trim() || isSending}
              style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: isSending ? '#CBBEFF' : inputMsg.trim() ? 'var(--point-color)' : 'var(--gray-300)', color: 'white', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: inputMsg.trim() && !isSending ? 'pointer' : 'not-allowed', flexShrink: 0, paddingRight: '2px' }}
            >
              {isSending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      )}

      {/* Settings Bottom Sheet */}
      {showSettings && (
        <>
          <div onClick={() => setShowSettings(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, width: '100%', maxWidth: '480px', margin: '0 auto', maxHeight: 'calc(var(--app-viewport-height, 100dvh) - var(--safe-top) - 24px)', overflowY: 'auto', backgroundColor: 'white', borderTopLeftRadius: '20px', borderTopRightRadius: '20px', padding: '25px 25px calc(25px + var(--bottom-ui-safe-gap))', zIndex: 2001, display: 'flex', flexDirection: 'column', gap: '15px' }}>
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
              onClick={() => { deleteFailureRef.current = false; setDeleteFailed(false); setShowDeleteConfirm(true); setShowSettings(false); }}
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
            onClick={() => { if (!isDeletingChat) { deleteFailureRef.current = false; setDeleteFailed(false); setShowDeleteConfirm(false); } }}
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
                disabled={isDeletingChat || deleteFailed || isSending || isTyping || recoveryPending}
                aria-busy={isDeletingChat}
                style={{ flex: 1, padding: '15px', backgroundColor: isDeletingChat || deleteFailed ? '#FFB3AD' : '#FF3B30', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: isDeletingChat ? 'wait' : 'not-allowed', opacity: isDeletingChat || deleteFailed ? 0.8 : 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}
              >
                {isDeletingChat ? <span className="loading-dots" aria-label={locale === 'ja' ? '削除中' : '삭제 중'}>...</span> : t('common.delete')}
              </button>
              <button 
                onClick={() => { if (!isDeletingChat) { deleteFailureRef.current = false; setDeleteFailed(false); setShowDeleteConfirm(false); } }}
                disabled={isDeletingChat}
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
