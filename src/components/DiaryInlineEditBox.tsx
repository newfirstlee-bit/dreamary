"use client";

import { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

interface DiaryInlineEditBoxProps {
  value: string;
  maxLength?: number;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
}

export default function DiaryInlineEditBox({
  value,
  maxLength = 4000,
  onChange,
  onCancel,
  onSave,
}: DiaryInlineEditBoxProps) {
  const { locale } = useLocale();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!value.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  const resize = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(120, textarea.scrollHeight)}px`;
    textarea.style.overflowY = 'hidden';
  };

  useEffect(() => {
    resize(textareaRef.current);
  }, [value]);

  return (
    <div style={{ width: '100%', backgroundColor: 'white', padding: '15px', borderRadius: '15px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: 'var(--point-color)' }}>
        <Pencil size={16} />
        <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>
          {locale === 'ja' ? '日記を編集中' : '일기 수정 중'}
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={event => onChange(event.target.value.slice(0, maxLength))}
        onFocus={event => resize(event.currentTarget)}
        style={{
          width: '100%',
          minHeight: '120px',
          backgroundColor: 'var(--gray-50)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          padding: '10px',
          color: 'var(--foreground)',
          fontSize: '0.95rem',
          resize: 'none',
          outline: 'none',
          overflow: 'hidden',
          boxSizing: 'border-box',
          lineHeight: '1.5',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '5px' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>{value.length}/{maxLength}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '15px' }}>
        <button
          onMouseDown={event => event.preventDefault()}
          onTouchStart={event => event.preventDefault()}
          onClick={onCancel}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--gray-100)', color: 'var(--gray-800)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold' }}
        >
          {locale === 'ja' ? 'キャンセル' : '취소'}
        </button>
        <button
          onMouseDown={event => event.preventDefault()}
          onTouchStart={event => event.preventDefault()}
          onClick={handleSave}
          disabled={!value.trim() || isSaving}
          style={{ minWidth: '92px', minHeight: '36px', padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: !value.trim() ? 'var(--gray-400)' : isSaving ? '#CBBEFF' : 'var(--point-color)', color: 'white', fontWeight: 'bold', cursor: value.trim() && !isSaving ? 'pointer' : 'not-allowed', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {isSaving ? <Loader2 className="animate-spin" size={18} /> : (locale === 'ja' ? '修正完了' : '수정 완료')}
        </button>
      </div>
    </div>
  );
}
