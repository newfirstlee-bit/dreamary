"use client";

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCharacter, updateCharacter, Character } from '@/lib/db';
import { uploadImageToImgbb } from '@/lib/imgbb';
import { Loader2, ChevronLeft, Image as ImageIcon } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function HomeSettingsPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [character, setCharacter] = useState<Character | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const char = await getCharacter(params.id);
        setCharacter(char);
      } catch (err) {
        console.error("Failed to load character:", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [params.id]);

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !character) return;
    setUploadingBg(true);
    try {
      const url = await uploadImageToImgbb(e.target.files[0]);
      await updateCharacter(character.id, { homeBackgroundImage: url });
      setCharacter({ ...character, homeBackgroundImage: url });
      alert(t('homeSettings.bgSuccess'));
    } catch (err: any) {
      console.error(err);
      alert(`${t('homeSettings.bgFail')} (${err.message || err})`);
    } finally {
      setUploadingBg(false);
    }
  };

  const handleDDayChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!character) return;
    const date = new Date(e.target.value);
    const ts = date.getTime();
    await updateCharacter(character.id, { dDayStartDate: ts });
    setCharacter({ ...character, dDayStartDate: ts });
  };

  const handleThemeChange = async (theme: 'dark' | 'light') => {
    if (!character) return;
    await updateCharacter(character.id, { homeTheme: theme });
    setCharacter({ ...character, homeTheme: theme });
  };

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
        <style dangerouslySetInnerHTML={{__html: `@keyframes spin { 100% { transform: rotate(360deg); } }`}} />
      </div>
    );
  }

  if (!character) {
    return <div className="app-container">{t('homeSettings.loadFailed')}</div>;
  }

  return (
    <div className="app-container">
      <header className="header" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
        {t('homeSettings.homeTitle')}
      </header>
      
      <div className="content" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ padding: '20px', backgroundColor: 'var(--gray-50)', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 'bold', color: 'var(--foreground)', marginBottom: '5px' }}>{t('homeSettings.bgChange')}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('homeSettings.bgHint')}</div>
          </div>
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingBg}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', backgroundColor: 'var(--point-color)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            {uploadingBg ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
            {uploadingBg ? t('common.uploading') : t('common.upload')}
          </button>
          <input type="file" accept="image/*" ref={fileInputRef} onChange={handleBgUpload} style={{ display: 'none' }} />
        </div>

        <div style={{ padding: '20px', backgroundColor: 'var(--gray-50)', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 'bold', color: 'var(--foreground)', marginBottom: '5px' }}>{t('homeSettings.dDay')}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('homeSettings.dDayHint').replace('{name}', character.pairName || character.name)}</div>
          </div>
          <input 
            type="date" 
            value={character.dDayStartDate ? new Date(character.dDayStartDate).toISOString().split('T')[0] : new Date(character.createdAt || Date.now()).toISOString().split('T')[0]}
            onChange={handleDDayChange}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', outline: 'none', fontFamily: 'inherit' }}
          />
        </div>

        <div style={{ padding: '20px', backgroundColor: 'var(--gray-50)', borderRadius: '15px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <div style={{ fontWeight: 'bold', color: 'var(--foreground)', marginBottom: '5px' }}>{t('homeSettings.themeTitle')}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('homeSettings.themeHint')}</div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => handleThemeChange('dark')}
              style={{
                flex: 1, padding: '12px', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s',
                backgroundColor: (character.homeTheme || 'dark') === 'dark' ? 'var(--gray-900)' : 'white',
                color: (character.homeTheme || 'dark') === 'dark' ? 'white' : 'var(--gray-600)',
                border: (character.homeTheme || 'dark') === 'dark' ? 'none' : '1px solid var(--border-color)'
              }}
            >
              {t('homeSettings.themeDark')}
            </button>
            <button
              onClick={() => handleThemeChange('light')}
              style={{
                flex: 1, padding: '12px', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s',
                backgroundColor: character.homeTheme === 'light' ? 'white' : 'transparent',
                color: character.homeTheme === 'light' ? 'var(--gray-900)' : 'var(--gray-600)',
                border: character.homeTheme === 'light' ? '2px solid var(--gray-900)' : '1px solid var(--border-color)'
              }}
            >
              {t('homeSettings.themeLight')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
