"use client";

import React from 'react';
import { useRouter } from 'next/navigation';

interface EmptyCharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function EmptyCharacterModal({ isOpen, onClose }: EmptyCharacterModalProps) {
  const router = useRouter();

  if (!isOpen) return null;

  return (
    <>
      <div 
        onClick={onClose}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 5000 }} 
      />
      <div style={{ 
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '90%', maxWidth: '340px', 
        backgroundColor: 'white', borderRadius: '20px', padding: '30px 20px 20px', zIndex: 5001,
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
      }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '25px' }}>
          캐릭터를 먼저 만들어주세요
        </h2>
        
        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
          <button 
            onClick={onClose}
            style={{ flex: 3, padding: '15px', backgroundColor: 'var(--gray-100)', color: 'var(--foreground)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
          >
            나중에
          </button>
          <button 
            onClick={() => {
              onClose();
              router.push('/onboarding?skip=true');
            }}
            style={{ flex: 7, padding: '15px', backgroundColor: 'var(--point-color)', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
          >
            좋아요
          </button>
        </div>
      </div>
    </>
  );
}
