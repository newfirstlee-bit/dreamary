"use client";

import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';
import { getUserId } from '@/lib/auth';
import { getCharacterById, saveCharacter, Character } from '@/lib/db';
import { uploadImageToImgbb } from '@/lib/imgbb';
import { Loader2, ChevronLeft, Camera, User } from 'lucide-react';
import { trackEvent } from '@/lib/mixpanel';
import { useLocale } from '@/lib/i18n';

function GenderSelect({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  const { t } = useLocale();
  const options = [t('gender.male'), t('gender.female'), t('gender.other')];
  return (
    <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
      {options.map(opt => (
        <div 
          key={opt}
          style={{
            flex: 1,
            padding: '12px 0',
            textAlign: 'center',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: value === opt ? 'bold' : '500',
            backgroundColor: value === opt ? 'var(--point-color)' : 'transparent',
            color: value === opt ? 'white' : 'var(--gray-600)',
            transition: 'all 0.2s'
          }}
          onClick={() => onChange(opt)}
        >
          {opt}
        </div>
      ))}
    </div>
  );
}

export default function EditCharacterPage() {
  const router = useRouter();
  const params = useParams();
  const charId = params.id as string;
  const { t } = useLocale();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [initialChar, setInitialChar] = useState<Character | null>(null);
  const [showExitModal, setShowExitModal] = useState(false);
  
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [feeling, setFeeling] = useState('');
  const [title, setTitle] = useState('');
  const [exampleChat, setExampleChat] = useState('');
  const [negative, setNegative] = useState('');
  const [worldview, setWorldview] = useState('');
  const [extra, setExtra] = useState('');
  const [narrative, setNarrative] = useState('');
  
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const narrativeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const char = await getCharacterById(charId);
        
        if (!char) {
          router.replace('/mypage');
          return;
        }

        setInitialChar(char);
        setName(char.name || '');
        setGender(char.gender || '');
        setFeeling(char.feeling || '');
        setTitle(char.title || '');
        setExampleChat(char.exampleChat || '');
        setNegative(char.negative || '');
        setWorldview(char.worldview || '');
        setExtra(char.extra || '');
        setNarrative(char.narrative || '');
        setImageUrl(char.image || '');
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [charId, router]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setImageUrl(URL.createObjectURL(file));
    }
  };

  const insertQuotes = () => {
    setExampleChat(prev => prev + '""');
  };

  const insertVariable = (variable: string) => {
    const textarea = narrativeRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = narrative;

    const newVal = currentVal.substring(0, start) + variable + currentVal.substring(end);
    setNarrative(newVal.slice(0, 700));

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  const hasChanges = initialChar !== null && (
    name !== (initialChar.name || '') ||
    gender !== (initialChar.gender || '') ||
    feeling !== (initialChar.feeling || '') ||
    title !== (initialChar.title || '') ||
    exampleChat !== (initialChar.exampleChat || '') ||
    negative !== (initialChar.negative || '') ||
    worldview !== (initialChar.worldview || '') ||
    extra !== (initialChar.extra || '') ||
    narrative !== (initialChar.narrative || '') ||
    imageFile !== null
  );

  const handleBack = () => {
    if (hasChanges) {
      setShowExitModal(true);
    } else {
      router.back();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const userId = getUserId();
      let finalImgUrl = imageUrl;
      
      if (imageFile) {
        finalImgUrl = await uploadImageToImgbb(imageFile);
      }

      const updatedChar: Character = {
        ...initialChar,
        id: charId,
        userId: userId,
        name: name.trim(),
        gender: gender || undefined,
        feeling: feeling.trim(),
        title: title.trim(),
        exampleChat: exampleChat.trim(),
        negative: negative.trim(),
        worldview: worldview.trim(),
        extra: extra.trim(),
        narrative: narrative.trim(),
      };
      
      if (finalImgUrl) {
        updatedChar.image = finalImgUrl;
      }

      await saveCharacter(updatedChar);
      trackEvent('Settings_Changed', { type: 'character_profile', character_id: updatedChar.id });
      router.push('/mypage');
    } catch (err) {
      console.error(err);
      alert(t('editChar.saveFailed'));
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="app-container" style={{ paddingBottom: '100px', backgroundColor: 'var(--gray-50)' }}>
      <header className="header" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <button onClick={handleBack} style={{ position: 'absolute', left: '20px', background: 'none', border: 'none', color: 'var(--foreground)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
        <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{t('editChar.header')}</span>
      </header>

      <main className="content" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        
        {/* Profile Image */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div 
            onClick={() => fileInputRef.current?.click()}
            style={{ 
              width: '120px', height: '120px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', 
              display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
              overflow: 'hidden', position: 'relative', border: '2px dashed var(--border-color)'
            }}
          >
            {imageUrl ? (
              <Image src={imageUrl} alt="preview" fill style={{ objectFit: 'cover' }} />
            ) : (
              <Camera size={32} color="var(--gray-500)" />
            )}
          </div>
          <p style={{ marginTop: '10px', fontSize: '16px', color: 'var(--text-muted)' }}>{t('image.touchUpload')}</p>
          <p style={{ marginTop: '4px', fontSize: '14px', color: '#ff4d4f', fontWeight: 'bold' }}>{t('image.noAI')}</p>
          <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageChange} style={{ display: 'none' }} />
        </div>

        {/* Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>{t('editChar.name')}</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{name.length}/10</span>
            </div>
            <input 
              type="text" value={name} onChange={e => setName(e.target.value.slice(0, 10))}
              placeholder={t('editChar.namePh')}
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1.05rem', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>{t('editChar.gender')}</label>
            </div>
            <GenderSelect value={gender} onChange={setGender} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>{t('editChar.feeling')}</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{feeling.length}/300</span>
            </div>
            <textarea 
              value={feeling} onChange={e => setFeeling(e.target.value.slice(0, 300))}
              placeholder={t('editChar.feelingPh')}
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '80px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>{t('editChar.title')}</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{title.length}/300</span>
            </div>
            <textarea 
              value={title} onChange={e => setTitle(e.target.value.slice(0, 300))}
              placeholder={t('editChar.titlePh')}
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '80px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>{t('editChar.example')}</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{exampleChat.length}/300</span>
            </div>
            <div style={{ position: 'relative' }}>
              <textarea 
                value={exampleChat} onChange={e => setExampleChat(e.target.value.slice(0, 300))}
                placeholder={t('editChar.examplePh')}
                style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '120px' }}
              />
              <button 
                onClick={insertQuotes}
                style={{ position: 'absolute', bottom: '15px', left: '15px', padding: '6px 12px', backgroundColor: 'var(--gray-100)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--foreground)', cursor: 'pointer' }}
              >
                {t('onboarding.char.addQuotes')}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>{t('editChar.negative')}</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{negative.length}/300</span>
            </div>
            <textarea 
              value={negative} onChange={e => setNegative(e.target.value.slice(0, 300))}
              placeholder={t('editChar.negativePh')}
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '80px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>{t('editChar.worldview')}</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{worldview.length}/500</span>
            </div>
            <textarea 
              value={worldview} onChange={e => setWorldview(e.target.value.slice(0, 500))}
              placeholder={t('editChar.worldviewPh')}
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '80px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>{t('editChar.extra')}</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{extra.length}/500</span>
            </div>
            <textarea 
              value={extra} onChange={e => setExtra(e.target.value.slice(0, 500))}
              placeholder={t('editChar.extraPh')}
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '80px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>{t('editChar.narrative')}</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{narrative.length}/700</span>
            </div>
            <div style={{ position: 'relative' }}>
              <textarea 
                ref={narrativeRef}
                value={narrative} onChange={e => setNarrative(e.target.value.slice(0, 700))}
                placeholder={t('editChar.narrativePh')}
                style={{ width: '100%', padding: '15px', paddingBottom: '50px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '120px' }}
              />
              <div style={{ position: 'absolute', bottom: '15px', left: '15px', display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => insertVariable('{캐릭터}')}
                  style={{ padding: '6px 12px', backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                >
                  {t('onboarding.narrative.charVar')}
                </button>
                <button 
                  onClick={() => insertVariable('{유저}')}
                  style={{ padding: '6px 12px', backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                >
                  {t('onboarding.narrative.userVar')}
                </button>
              </div>
            </div>
          </div>

        </div>

      </main>

      {/* Pinned Bottom Button */}
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px', padding: '5px 20px 15px', backgroundColor: 'white', borderTop: '1px solid var(--border-color)', zIndex: 100 }}>
        <button 
          onClick={handleSave}
          disabled={!hasChanges || saving || !name.trim() || !gender || !feeling.trim() || !title.trim() || !exampleChat.trim() || !negative.trim()}
          className="btn-primary"
          style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        >
          {saving ? <Loader2 className="animate-spin" size={24} /> : t('common.save')}
        </button>
      </div>
      {showExitModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ backgroundColor: 'white', padding: '25px', borderRadius: '15px', width: '80%', maxWidth: '320px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <p style={{ fontSize: '1.1rem', fontWeight: 'bold', textAlign: 'center', margin: 0, lineHeight: 1.4 }}>{t('editChar.exitConfirm')}</p>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button 
                onClick={() => router.back()} 
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--gray-300)', color: 'var(--gray-800)', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {t('editChar.exitNo')}
              </button>
              <button 
                onClick={() => {
                  setShowExitModal(false);
                  handleSave();
                }} 
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}
