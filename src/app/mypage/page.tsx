"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { getUserId } from '@/lib/auth';
import { getCharactersByUser, getUserProfile, Character, UserProfile, deleteCharacter } from '@/lib/db';
import { Loader2, Settings, User, Plus, Heart, X, Copy, LogIn, Key, Download, LogOut, Eye, EyeOff, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useLocale } from '@/lib/i18n';
import { useAuth } from '@/components/AuthContext';
import { auth, db } from '@/lib/firebase';
import { signOut, signInWithEmailAndPassword, updatePassword } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

export default function MyPage() {
  const router = useRouter();
  const { t, locale, setLocale } = useLocale();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  
  const [characters, setCharacters] = useState<Character[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile | null>>({});
  const [userId, setUserId] = useState<string>('');
  
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [deleteConfirmChar, setDeleteConfirmChar] = useState<Character | null>(null);

  // 백업/이관 상태
  const [backupCode, setBackupCode] = useState<string | null>(null);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showMigrateModal, setShowMigrateModal] = useState(false);
  const [inputBackupCode, setInputBackupCode] = useState('');
  const [isMigrating, setIsMigrating] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // 계정 정보
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [showPasswordConfirmModal, setShowPasswordConfirmModal] = useState(false);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const [showEditInfoModal, setShowEditInfoModal] = useState(false);
  const [editEmail, setEditEmail] = useState('');
  const [editGender, setEditGender] = useState('');
  const [editBirthdate, setEditBirthdate] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editPasswordConfirm, setEditPasswordConfirm] = useState('');
  const [editPasswordError, setEditPasswordError] = useState('');
  const [isSavingInfo, setIsSavingInfo] = useState(false);

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


        const profiles = await Promise.all(chars.map(c => getUserProfile(c.id)));
        const profileMap: Record<string, UserProfile | null> = {};
        chars.forEach((c, i) => {
          profileMap[c.id] = profiles[i];
        });

        setCharacters(chars);
        setUserProfiles(profileMap);

        if (user) {
          try {
            const accountDoc = await getDoc(doc(db, 'accounts', user.uid));
            if (accountDoc.exists()) {
              setAccountInfo(accountDoc.data());
            }
          } catch (e) {
            console.error("Failed to load account info", e);
          }
        }
        
        // 백업코드 발급 내역 복원 (비로그인 시)
        if (!user) {
          const storedCode = localStorage.getItem('backupCode');
          const storedTime = localStorage.getItem('backupCodeTime');
          if (storedCode && storedTime && Date.now() - Number(storedTime) < 24 * 60 * 60 * 1000) {
            setBackupCode(storedCode);
          } else {
            localStorage.removeItem('backupCode');
            localStorage.removeItem('backupCodeTime');
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    // user 상태 변경 시 재조회되도록 의존성 추가
    if (user !== undefined) init();
  }, [router, user]);

  const handleGenerateBackupCode = async () => {
    if (backupCode) {
      setShowBackupModal(true);
      return;
    }
    try {
      const res = await fetch('/api/backup/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUUID: userId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setBackupCode(data.code);
      localStorage.setItem('backupCode', data.code);
      localStorage.setItem('backupCodeTime', Date.now().toString());
      setShowBackupModal(true);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleMigrate = async () => {
    if (!inputBackupCode) return;
    setIsMigrating(true);
    try {
      const res = await fetch('/api/backup/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inputBackupCode, uid: user?.uid })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      alert(t('mypage.migrateSuccess'));
      localStorage.setItem('migration_completed', 'true');
      setShowMigrateModal(false);
      // 홈 화면으로 이동
      router.push('/');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsMigrating(false);
    }
  };

  const handleVerifyPassword = async () => {
    if (!verifyPassword) return;
    setIsVerifying(true);
    setVerifyError('');
    try {
      const pseudoEmail = `${accountInfo.id}@dreamary.internal`;
      await signInWithEmailAndPassword(auth, pseudoEmail, verifyPassword);
      // Success
      setEditEmail(accountInfo.email || '');
      setEditGender(accountInfo.gender || '');
      setEditBirthdate(accountInfo.birthdate || '');
      setShowPasswordConfirmModal(false);
      setShowEditInfoModal(true);
      setVerifyPassword('');
      setEditPassword('');
      setEditPasswordConfirm('');
      setEditPasswordError('');
    } catch (err) {
      console.error(err);
      setVerifyError('비밀번호가 일치하지 않습니다.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSaveInfo = async () => {
    if (!user || !accountInfo) return;
    if (editPassword) {
      if (editPassword !== editPasswordConfirm) {
        setEditPasswordError('비밀번호가 일치하지 않습니다.');
        return;
      }
      if (editPassword.length < 6) {
        setEditPasswordError('비밀번호는 6자리 이상이어야 합니다.');
        return;
      }
    }
    
    setIsSavingInfo(true);
    try {
      if (editPassword) {
        await updatePassword(user, editPassword);
      }
      await updateDoc(doc(db, 'accounts', user.uid), {
        email: editEmail,
        gender: editGender,
        birthdate: editBirthdate,
      });
      setAccountInfo({ ...accountInfo, email: editEmail, gender: editGender, birthdate: editBirthdate });
      alert('정보가 수정되었습니다.');
      setShowEditInfoModal(false);
    } catch (err) {
      console.error(err);
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setIsSavingInfo(false);
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
    <div className="app-container diary-bg" style={{ paddingBottom: '65px' }}>
      <header className="header" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{t('mypage.header')}</span>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as any)}
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '6px 24px 6px 10px',
            backgroundColor: 'white',
            fontSize: '0.9rem',
            color: 'var(--foreground)',
            fontWeight: 'bold',
            outline: 'none',
            WebkitAppearance: 'none',
            appearance: 'none',
            background: 'white url("data:image/svg+xml;utf8,<svg fill=\'%238E8E93\' height=\'20\' viewBox=\'0 0 24 24\' width=\'20\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M7 10l5 5 5-5z\'/><path d=\'M0 0h24v24H0z\' fill=\'none\'/></svg>") no-repeat right 4px center',
            cursor: 'pointer'
          }}
        >
          <option value="ko">한국어</option>
          <option value="ja">日本語</option>
        </select>
      </header>

      <main className="content" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        {/* Account Section (Top if logged in) */}
        {user && accountInfo && (
          <section>
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--gray-800)', fontSize: '1.1rem', fontWeight: 'bold' }}>{accountInfo.id}</span>
                <button 
                  onClick={() => setShowPasswordConfirmModal(true)}
                  style={{ padding: '8px 16px', backgroundColor: 'var(--gray-100)', border: 'none', borderRadius: '8px', color: 'var(--gray-700)', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}
                >
                  수정
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Pairs Section */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 style={{ fontSize: '1.2rem', color: 'var(--foreground)' }}>{t('mypage.myPairs')} <span style={{ color: 'var(--gray-500)', fontSize: '1rem', fontWeight: 'normal' }}>({characters.length}/10)</span></h2>
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
                        <span style={{ color: 'var(--gray-700)', fontWeight: 500 }}>{userProfile?.name || t('common.user')}</span>
                      </h3>
                    )}
                  </div>
                </div>

                {/* Edit Button */}
                <button 
                  onClick={() => setSelectedChar(char)}
                  style={{ padding: '8px 16px', backgroundColor: 'var(--gray-100)', border: 'none', borderRadius: '8px', color: 'var(--gray-700)', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem', flexShrink: 0 }}
                >
                  {t('common.edit')}
                </button>
              </div>
            )})}

            {/* + 새 페어 만들기 버튼 */}
            <button 
              onClick={() => {
                if (characters.length >= 10) return;
                router.push('/onboarding?skip=true');
              }}
              style={{ 
                width: '100%', 
                padding: '16px', 
                backgroundColor: characters.length >= 10 ? 'var(--gray-200)' : 'white', 
                border: characters.length >= 10 ? '1px solid var(--gray-300)' : '1px solid var(--point-color)', 
                borderRadius: '15px', 
                color: characters.length >= 10 ? 'var(--gray-500)' : 'var(--point-color)', 
                fontWeight: 'bold', 
                fontSize: '1rem',
                cursor: characters.length >= 10 ? 'not-allowed' : 'pointer',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '8px',
                marginTop: '-5px'
              }}
            >
              <Plus size={20} /> {t('mypage.newPair')}
            </button>
          </div>
        </section>

        {/* My Info Section (UUID) - Only for non-logged-in users */}
        {!user && (
          <section style={{ marginTop: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 style={{ fontSize: '1.2rem', color: 'var(--foreground)' }}>{t('mypage.myInfo')}</h2>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* UUID Info */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '1rem', color: 'var(--gray-800)', fontWeight: 'bold' }}>{t('mypage.uuid')}</span>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(userId);
                    alert(t('common.copied'));
                  }} 
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--gray-100)', border: 'none', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--gray-700)', fontWeight: 'bold' }}
                >
                  <Copy size={14} /> {t('common.copy')}
                </button>
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--gray-600)', wordBreak: 'break-all', fontFamily: 'monospace', marginBottom: '10px' }}>
                {userId}
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', lineHeight: '1.5' }}>
                {t('mypage.uuidDesc')}
              </p>
            </div>
          </div>
          </section>
        )}

        {/* 계정/이관 관련 섹션 (비로그인) */}
        {!user && (
          <section style={{ marginTop: '10px' }}>
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <button 
                onClick={() => router.push('/login')}
                style={{ width: '100%', padding: '15px', borderRadius: '12px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', fontWeight: 'bold', fontSize: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
              >
                <LogIn size={20} /> {t('mypage.loginRegisterBtn')}
              </button>
              <button 
                onClick={handleGenerateBackupCode}
                style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid var(--point-color)', backgroundColor: 'white', color: 'var(--point-color)', fontWeight: 'bold', fontSize: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
              >
                <Download size={20} /> {t('mypage.backupChatBtn')}
              </button>
            </div>
          </section>
        )}

        {user && (
          <button 
            onClick={() => setShowMigrateModal(true)}
            style={{ width: '100%', padding: '15px', borderRadius: '12px', border: 'none', backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)', fontWeight: 'bold', fontSize: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '10px' }}
          >
            {t('mypage.enterBackupCode')}
          </button>
        )}

        {user && (
          <button 
            onClick={async () => {
              await signOut(auth);
              window.location.reload();
            }}
            style={{ 
              alignSelf: 'center', 
              color: 'var(--gray-600)', 
              fontSize: '0.9rem', 
              background: 'none', 
              border: 'none', 
              cursor: 'pointer', 
              marginTop: '10px',
              textDecoration: 'underline'
            }}
          >
            로그아웃
          </button>
        )}

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
              <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{t('mypage.whichEdit')}</h2>
            </div>
            
            <button 
              onClick={() => {
                router.push(`/mypage/edit-pairname/${selectedChar.id}`);
                setSelectedChar(null);
              }}
              style={{ height: '68px', padding: '16px', backgroundColor: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', color: 'var(--foreground)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px' }}
            >
              {t('mypage.pairName')}
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
              {userProfiles[selectedChar.id]?.name || t('common.user')}
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setDeleteConfirmChar(selectedChar);
                setSelectedChar(null);
              }}
              style={{ height: '68px', padding: '16px', backgroundColor: '#FFF0F0', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', color: 'red', cursor: 'pointer', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              {t('mypage.deletePair')}
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
              {t('mypage.deleteConfirm').replace('{name}', deleteConfirmChar.pairName || deleteConfirmChar.name)}
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--gray-500)', marginBottom: '25px' }}>
              {t('mypage.deleteWarn')}
            </p>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button 
                onClick={handleDeletePair}
                style={{ flex: 1, padding: '15px', backgroundColor: '#FF3B30', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {t('common.delete')}
              </button>
              <button 
                onClick={() => setDeleteConfirmChar(null)}
                style={{ flex: 1, padding: '15px', backgroundColor: 'var(--gray-100)', color: 'var(--foreground)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* 백업 코드 발급 모달 */}
      {showBackupModal && (
        <>
          <div 
            onClick={() => setShowBackupModal(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3000 }} 
          />
          <div style={{ 
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '90%', maxWidth: '340px', 
            backgroundColor: 'white', borderRadius: '20px', padding: '30px 20px 20px', zIndex: 3001,
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '10px' }}>
              {t('mypage.backupCreated')}
            </h2>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', letterSpacing: '2px', color: 'var(--point-color)', margin: '20px 0' }}>
              {backupCode}
            </div>
            <p style={{ fontSize: '0.9rem', color: 'var(--gray-500)', marginBottom: '25px', lineHeight: '1.5' }} dangerouslySetInnerHTML={{ __html: t('mypage.backupGuide') }}>
            </p>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(backupCode || '');
                setCopySuccess(true);
                setTimeout(() => setCopySuccess(false), 2000);
              }}
              style={{ width: '100%', padding: '15px', backgroundColor: copySuccess ? 'var(--gray-300)' : 'var(--gray-100)', color: 'var(--foreground)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', marginBottom: '10px', transition: 'all 0.2s' }}
            >
              {copySuccess ? t('common.copied') : t('mypage.copyCodeBtn')}
            </button>
            <button 
              onClick={() => setShowBackupModal(false)}
              style={{ width: '100%', padding: '15px', backgroundColor: 'var(--point-color)', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {t('common.confirm')}
            </button>
          </div>
        </>
      )}

      {/* 이관 모달 */}
      {showMigrateModal && (
        <>
          <div 
            onClick={() => setShowMigrateModal(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3000 }} 
          />
          <div style={{ 
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '90%', maxWidth: '340px', 
            backgroundColor: 'white', borderRadius: '20px', padding: '30px 20px 20px', zIndex: 3001,
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '10px' }}>
              {t('mypage.migrateTitle')}
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--gray-500)', marginBottom: '25px', lineHeight: '1.5' }}>
              {t('mypage.migrateGuide')}
            </p>
            <input 
              className="placeholder-regular"
              type="text"
              value={inputBackupCode}
              onChange={(e) => setInputBackupCode(e.target.value.toUpperCase())}
              placeholder={t('mypage.backupCodePh')}
              maxLength={8}
              style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1.1rem', textAlign: 'center', letterSpacing: '2px', fontWeight: 'bold', marginBottom: '20px', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button 
                onClick={() => setShowMigrateModal(false)}
                style={{ flex: 1, padding: '15px', backgroundColor: 'var(--gray-100)', color: 'var(--foreground)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {t('common.cancel')}
              </button>
              <button 
                onClick={handleMigrate}
                disabled={isMigrating || inputBackupCode.length < 8}
                style={{ flex: 1, padding: '15px', backgroundColor: isMigrating || inputBackupCode.length < 8 ? 'var(--gray-300)' : 'var(--point-color)', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', cursor: isMigrating || inputBackupCode.length < 8 ? 'not-allowed' : 'pointer' }}
              >
                {isMigrating ? t('mypage.migrating') : t('mypage.doMigrate')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* 비밀번호 확인 모달 (풀스크린) */}
      {showPasswordConfirmModal && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'white', zIndex: 4000,
          display: 'flex', flexDirection: 'column'
        }}>
          <header style={{ display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid var(--border-color)' }}>
            <button onClick={() => setShowPasswordConfirmModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center', marginLeft: '-5px' }}>
              <ChevronLeft size={28} color="var(--gray-800)" />
            </button>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginLeft: '10px' }}>비밀번호 확인</h2>
          </header>
          
          <div style={{ padding: '30px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <p style={{ fontSize: '1rem', color: 'var(--gray-600)', marginBottom: '30px' }}>
              정보 수정을 위해 비밀번호를 입력해주세요.
            </p>
            <div style={{ width: '100%', position: 'relative', marginBottom: '5px' }}>
              <input 
                type={showPassword ? 'text' : 'password'}
                value={verifyPassword}
                onChange={(e) => setVerifyPassword(e.target.value)}
                placeholder="비밀번호"
                style={{ width: '100%', padding: '16px', paddingRight: '45px', borderRadius: '12px', border: `1px solid ${verifyError ? 'red' : 'var(--border-color)'}`, fontSize: '1.1rem', outline: 'none' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-500)' }}
              >
                {showPassword ? <EyeOff size={22} /> : <Eye size={22} />}
              </button>
            </div>
            {verifyError && <p style={{ width: '100%', color: 'red', fontSize: '0.85rem', marginTop: '6px', marginBottom: '10px' }}>{verifyError}</p>}
            
            <button
              onClick={() => {
                setShowPasswordConfirmModal(false);
                router.push('/find-id');
              }}
              style={{ alignSelf: 'flex-end', background: 'none', border: 'none', color: 'var(--point-color)', fontSize: '0.9rem', cursor: 'pointer', marginBottom: '30px', fontWeight: '500' }}
            >
              비밀번호 찾기
            </button>

            <button 
              onClick={handleVerifyPassword}
              disabled={isVerifying || !verifyPassword}
              style={{ 
                width: '100%', padding: '16px', 
                backgroundColor: isVerifying || !verifyPassword ? 'var(--gray-300)' : 'var(--point-color)', 
                color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.1rem', fontWeight: 'bold', 
                cursor: isVerifying || !verifyPassword ? 'not-allowed' : 'pointer',
                marginTop: 'auto', marginBottom: '20px'
              }}
            >
              {isVerifying ? '확인 중...' : '확인'}
            </button>
          </div>
        </div>
      )}

      {/* 정보 수정 모달 (풀스크린) */}
      {showEditInfoModal && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'white', zIndex: 4000,
          display: 'flex', flexDirection: 'column', overflowY: 'auto'
        }}>
          <header style={{ display: 'flex', alignItems: 'center', padding: '20px', borderBottom: '1px solid var(--border-color)' }}>
            <button onClick={() => setShowEditInfoModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center', marginLeft: '-5px' }}>
              <ChevronLeft size={28} color="var(--gray-800)" />
            </button>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginLeft: '10px' }}>개인정보 수정</h2>
          </header>
          
          <div style={{ padding: '30px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '40px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.95rem', color: 'var(--gray-700)', marginBottom: '8px', fontWeight: 'bold' }}>아이디</label>
                <input 
                  type="text" 
                  value={accountInfo?.id || ''} 
                  disabled 
                  style={{ width: '100%', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--gray-100)', color: 'var(--gray-500)', fontSize: '1.05rem', outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.95rem', color: 'var(--gray-700)', marginBottom: '8px', fontWeight: 'bold' }}>이메일</label>
                <input 
                  type="email" 
                  value={editEmail} 
                  onChange={(e) => setEditEmail(e.target.value)}
                  style={{ width: '100%', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1.05rem', outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.95rem', color: 'var(--gray-700)', marginBottom: '8px', fontWeight: 'bold' }}>성별</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {['남성', '여성', '선택안함'].map((g) => (
                    <button
                      key={g}
                      onClick={() => setEditGender(g)}
                      style={{ flex: 1, padding: '14px', borderRadius: '10px', border: editGender === g ? 'none' : '1px solid var(--border-color)', backgroundColor: editGender === g ? 'var(--point-color)' : 'white', color: editGender === g ? 'white' : 'var(--gray-700)', fontWeight: editGender === g ? 'bold' : 'normal', cursor: 'pointer', fontSize: '1rem' }}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.95rem', color: 'var(--gray-700)', marginBottom: '8px', fontWeight: 'bold' }}>출생년월일</label>
                <input 
                  type="date" 
                  value={editBirthdate} 
                  onChange={(e) => setEditBirthdate(e.target.value)}
                  style={{ width: '100%', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1.05rem', outline: 'none', color: editBirthdate ? 'black' : 'var(--gray-400)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.95rem', color: 'var(--gray-700)', marginBottom: '8px', fontWeight: 'bold' }}>비밀번호 변경 (선택)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <input 
                    type="password" 
                    value={editPassword} 
                    onChange={(e) => { setEditPassword(e.target.value); setEditPasswordError(''); }}
                    placeholder="새 비밀번호 (6자리 이상)"
                    style={{ width: '100%', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1.05rem', outline: 'none' }}
                  />
                  <input 
                    type="password" 
                    value={editPasswordConfirm} 
                    onChange={(e) => { setEditPasswordConfirm(e.target.value); setEditPasswordError(''); }}
                    placeholder="새 비밀번호 확인"
                    style={{ width: '100%', padding: '16px', borderRadius: '12px', border: `1px solid ${editPasswordError ? 'red' : 'var(--border-color)'}`, fontSize: '1.05rem', outline: 'none' }}
                  />
                </div>
                {editPasswordError && <p style={{ color: 'red', fontSize: '0.85rem', marginTop: '6px' }}>{editPasswordError}</p>}
              </div>
            </div>

            <button 
              onClick={handleSaveInfo}
              disabled={isSavingInfo}
              style={{ 
                width: '100%', padding: '16px', 
                backgroundColor: isSavingInfo ? 'var(--gray-300)' : 'var(--point-color)', 
                color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.1rem', fontWeight: 'bold', 
                cursor: isSavingInfo ? 'not-allowed' : 'pointer',
                marginTop: 'auto', marginBottom: '20px'
              }}
            >
              {isSavingInfo ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}
