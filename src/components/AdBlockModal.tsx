"use client";

import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n';

export default function AdBlockModal() {
  const [isAdBlockEnabled, setIsAdBlockEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { t } = useLocale();

  useEffect(() => {
    setMounted(true);
    
    const checkAdBlock = async () => {
      try {
        await fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store'
        });
        
        const adTest = document.createElement('div');
        adTest.innerHTML = '&nbsp;';
        adTest.className = 'adsbox';
        adTest.style.position = 'absolute';
        adTest.style.top = '-999px';
        adTest.style.height = '10px';
        document.body.appendChild(adTest);
        
        setTimeout(() => {
          if (adTest.offsetHeight === 0 || adTest.style.display === 'none') {
            setIsAdBlockEnabled(true);
          }
          adTest.remove();
        }, 100);

      } catch (e) {
        setIsAdBlockEnabled(true);
      }
    };

    checkAdBlock();
  }, []);

  if (!mounted || !isAdBlockEnabled) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0,0,0,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      backdropFilter: 'blur(5px)',
    }}>
      <div style={{
        width: '90%',
        maxWidth: '340px',
        backgroundColor: 'white',
        borderRadius: '16px',
        padding: '32px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
        animation: 'fadeInUp 0.3s ease-out'
      }}>
        
        <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--gray-900)', textAlign: 'center', marginBottom: '16px', lineHeight: '1.4' }}>
          {t('adblock.title')}
        </h3>
        
        <p style={{ fontSize: '0.95rem', color: 'var(--gray-600)', textAlign: 'center', marginBottom: '24px', lineHeight: '1.5', wordBreak: 'keep-all' }}>
          {t('adblock.desc')}
        </p>

        <button
          onClick={() => window.location.reload()}
          style={{
            width: '100%',
            padding: '16px',
            backgroundColor: 'var(--point-color)',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '1rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'transform 0.1s, opacity 0.2s'
          }}
          onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.96)'}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          {t('common.refresh')}
        </button>
      </div>
      
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
