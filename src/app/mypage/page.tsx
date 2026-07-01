"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { getUserId } from '@/lib/auth';
import { getCharactersByUser, getUserProfile, Character, UserProfile, deleteCharacter } from '@/lib/db';
import { Loader2, Settings, User, Plus, Heart, X } from 'lucide-react';
import Link from 'next/link';

export default function MyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  const [characters, setCharacters] = useState<Character[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile | null>>({});
  const [userId, setUserId] = useState<string>('');
  
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [deleteConfirmChar, setDeleteConfirmChar] = useState<Character | null>(null);

  const truncate = (name: string) => name.length > 5 ? name.slice(0, 5) + '...' : name;

  const handleDeletePair = async () => {
    if (!deleteConfirmChar) return;
    setLoading(true);
    try {
      await deleteCharacter(deleteConfirmChar.id);
      setCharacters(prev => prev.filter(c => c.id !== deleteConfirmChar.id));
      const newProfiles = { ...userProfiles };
      delete newProfiles[deleteConfirmChar.id];
      setUserProfiles(newProfiles);
      setDeleteConfirmChar(null);
    } catch (error) {
      console.error(error);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const uid = getUserId();
        setUserId(uid);
        const chars = await getCharactersByUser(uid);

        if (chars.length === 0) {
          router.replace('/onboarding');
          return;
        }

        const profiles = await Promise.all(chars.map(c => getUserProfile(c.id)));
        const profileMap: Record<string, UserProfile | null> = {};
        chars.forEach((c, i) => {
          profileMap[c.id] = profiles[i];
        });

        setCharacters(chars);
        setUserProfiles(profileMap);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router]);

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="app-container diary-bg" style={{ paddingBottom: '65px' }}>
      <header className="header" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
        마이페이지
      </header>

      <main className="content" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        {/* Pairs Section */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 style={{ fontSize: '1.2rem', color: 'var(--foreground)' }}>내 페어 <span style={{ color: 'var(--gray-500)', fontSize: '1rem', fontWeight: 'normal' }}>({characters.length}/10)</span></h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {characters.map(char => {
              const userProfile = userProfiles[char.id];
              return (
              <div key={char.id} style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1, overflow: 'hidden', position: 'relative' }}>
                  {/* Pair Images */}
                  <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ width: '60px', height: '60px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', border: '2px solid white', zIndex: 2, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      {char.image ? <Image src={char.image} alt="char" fill style={{ objectFit: 'cover' }} /> : <User size={24} color="var(--gray-500)" />}
                    </div>
                    <div style={{ width: '60px', height: '60px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', border: '2px solid white', marginLeft: '-20px', zIndex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      {userProfile?.image ? <Image src={userProfile.image} alt="user" fill style={{ objectFit: 'cover' }} /> : <User size={24} color="var(--gray-500)" />}
                    </div>
                  </div>
                  {/* Pair Names */}
                  <div style={{ flex: 1, overflow: 'hidden', position: 'relative', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    {char.pairName ? (
                      <h3 style={{ fontSize: '1.1rem', color: 'var(--foreground)', fontWeight: 'bold' }}>
                        {char.pairName}
                      </h3>
                    ) : (
                      <h3 style={{ fontSize: '1.1rem', color: 'var(--foreground)' }}>
                        <span style={{ fontWeight: 'bold' }}>{char.name}</span>
                        <span style={{ color: 'var(--gray-400)', margin: '0 6px' }}>-</span>
                        <span style={{ color: 'var(--gray-700)', fontWeight: 500 }}>{userProfile?.name || '유저'}</span>
                      </h3>
                    )}
                  </div>
                </div>

                {/* Edit Button */}
                <button 
                  onClick={() => setSelectedChar(char)}
                  style={{ padding: '8px 16px', backgroundColor: 'var(--gray-100)', border: 'none', borderRadius: '8px', color: 'var(--gray-700)', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem', flexShrink: 0 }}
                >
                  수정
                </button>
              </div>
            )})}

            {/* + 새 페어 만들기 버튼 */}
            <button 
              onClick={() => {
                if (characters.length >= 10) {
                  alert("페어는 최대 10개까지만 등록할 수 있습니다.");
                  return;
                }
                router.push('/onboarding');
              }}
              style={{ 
                width: '100%', 
                padding: '16px', 
                backgroundColor: 'white', 
                border: '1px solid var(--point-color)', 
                borderRadius: '15px', 
                color: 'var(--point-color)', 
                fontWeight: 'bold', 
                fontSize: '1rem',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '8px',
                marginTop: '5px'
              }}
            >
              <Plus size={20} /> 새 페어 만들기
            </button>
          </div>
        </section>

        {/* My Info Section */}
        <section style={{ marginTop: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 style={{ fontSize: '1.2rem', color: 'var(--foreground)' }}>내 정보</h2>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', border: '1px solid var(--border-color)' }}>
            <div style={{ marginBottom: '15px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--gray-500)', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>고유 식별자 (UUID)</span>
              <span style={{ fontSize: '0.9rem', color: 'var(--foreground)', wordBreak: 'break-all' }}>{userId}</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', lineHeight: '1.5' }}>
              현재 UUID 기반으로 데이터가 저장되고 있어, 다른 기기/브라우저로 접속하거나 쿠키를 삭제하시면 대화 데이터가 초기화될 수 있습니다. 추후 로그인 기능이 업데이트되면 데이터를 더 안전하게 보관하실 수 있습니다.
            </p>
          </div>
        </section>



      </main>

      {/* Bottom Sheet */}
      {selectedChar && (
        <>
          <div 
            onClick={() => setSelectedChar(null)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }} 
          />
          <div style={{ 
            position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px', 
            backgroundColor: 'white', borderTopLeftRadius: '20px', borderTopRightRadius: '20px', padding: '25px 20px 40px', zIndex: 2001,
            display: 'flex', flexDirection: 'column', gap: '15px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '10px' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>어떤 캐릭터를 수정할까요?</h2>
            </div>
            
            <button 
              onClick={() => {
                router.push(`/mypage/edit-pairname/${selectedChar.id}`);
                setSelectedChar(null);
              }}
              style={{ height: '68px', padding: '16px', backgroundColor: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', color: 'var(--foreground)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px' }}
            >
              페어명 설정
            </button>
            <button 
              onClick={() => {
                router.push(`/mypage/edit-character/${selectedChar.id}`);
                setSelectedChar(null);
              }}
              style={{ height: '68px', padding: '16px', backgroundColor: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', color: 'var(--foreground)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px' }}
            >
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                {selectedChar.image ? <Image src={selectedChar.image} alt="char" fill style={{ objectFit: 'cover' }} /> : <User size={20} color="var(--gray-500)" />}
              </div>
              {selectedChar.name}
            </button>
            <button 
              onClick={() => {
                router.push(`/mypage/edit-user/${selectedChar.id}`);
                setSelectedChar(null);
              }}
              style={{ height: '68px', padding: '16px', backgroundColor: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', color: 'var(--foreground)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px' }}
            >
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                {userProfiles[selectedChar.id]?.image ? <Image src={userProfiles[selectedChar.id]?.image} alt="user" fill style={{ objectFit: 'cover' }} /> : <User size={20} color="var(--gray-500)" />}
              </div>
              {userProfiles[selectedChar.id]?.name || '유저'}
            </button>
            <button 
              onClick={() => {
                setDeleteConfirmChar(selectedChar);
                setSelectedChar(null);
              }}
              style={{ height: '68px', padding: '16px', backgroundColor: '#FFF0F0', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', color: 'red', cursor: 'pointer', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              페어 삭제
            </button>
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmChar && (
        <>
          <div 
            onClick={() => setDeleteConfirmChar(null)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3000 }} 
          />
          <div style={{ 
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '90%', maxWidth: '340px', 
            backgroundColor: 'white', borderRadius: '20px', padding: '30px 20px 20px', zIndex: 3001,
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '10px' }}>
              {deleteConfirmChar.pairName || deleteConfirmChar.name}을(를) 삭제할까요?
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--gray-500)', marginBottom: '25px' }}>
              삭제한 정보는 복구할 수 없어요.
            </p>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button 
                onClick={handleDeletePair}
                style={{ flex: 1, padding: '15px', backgroundColor: '#FF3B30', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
              >
                삭제하기
              </button>
              <button 
                onClick={() => setDeleteConfirmChar(null)}
                style={{ flex: 1, padding: '15px', backgroundColor: 'var(--gray-100)', color: 'var(--foreground)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
              >
                취소
              </button>
            </div>
          </div>
        </>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}
