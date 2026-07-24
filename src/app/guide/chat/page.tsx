"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { trackEvent } from '@/lib/mixpanel';

export default function GuideChatPage() {
  const router = useRouter();
  const { locale } = useLocale();
  const [viewportStyle, setViewportStyle] = useState({ height: '100dvh', top: 0 });

  useEffect(() => {
    trackEvent('Guide_Chat_Viewed');
    
    // Handle mobile virtual keyboard to stay glued to the visual viewport
    if (window.visualViewport) {
      const handleResizeOrScroll = () => {
        if (!window.visualViewport) return;
        setViewportStyle({
          height: `${window.visualViewport.height}px`,
          top: window.visualViewport.pageTop
        });
      };
      window.visualViewport.addEventListener('resize', handleResizeOrScroll);
      window.visualViewport.addEventListener('scroll', handleResizeOrScroll);
      handleResizeOrScroll();
      
      return () => {
        window.visualViewport?.removeEventListener('resize', handleResizeOrScroll);
        window.visualViewport?.removeEventListener('scroll', handleResizeOrScroll);
      };
    }
  }, []);

  const titleText = locale === 'ja' 
    ? '夢キャを設定すると、1対1でチャットできます' 
    : '드림캐 설정하면 1:1 채팅할 수 있어요';

  const narration1Text = locale === 'ja'
    ? 'スマホが小さく震えて、画面が光った。\nまた広告メッセージだろうと思ったら─'
    : '핸드폰이 작게 진동하며 깜빡거렸다.\n보나마나 또 광고 메시지겠지.';
  
  const narration2Text = locale === 'ja'
    ? '……って、広告じゃない！？'
    : '...라고 생각했는데, 광고가 아니었잖아?';

  const bubble1Text = locale === 'ja' ? 'ねえ、' : '있잖아.';
  const bubble2Text = locale === 'ja' 
    ? '話したいことがあるんだけど、<br/>少し時間いい？' 
    : '하고 싶은 말이 있는데,<br/>잠깐 괜찮아?';
  const ctaText = locale === 'ja' ? '夢キャを設定する' : '드림캐 설정하기';
  const ctaNoticeText = locale === 'ja' ? 'たった1分で十分です' : '1분이면 충분해요';

  return (
    <div className="app-container" style={{ 
      minHeight: viewportStyle.height, 
      height: viewportStyle.height, 
      position: 'relative', 
      top: viewportStyle.top, 
      width: '100%',
      backgroundColor: 'var(--background-color)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <header style={{ display: 'flex', alignItems: 'center', padding: '20px', paddingBottom: '10px', minHeight: '68px' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center', marginLeft: '-5px' }}>
          <ChevronLeft size={32} color="var(--gray-800)" />
        </button>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 20px', overflowY: 'auto' }}>
        <h1 
          style={{ 
            fontSize: '1.6rem', 
            fontWeight: 'bold', 
            lineHeight: 1.4, 
            marginTop: '20px', 
            marginBottom: '40px',
            color: 'var(--gray-900)'
          }}
          dangerouslySetInnerHTML={{ __html: titleText }}
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'flex-start', justifyContent: 'center', transform: 'translateY(-20px)' }}>
          <div style={{
            alignSelf: 'flex-start',
            fontStyle: 'italic',
            color: 'var(--gray-600)',
            fontSize: '0.9rem',
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            margin: '8px 0',
            lineHeight: 1.5,
            opacity: 0,
            animation: 'fadeInBubble 0.4s ease forwards',
            animationDelay: '0.1s'
          }}>
            {narration1Text}
          </div>
          <div 
            style={{ 
              backgroundColor: '#F5F0FF', 
              color: 'var(--gray-800)', 
              padding: '12px 18px', 
              borderRadius: '20px', 
              borderTopLeftRadius: '4px',
              fontSize: '1rem',
              lineHeight: 1.5,
              opacity: 0,
              animation: 'fadeInBubble 0.4s ease forwards',
              animationDelay: '0.7s'
            }}
          >
            {bubble1Text}
          </div>
          <div 
            style={{ 
              backgroundColor: '#F5F0FF', 
              color: 'var(--gray-800)', 
              padding: '12px 18px', 
              borderRadius: '20px', 
              borderTopLeftRadius: '4px',
              fontSize: '1rem',
              lineHeight: 1.5,
              opacity: 0,
              animation: 'fadeInBubble 0.4s ease forwards',
              animationDelay: '1.3s'
            }}
            dangerouslySetInnerHTML={{ __html: bubble2Text }}
          />
          <div style={{
            alignSelf: 'flex-start',
            fontStyle: 'italic',
            color: 'var(--gray-600)',
            fontSize: '0.9rem',
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            margin: '8px 0',
            lineHeight: 1.5,
            opacity: 0,
            animation: 'fadeInBubble 0.4s ease forwards',
            animationDelay: '1.9s'
          }}>
            {narration2Text}
          </div>
        </div>

        <div style={{ paddingBottom: '20px', paddingTop: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '10px' }}>
            {ctaNoticeText}
          </span>
          <button 
            className="btn-primary" 
            onClick={() => router.push('/onboarding?skip=true')}
            style={{ 
              width: '100%', 
              marginTop: 0,
            }}
          >
            {ctaText}
          </button>
        </div>
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeInBubble {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />
    </div>
  );
}
