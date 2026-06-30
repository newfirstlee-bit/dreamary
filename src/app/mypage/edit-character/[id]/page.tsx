"use client";

import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';
import { getUserId } from '@/lib/auth';
import { getCharacterById, saveCharacter, Character } from '@/lib/db';
import { uploadImageToImgbb } from '@/lib/imgbb';
import { Loader2, ChevronLeft, Camera, User } from 'lucide-react';
import { trackEvent } from '@/lib/mixpanel';

export default function EditCharacterPage() {
  const router = useRouter();
  const params = useParams();
  const charId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [initialChar, setInitialChar] = useState<Character | null>(null);
  const [showExitModal, setShowExitModal] = useState(false);
  
  const [name, setName] = useState('');
  const [feeling, setFeeling] = useState('');
  const [title, setTitle] = useState('');
  const [exampleChat, setExampleChat] = useState('');
  const [negative, setNegative] = useState('');
  const [extra, setExtra] = useState('');
  
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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
        setFeeling(char.feeling || '');
        setTitle(char.title || '');
        setExampleChat(char.exampleChat || '');
        setNegative(char.negative || '');
        setExtra(char.extra || '');
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

  const hasChanges = initialChar !== null && (
    name !== (initialChar.name || '') ||
    feeling !== (initialChar.feeling || '') ||
    title !== (initialChar.title || '') ||
    exampleChat !== (initialChar.exampleChat || '') ||
    negative !== (initialChar.negative || '') ||
    extra !== (initialChar.extra || '') ||
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
        id: charId,
        userId,
        name: name.trim(),
        feeling: feeling.trim(),
        title: title.trim(),
        exampleChat: exampleChat.trim(),
        negative: negative.trim(),
        extra: extra.trim(),
        createdAt: initialChar.createdAt || Date.now()
      };
      
      if (finalImgUrl) {
        updatedChar.image = finalImgUrl;
        if (!initialChar.homeBackgroundImage && initialChar.image) {
          updatedChar.homeBackgroundImage = initialChar.image;
        }
      }

      await saveCharacter(updatedChar);
      trackEvent('Settings_Changed', { type: 'character_profile', character_id: updatedChar.id });
      router.push('/mypage');
    } catch (err) {
      console.error(err);
      alert('저장 중 오류가 발생했습니다.');
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
        <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>캐릭터 수정</span>
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
          <p style={{ marginTop: '10px', fontSize: '16px', color: 'var(--text-muted)' }}>터치하여 사진 업로드</p>
          <p style={{ marginTop: '4px', fontSize: '14px', color: '#ff4d4f', fontWeight: 'bold' }}>절대로 생성형 AI학습에 사용되지 않습니다</p>
          <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageChange} style={{ display: 'none' }} />
        </div>

        {/* Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>캐릭터 이름 (최대 10자)</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{name.length}/10</span>
            </div>
            <input 
              type="text" value={name} onChange={e => setName(e.target.value.slice(0, 10))}
              placeholder="이름을 입력해주세요"
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1.05rem', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>캐릭터가 나에게 느끼는 감정 (최대 300자)</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{feeling.length}/300</span>
            </div>
            <textarea 
              value={feeling} onChange={e => setFeeling(e.target.value.slice(0, 300))}
              placeholder="예: 은인이자 동료. 썸타는 것 같은데 안사귐"
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '80px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>캐릭터가 나를 부르는 호칭 (최대 300자)</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{title.length}/300</span>
            </div>
            <textarea 
              value={title} onChange={e => setTitle(e.target.value.slice(0, 300))}
              placeholder="이름, 당신, 야, 등"
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '80px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>캐릭터 대화 예시 (최대 300자)</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{exampleChat.length}/300</span>
            </div>
            <div style={{ position: 'relative' }}>
              <textarea 
                value={exampleChat} onChange={e => setExampleChat(e.target.value.slice(0, 300))}
                placeholder={'최소 5문장 이상 작성해주세요.\n""로 문장을 구분해주세요.'}
                style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '120px' }}
              />
              <button 
                onClick={insertQuotes}
                style={{ position: 'absolute', bottom: '15px', left: '15px', padding: '6px 12px', backgroundColor: 'var(--gray-100)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--foreground)', cursor: 'pointer' }}
              >
                "" 추가
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>하지 말아야 할 행동 (네거티브) (최대 300자)</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{negative.length}/300</span>
            </div>
            <textarea 
              value={negative} onChange={e => setNegative(e.target.value.slice(0, 300))}
              placeholder="절대 하면 안 되는 말이나 행동"
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '80px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>추가 설정 (최대 300자)</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{extra.length}/300</span>
            </div>
            <textarea 
              value={extra} onChange={e => setExtra(e.target.value.slice(0, 300))}
              placeholder="캐릭터의 추가 설정이 있나요? (선택)"
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '80px' }}
            />
          </div>

        </div>


      </main>

            {/* Pinned Bottom Button */}
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px', padding: '5px 20px 15px', backgroundColor: 'white', borderTop: '1px solid var(--border-color)', zIndex: 100 }}>
        <button 
          onClick={handleSave}
          disabled={!hasChanges || saving || !name.trim() || !feeling.trim() || !title.trim() || !exampleChat.trim() || !negative.trim()}
          className="btn-primary"
          style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        >
          {saving ? <Loader2 className="animate-spin" size={24} /> : '저장하기'}
        </button>
      </div>
      {showExitModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ backgroundColor: 'white', padding: '25px', borderRadius: '15px', width: '80%', maxWidth: '320px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <p style={{ fontSize: '1.1rem', fontWeight: 'bold', textAlign: 'center', margin: 0, lineHeight: 1.4 }}>변경한 내용을 저장할까요?</p>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button 
                onClick={() => router.back()} 
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--gray-300)', color: 'var(--gray-800)', fontWeight: 'bold', cursor: 'pointer' }}
              >
                아니오
              </button>
              <button 
                onClick={() => {
                  setShowExitModal(false);
                  handleSave();
                }} 
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
              >
                저장하기
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
