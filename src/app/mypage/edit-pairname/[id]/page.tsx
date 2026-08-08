"use client";

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getCharacterById, updatePairName, Character } from '@/lib/db';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { resolveStaticEntityId } from '@/lib/navigation';
import { clearUserCache } from '@/lib/appCache';
import { invalidateCharacterStore } from '@/store/useAppStore';

export default function EditPairName() {
  const router = useRouter();
  const params = useParams();
  const routeId = params.id as string;
  const { t } = useLocale();

  const [id, setId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [character, setCharacter] = useState<Character | null>(null);
  const [pairName, setPairName] = useState('');

  useEffect(() => {
    const fetchChar = async () => {
      const resolvedId = resolveStaticEntityId(routeId);
      setId(resolvedId);
      if (resolvedId) {
        const char = await getCharacterById(resolvedId);
        if (char) {
          setCharacter(char);
          if (char.pairName) setPairName(char.pairName);
        }
      }
      setLoading(false);
    };
    fetchChar();
  }, [routeId]);

  const handleSave = async () => {
    if (!id || !pairName.trim() || pairName.length > 10) return;
    setSaving(true);
    await updatePairName(id, pairName.trim());
    if (character?.userId) {
      clearUserCache(character.userId);
      invalidateCharacterStore(character.userId);
    }
    router.push('/mypage');
  };

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
        <style dangerouslySetInnerHTML={{__html: `@keyframes spin { 100% { transform: rotate(360deg); } }`}} />
      </div>
    );
  }

  return (
    <div className="app-container full-page" style={{ backgroundColor: 'white' }}>
      <header className="full-page-header">
        <button onClick={() => router.push('/mypage')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
      </header>

      <main className="content" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '30px', overflowY: 'auto' }}>
        <div style={{ marginTop: '20px' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '10px', color: 'var(--foreground)' }}>
            {t('editPair.title')}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
            {t('editPair.hint')}
          </p>

          <input 
            type="text" 
            placeholder={t('editPair.placeholder')} 
            value={pairName}
            onChange={(e) => setPairName(e.target.value.slice(0, 10))}
            className="input-field"
            style={{ width: '100%', padding: '16px', fontSize: '1.1rem', borderRadius: '15px' }}
          />
          <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--gray-500)', marginTop: '8px' }}>
            {pairName.length}/10
          </div>
        </div>
      </main>

      <footer className="full-page-footer">
        <button 
          onClick={handleSave}
          disabled={!pairName.trim() || saving}
          className="btn-primary"
          style={{ width: '100%', padding: '16px', fontSize: '1.1rem', marginTop: 0, borderRadius: '15px' }}
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </footer>

      <style dangerouslySetInnerHTML={{__html: `
        .input-field {
          width: 100%;
          padding: 15px;
          border: 1px solid var(--border-color);
          border-radius: 10px;
          font-size: 1rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .input-field:focus {
          border-color: var(--point-color);
        }
      `}} />
    </div>
  );
}
