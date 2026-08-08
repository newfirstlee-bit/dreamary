"use client";

import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/lib/i18n';

export interface ReportSubmitPayload {
  reasons: string[];
  otherText: string;
}

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: ReportSubmitPayload) => Promise<void>;
}

const REASONS = [
  { key: 'sexual', labelKey: 'report.reasonSexual' },
  { key: 'violent', labelKey: 'report.reasonViolent' },
  { key: 'crime', labelKey: 'report.reasonCrime' },
  { key: 'other', labelKey: 'report.reasonOther' },
];

export default function ReportModal({ isOpen, onClose, onSubmit }: ReportModalProps) {
  const { t } = useLocale();
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const otherInputRef = useRef<HTMLInputElement>(null);

  const isOtherSelected = selectedReasons.includes('other');
  const canSubmit = selectedReasons.length > 0 && !submitting;

  useEffect(() => {
    if (!isOpen) {
      setSelectedReasons([]);
      setOtherText('');
      setSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isOtherSelected) return;
    window.setTimeout(() => otherInputRef.current?.focus(), 100);
  }, [isOpen, isOtherSelected]);

  if (!isOpen) return null;

  const toggleReason = (reason: string) => {
    setSelectedReasons(prev => (
      prev.includes(reason)
        ? prev.filter(item => item !== reason)
        : [...prev, reason]
    ));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ reasons: selectedReasons, otherText });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 5000 }}
      />
      <div
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: '90%',
          maxWidth: '360px',
          maxHeight: '85vh',
          overflowY: 'auto',
          backgroundColor: 'white',
          borderRadius: '20px',
          padding: '28px 20px 20px',
          zIndex: 5001,
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          boxShadow: '0 12px 34px rgba(0,0,0,0.18)'
        }}
      >
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', textAlign: 'center', color: 'var(--gray-900)', lineHeight: 1.4 }}>
          {t('report.title')}
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {REASONS.map(reason => {
            const checked = selectedReasons.includes(reason.key);
            return (
              <label
                key={reason.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '14px',
                  borderRadius: '12px',
                  border: checked ? '1px solid var(--point-color)' : '1px solid var(--border-color)',
                  backgroundColor: checked ? '#F5F0FF' : 'white',
                  cursor: 'pointer',
                  color: 'var(--gray-800)',
                  fontSize: '0.95rem',
                  fontWeight: checked ? 'bold' : 'normal',
                  lineHeight: 1.4
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleReason(reason.key)}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--point-color)', flexShrink: 0 }}
                />
                <span>{t(reason.labelKey)}</span>
              </label>
            );
          })}

          {isOtherSelected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <input
                ref={otherInputRef}
                value={otherText}
                onChange={event => setOtherText(event.target.value.slice(0, 30))}
                maxLength={30}
                placeholder={t('report.otherPlaceholder')}
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  outline: 'none',
                  fontSize: '1rem',
                  boxSizing: 'border-box'
                }}
              />
              <span style={{ alignSelf: 'flex-end', fontSize: '0.75rem', color: 'var(--gray-500)' }}>{otherText.length}/30</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{ flex: 1, padding: '15px', backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)', border: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '1rem', cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ flex: 1, padding: '15px', backgroundColor: canSubmit ? 'var(--point-color)' : 'var(--gray-300)', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '1rem', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {submitting ? t('report.submitting') : t('report.submit')}
          </button>
        </div>
      </div>
    </>
  );
}
