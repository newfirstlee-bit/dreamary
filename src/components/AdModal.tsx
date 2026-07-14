"use client";

import { useEffect, useState } from 'react';
import { trackEvent } from '@/lib/mixpanel';
import { useLocale } from '@/lib/i18n';

interface AdModalProps {
  isOpen: boolean;
  onConfirm: () => void;
}

export default function AdModal({ isOpen, onConfirm }: AdModalProps) {
  const [mounted, setMounted] = useState(false);
  const { t } = useLocale();
  
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && isOpen) {
      trackEvent('Ad_Shown');
    }
  }, [isOpen, mounted]);

  if (!mounted || !isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      backdropFilter: 'blur(3px)',
    }}>
      <div style={{
        width: '90%',
        maxWidth: '320px',
        backgroundColor: 'white',
        borderRadius: '16px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
        animation: 'fadeInUp 0.3s ease-out'
      }}>
        
        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--gray-900)', textAlign: 'center', marginBottom: '16px', lineHeight: '1.4', whiteSpace: 'pre-line' }}>
          {t('ad.title')}
        </h3>
        
        <p style={{ fontSize: '0.95rem', color: 'var(--gray-600)', textAlign: 'center', marginBottom: '24px', lineHeight: '1.4' }}>
          {t('ad.desc')}
        </p>

        <button
          onClick={onConfirm}
          style={{
            width: '100%',
            padding: '14px',
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
          {t('common.confirm')}
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
