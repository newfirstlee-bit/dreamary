"use client";

import { useEffect, useState } from 'react';

interface AdModalProps {
  isOpen: boolean;
  onConfirm: () => void;
}

export default function AdModal({ isOpen, onConfirm }: AdModalProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

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
        
        <div style={{
          width: '50px',
          height: '50px',
          borderRadius: '50%',
          backgroundColor: 'var(--point-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '16px',
          color: 'white',
          fontSize: '24px'
        }}>
          ✨
        </div>

        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--gray-900)', textAlign: 'center', marginBottom: '8px' }}>
          서비스 응답 대기 중
        </h3>
        
        <p style={{ fontSize: '0.95rem', color: 'var(--gray-600)', textAlign: 'center', marginBottom: '24px', lineHeight: '1.4' }}>
          원활한 서비스 운영을 위해<br/>잠시 후 광고가 보여요.
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
          확인
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
