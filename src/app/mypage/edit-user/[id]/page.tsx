"use client";

import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { getUserId } from '@/lib/auth';
import { getUserProfile, saveUserProfile, UserProfile } from '@/lib/db';
import { uploadImageToImgbb } from '@/lib/imgbb';
import { Loader2, ChevronLeft, Camera, User } from 'lucide-react';

export default function EditUserPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [name, setName] = useState('');
  const [feeling, setFeeling] = useState('');
  const [extra, setExtra] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const profile = await getUserProfile(params.id);
        
        if (profile) {
          setName(profile.name || '');
          setFeeling(profile.feeling || '');
          setExtra(profile.extra || '');
          setImageUrl(profile.image || '');
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [params.id]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setImageUrl(URL.createObjectURL(file));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let finalImgUrl = imageUrl;
      
      if (imageFile) {
        finalImgUrl = await uploadImageToImgbb(imageFile);
      }

      const updatedUser: UserProfile = {
        id: params.id,
        name: name.trim() || '유저',
        feeling: feeling.trim(),
        extra: extra.trim(),
        createdAt: Date.now()
      };
      
      if (finalImgUrl) {
        updatedUser.image = finalImgUrl;
      }

      await saveUserProfile(updatedUser);
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
        <button onClick={() => router.back()} style={{ position: 'absolute', left: '20px', background: 'none', border: 'none', color: 'var(--foreground)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
        <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>유저 프로필 수정</span>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>이름 (최대 10자)</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{name.length}/10</span>
            </div>
            <input 
              type="text" value={name} onChange={e => setName(e.target.value.slice(0, 10))}
              placeholder="내 이름/드림주 이름을 알려주세요"
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1.05rem', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>캐릭터에게 느끼는 감정 (최대 300자)</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{feeling.length}/300</span>
            </div>
            <textarea 
              value={feeling} onChange={e => setFeeling(e.target.value.slice(0, 300))}
              placeholder="예: 은인이자 동료. 썸타는 것 같은데 안사귐"
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '100px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold' }}>추가 설정 (최대 300자)</label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{extra.length}/300</span>
            </div>
            <textarea 
              value={extra} onChange={e => setExtra(e.target.value.slice(0, 300))}
              placeholder="유저의 추가 설정이 있나요? (선택)"
              style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', resize: 'none', minHeight: '100px' }}
            />
          </div>

        </div>


      </main>

            {/* Pinned Bottom Button */}
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px', padding: '5px 20px 15px', backgroundColor: 'white', borderTop: '1px solid var(--border-color)', zIndex: 100 }}>
        <button 
          onClick={handleSave}
          disabled={saving || !name.trim() || !feeling.trim()}
          className="btn-primary"
          style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        >
          {saving ? <Loader2 className="animate-spin" size={24} /> : '저장하기'}
        </button>
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}
