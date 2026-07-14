"use client";

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useOnboardingStore } from '@/store/useOnboardingStore';
import { getUserId, generateUUID } from '@/lib/auth';
import { saveCharacter, saveUserProfile, Character, UserProfile } from '@/lib/db';
import { uploadImageToImgbb } from '@/lib/imgbb';
import { ChevronLeft, Camera, Loader2, User } from 'lucide-react';
import { trackEvent } from '@/lib/mixpanel';
import { useLocale } from '@/lib/i18n';

function getJosa(word: string, josaType: '이/가' | '을/를' | '은/는' | '으로/로' | '과/와' | '아/야'): string {
  if (!word) return josaType.split('/')[0];
  const lastChar = word.charCodeAt(word.length - 1);
  if (lastChar < 44032 || lastChar > 55203) return josaType.split('/')[0]; 
  const hasBatchim = (lastChar - 44032) % 28 !== 0;
  const [josaT, josaF] = josaType.split('/');
  return hasBatchim ? josaT : josaF;
}

function applyJosa(word: string, josaType: '이/가' | '을/를' | '은/는' | '으로/로' | '과/와' | '아/야'): string {
  if (!word) return '';
  return word + getJosa(word, josaType);
}

type Phase = 'value-proposition' | 'character' | 'narrative-prompt' | 'narrative' | 'user' | 'saving';

export default function OnboardingPage() {
  const router = useRouter();
  const store = useOnboardingStore();
  const { t, locale } = useLocale();
  const [phase, setPhase] = useState<Phase>('value-proposition');
  const [charStep, setCharStep] = useState(1);
  const [narrativeStep, setNarrativeStep] = useState(1);
  const [userStep, setUserStep] = useState(1);
  const [viewportStyle, setViewportStyle] = useState({ height: '100dvh', top: 0 });
  const [showUserModal, setShowUserModal] = useState(false);
  const [showUserBackModal, setShowUserBackModal] = useState(false);
  const [isNextEnabled, setIsNextEnabled] = useState(false);

  useEffect(() => {
    trackEvent('Onboarding_Started');
    
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get('skip') === 'true') {
        setPhase('character');
      }
    }

    // Handle mobile virtual keyboard to stay glued to the visual viewport
    if (window.visualViewport) {
      const handleResizeOrScroll = () => {
        if (!window.visualViewport) return;
        setViewportStyle({
          height: `${window.visualViewport.height}px`,
          top: window.visualViewport.pageTop
        });
      };
      window.visualViewport.addEventListener('resize', handleResizeOrScroll);
      window.visualViewport.addEventListener('scroll', handleResizeOrScroll);
      handleResizeOrScroll();
      
      return () => {
        window.visualViewport?.removeEventListener('resize', handleResizeOrScroll);
        window.visualViewport?.removeEventListener('scroll', handleResizeOrScroll);
      };
    }
  }, []);

  useEffect(() => {
    if (phase === 'value-proposition') {
      trackEvent('ValueProposition_Viewed');
      setIsNextEnabled(false);
      const timer = setTimeout(() => {
        setIsNextEnabled(true);
      }, 1600); // 1.2s delay + 0.6s anim = 1.8s. 버튼 CSS transition(0.3s) 고려하여 1.6s에 활성화 시작
      return () => clearTimeout(timer);
    } else if (phase === 'character') {
      if (charStep === 1) trackEvent('CharacterNameInput_Viewed');
      else if (charStep === 2) trackEvent('CharacterGenderInput_Viewed');
      else if (charStep === 3) trackEvent('CharacterFeelingInput_Viewed');
      else if (charStep === 4) trackEvent('CharacterTitleInput_Viewed');
      else if (charStep === 5) trackEvent('CharacterExampleChatInput_Viewed');
      else if (charStep === 6) trackEvent('CharacterNegativeInput_Viewed');
      else if (charStep === 7) trackEvent('CharacterImageInput_Viewed');
    } else if (phase === 'narrative-prompt') {
      trackEvent('NarrativePrompt_Viewed');
    }
  }, [phase, charStep]);

  const handleNextCharStep = () => {
    if (charStep < 7) {
      setCharStep(charStep + 1);
    } else {
      setPhase('narrative-prompt');
    }
  };

  const handleNextNarrativeStep = () => {
    if (narrativeStep < 3) {
      setNarrativeStep(narrativeStep + 1);
    } else {
      setShowUserModal(true);
    }
  };

  const handleNextUserStep = () => {
    if (userStep < 4) {
      setUserStep(userStep + 1);
    } else {
      handleFinish();
    }
  };

  const handleBack = () => {
    if (showUserModal) {
      setShowUserModal(false);
      return;
    }
    if (phase === 'character') {
      if (charStep > 1) {
        setCharStep(charStep - 1);
      } else {
        const searchParams = new URLSearchParams(window.location.search);
        if (searchParams.get('skip') === 'true') {
          router.back();
        } else {
          setPhase('value-proposition');
        }
      }
    } else if (phase === 'narrative-prompt') {
      setPhase('character');
      setCharStep(7);
    } else if (phase === 'narrative') {
      if (narrativeStep > 1) setNarrativeStep(narrativeStep - 1);
      else setPhase('narrative-prompt');
    } else if (phase === 'user') {
      if (userStep > 1) {
        setUserStep(userStep - 1);
      } else {
        setShowUserBackModal(true);
      }
    }
  };

  const handleUserBackConfirm = () => {
    store.setUserField('userName', '');
    store.setUserField('userGender', null);
    store.setUserField('userFeeling', '');
    store.setUserField('userImage', undefined);
    store.setUserField('userImageFile', undefined);
    setShowUserBackModal(false);
    setUserStep(1);
    setPhase('narrative-prompt');
    setShowUserModal(true);
  };

  const handleFinish = async () => {
    setPhase('saving');
    try {
      const userId = getUserId();
      
      let charImgUrl = store.charImage;
      if (store.charImageFile) {
        charImgUrl = await uploadImageToImgbb(store.charImageFile);
      }

      let userImgUrl = store.userImage;
      if (store.userImageFile) {
        userImgUrl = await uploadImageToImgbb(store.userImageFile);
      }

      const newChar: any = {
        id: generateUUID(),
        userId,
        name: store.charName,
        gender: store.charGender || undefined,
        feeling: store.charFeeling,
        title: store.charTitle,
        exampleChat: store.charExampleChat,
        negative: store.charNegative,
        worldview: store.charWorldview,
        extra: store.charExtra,
        narrative: store.charNarrative,
        createdAt: Date.now(),
        locale: locale
      };
      if (charImgUrl) {
        newChar.image = charImgUrl;
        newChar.homeBackgroundImage = charImgUrl;
      }

      await saveCharacter(newChar as Character);

      let activeUserProfile: UserProfile;

      if (store.userName.trim()) {
        const newUser: any = {
          id: newChar.id,
          name: store.userName,
          gender: store.userGender || undefined,
          feeling: store.userFeeling,
          createdAt: Date.now()
        };
        if (userImgUrl) newUser.image = userImgUrl;
        
        await saveUserProfile(newUser as UserProfile);
        activeUserProfile = newUser as UserProfile;
      } else {
        // Save empty user profile
        const emptyUser: any = {
          id: newChar.id,
          name: locale === 'ja' ? t('common.user') : '유저',
          feeling: '',
          createdAt: Date.now()
        };
        await saveUserProfile(emptyUser as UserProfile);
        activeUserProfile = emptyUser as UserProfile;
      }

      // Trigger initial ping in the background
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character: newChar,
          userProfile: activeUserProfile,
          messages: [],
          isFirstPing: true,
          userId
        })
      }).catch(err => console.error('Background ping failed:', err));

      localStorage.setItem(`hasPinged_${newChar.id}`, 'true');

      store.reset();
      trackEvent('Character_Created', {
        character_name: newChar.name,
        has_image: !!charImgUrl
      });
      router.push('/');
    } catch (err: any) {
      console.error(err);
      alert(`저장 중 오류가 발생했습니다.\n상세: ${err.message || err}`);
      setPhase('narrative-prompt');
      setShowUserModal(true);
    }
  };

  const renderProgressBar = () => {
    let progress = 0;
    if (phase === 'character') {
      progress = (charStep / 7) * 100;
    } else if (phase === 'narrative') {
      progress = (narrativeStep / 3) * 100;
    } else if (phase === 'user') {
      progress = (userStep / 4) * 100;
    }

    if (phase === 'value-proposition' || phase === 'narrative-prompt' || phase === 'saving') return null;

    return (
      <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--border-color)' }}>
        <div style={{ height: '100%', width: `${progress}%`, backgroundColor: 'var(--point-color)', transition: 'width 0.3s ease' }} />
      </div>
    );
  };

  return (
    <div className={`app-container ${phase === 'value-proposition' ? 'diary-bg' : ''}`} style={{ 
      minHeight: viewportStyle.height, 
      height: viewportStyle.height, 
      position: 'relative', 
      top: viewportStyle.top, 
      width: '100%',
      maxWidth: '480px'
    }}>
      {renderProgressBar()}
      
      <header style={{ display: 'flex', alignItems: 'center', padding: '20px', paddingBottom: '10px', minHeight: '68px' }}>
        {phase !== 'saving' && phase !== 'value-proposition' && (
          <button onClick={handleBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center' }}>
            <ChevronLeft size={28} color="var(--gray-800)" />
          </button>
        )}
      </header>

      <main className="content" style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
        {phase === 'value-proposition' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '40px' }}>
              <h1 style={{ fontSize: '1.5rem', lineHeight: '1.4', textAlign: 'center', fontWeight: 'bold' }} dangerouslySetInnerHTML={{ __html: t('onboarding.valuePropTitle') }} />
            </div>
            
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '27px', padding: '0 10px', transform: 'translateY(-10px)' }}>
              {/* User Message */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', opacity: 0, animation: 'fadeInUp 0.6s ease 0.5s forwards' }}>
                <div className="post-it" style={{ maxWidth: '85%', lineHeight: '1.6', fontSize: '18px' }}>
                  {t('onboarding.valuePropMsg1')}
                </div>
              </div>

              {/* Character Message */}
              <div style={{ display: 'flex', justifyContent: 'flex-start', opacity: 0, animation: 'fadeInUp 0.6s ease 1.2s forwards' }}>
                <div className="notebook-paper" style={{ maxWidth: '85%', lineHeight: '1.6', fontSize: '18px' }} dangerouslySetInnerHTML={{ __html: t('onboarding.valuePropMsg2') }} />
              </div>
            </div>
            
            <div style={{ paddingBottom: '20px' }}>
              <button 
                className="btn-primary" 
                onClick={() => {
                  localStorage.setItem('has_seen_onboarding', 'true');
                  router.push('/');
                }}
                disabled={!isNextEnabled}
                style={{ 
                  width: '100%', 
                  marginTop: 0, 
                  opacity: isNextEnabled ? 1 : 0.5, 
                  transition: 'opacity 0.3s ease',
                  cursor: isNextEnabled ? 'pointer' : 'not-allowed'
                }}
              >
                {t('onboarding.startBtn')}
              </button>
            </div>
          </div>
        )}
        
        {phase === 'character' && <CharacterStep step={charStep} store={store} onNext={handleNextCharStep} />}
        
        {phase === 'narrative-prompt' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 20px' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <h1 style={{ fontSize: '1.5rem', marginBottom: '10px', lineHeight: '1.4' }} dangerouslySetInnerHTML={{ __html: t('onboarding.narrativePromptTitle') }} />
              <p style={{ color: 'var(--text-muted)', marginBottom: '0', lineHeight: '1.5', fontSize: '1rem' }} dangerouslySetInnerHTML={{ __html: t('onboarding.narrativePromptDesc').replace('{name}', store.charName) }} />
            </div>
            
            <div style={{ width: '100%', paddingBottom: '20px' }}>
              <p style={{ color: 'var(--gray-500)', fontSize: '14px', marginBottom: '15px', textAlign: 'center' }}>{t('onboarding.narrativePromptHint')}</p>
              <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                <button onClick={() => setShowUserModal(true)} style={{ flex: 3, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)', cursor: 'pointer', fontWeight: '500', fontSize: '16px' }}>
                  {t('onboarding.laterBtn')}
                </button>
                <button onClick={() => setPhase('narrative')} style={{ flex: 7, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>
                  {t('onboarding.inputNarrativeBtn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === 'narrative' && <NarrativeStep step={narrativeStep} store={store} onNext={handleNextNarrativeStep} />}

        {phase === 'user' && <UserStep step={userStep} store={store} onNext={handleNextUserStep} />}
        
        {phase === 'saving' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 20px' }}>
            <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
            <p style={{ fontWeight: 'bold', color: 'var(--point-color)', marginTop: '15px' }}>{t('onboarding.saving')}</p>
          </div>
        )}
      </main>
      
      {showUserModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '15px', padding: '30px 20px', width: '100%', maxWidth: '340px', textAlign: 'center', display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.2s ease' }}>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '15px', lineHeight: '1.4' }}>{t('onboarding.userModalTitle')}</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '30px', lineHeight: '1.5', fontSize: '0.95rem' }} dangerouslySetInnerHTML={{ __html: t('onboarding.userModalDesc').replace('{name}', locale === 'ja' ? (store.charName || t('common.character')) : applyJosa(store.charName || '캐릭터', '과/와')) }} />
            
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowUserModal(false); handleFinish(); }} style={{ flex: 1, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)', cursor: 'pointer', fontWeight: '500', fontSize: '15px' }}>
                {t('onboarding.laterBtn')}
              </button>
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowUserModal(false); setPhase('user'); }} style={{ flex: 1, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                {t('onboarding.okBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {showUserBackModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '15px', padding: '30px 20px', width: '100%', maxWidth: '340px', textAlign: 'center', display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.2s ease' }}>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '30px', lineHeight: '1.4', fontWeight: 'bold' }}>뒤로가면 작성한 내용이<br/>사라져요</h2>
            
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleUserBackConfirm(); }} style={{ flex: 3, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'rgba(255, 59, 48, 0.1)', color: '#FF3B30', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                뒤로가기
              </button>
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowUserBackModal(false); }} style={{ flex: 7, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                계속하기
              </button>
            </div>
          </div>
        </div>
      )}
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .input-field {
          width: 100%;
          padding: 15px;
          border: 1px solid var(--border-color);
          border-radius: 10px;
          font-size: 1rem;
          margin-bottom: 20px;
          outline: none;
          transition: border-color 0.2s;
        }
        .input-field:focus {
          border-color: var(--point-color);
        }
        textarea.input-field {
          min-height: 54px;
          resize: none;
          overflow: hidden;
        }
        .radio-btn {
          flex: 1;
          padding: 12px 0;
          text-align: center;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          cursor: pointer;
          font-weight: 500;
          color: var(--gray-600);
          transition: all 0.2s;
        }
        .radio-btn.selected {
          border-color: var(--point-color);
          background-color: var(--point-color);
          color: white;
          font-weight: bold;
        }
      `}} />
    </div>
  );
}

const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => {
  const innerRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

  const adjustHeight = () => {
    if (innerRef.current) {
      innerRef.current.style.height = 'auto';
      innerRef.current.style.height = `${innerRef.current.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [props.value]);

  return (
    <textarea
      {...props}
      ref={innerRef}
      onChange={(e) => {
        adjustHeight();
        if (props.onChange) props.onChange(e);
      }}
    />
  );
});

function ImageUpload({ imagePreview, onFileSelect }: { imagePreview: string | null, onFileSelect: (f: File) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '30px' }}>
      <div 
        onClick={() => fileInputRef.current?.click()}
        style={{ 
          width: '120px', height: '120px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', 
          display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer',
          overflow: 'hidden', position: 'relative', border: '2px dashed var(--border-color)'
        }}
      >
        {imagePreview ? (
          <Image src={imagePreview} alt="preview" fill style={{ objectFit: 'cover' }} />
        ) : (
          <Camera size={32} color="var(--gray-500)" />
        )}
      </div>
      <p style={{ marginTop: '10px', fontSize: '16px', color: 'var(--text-muted)' }}>{t('onboarding.imageUpload')}</p>
      <p style={{ marginTop: '4px', fontSize: '14px', color: '#ff4d4f', fontWeight: 'bold' }}>{t('onboarding.imageWarning')}</p>
      <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />
    </div>
  );
}

function GenderSelect({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  const { t } = useLocale();
  const options = [t('onboarding.genderMale'), t('onboarding.genderFemale'), t('onboarding.genderOther')];
  return (
    <div style={{ display: 'flex', gap: '10px', width: '100%', marginBottom: '20px' }}>
      {options.map(opt => (
        <div 
          key={opt}
          className={`radio-btn ${value === opt ? 'selected' : ''}`}
          onClick={() => onChange(opt)}
        >
          {opt}
        </div>
      ))}
    </div>
  );
}

function CharacterStep({ step, store, onNext }: { step: number, store: any, onNext: () => void }) {
  const { t, locale } = useLocale();
  const isLast = step === 7;
  const charNameText = locale === 'ja' ? (store.charName || t('common.character')) : (store.charName ? applyJosa(store.charName, '이/가') : '캐릭터가');
  const charNameStr = store.charName || '캐릭터';
  const charExampleChatRef = useRef<HTMLTextAreaElement>(null);

  const handleInsertQuotes = () => {
    const textarea = charExampleChatRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = store.charExampleChat;

    const newVal = currentVal.substring(0, start) + '""' + currentVal.substring(end);
    store.setCharField('charExampleChat', newVal);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + 1, start + 1);
    }, 0);
  };

  const isNextDisabled = () => {
    if (step === 1 && !store.charName.trim()) return true;
    if (step === 2 && !store.charGender) return true;
    if (step === 3 && !store.charFeeling.trim()) return true;
    if (step === 4 && !store.charTitle.trim()) return true;
    if (step === 5 && !store.charExampleChat.trim()) return true;
    if (step === 6 && !store.charNegative.trim()) return true;
    return false;
  };

  const showSubtitle = step === 5 || step === 6 || step === 7;
  
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.3s ease', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px 20px' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '10px', lineHeight: '1.4' }}>
          {step === 1 && t('onboarding.charStep1Title')}
          {step === 2 && t('onboarding.charStep2Title').replace('{name}', charNameStr)}
          {step === 3 && t('onboarding.charStep3Title').replace('{name}', charNameText)}
          {step === 4 && t('onboarding.charStep4Title').replace('{name}', charNameText)}
          {step === 5 && t('onboarding.charStep5Title').replace('{name}', charNameStr)}
          {step === 6 && t('onboarding.charStep6Title')}
          {step === 7 && t('onboarding.charStep7Title').replace('{name}', charNameStr)}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: showSubtitle ? '45px' : '25px', minHeight: showSubtitle ? '20px' : '0' }}>
          {step === 5 && t('onboarding.charStep5Subtitle')}
          {step === 6 && t('onboarding.charStep6Subtitle')}
          {step === 7 && t('onboarding.charStep7Subtitle')}
        </p>

        {step === 1 && <input className="input-field" autoFocus value={store.charName} onChange={e => store.setCharField('charName', e.target.value.slice(0, 10))} placeholder={t('onboarding.charStep1Placeholder')} />}
        {step === 2 && <GenderSelect value={store.charGender} onChange={v => store.setCharField('charGender', v)} />}
        {step === 3 && <input className="input-field" autoFocus value={store.charFeeling} onChange={e => store.setCharField('charFeeling', e.target.value.slice(0, 300))} placeholder={t('onboarding.charStep3Placeholder')} />}
        {step === 4 && <input className="input-field" autoFocus value={store.charTitle} onChange={e => store.setCharField('charTitle', e.target.value.slice(0, 300))} placeholder={t('onboarding.charStep4Placeholder')} />}
        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            <AutoResizeTextarea 
              ref={charExampleChatRef}
              className="input-field" 
              autoFocus 
              value={store.charExampleChat} 
              onChange={e => store.setCharField('charExampleChat', e.target.value.slice(0, 300))} 
              placeholder={t('onboarding.charStep5Placeholder')} 
              style={{ marginBottom: 0 }}
            />
            <button 
              onClick={handleInsertQuotes}
              style={{
                alignSelf: 'flex-start',
                padding: '6px 12px',
                backgroundColor: 'var(--gray-200)',
                color: 'var(--gray-800)',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 'bold',
              }}
            >
              {t('onboarding.addQuoteBtn')}
            </button>
          </div>
        )}
        {step === 6 && (
          <AutoResizeTextarea 
            className="input-field" 
            autoFocus 
            value={store.charNegative} 
            onChange={e => store.setCharField('charNegative', e.target.value.slice(0, 300))} 
            placeholder={t('onboarding.charStep6Placeholder')} 
          />
        )}
        {step === 7 && (
          <ImageUpload 
            imagePreview={store.charImage} 
            onFileSelect={(file) => {
              store.setCharField('charImageFile', file);
              store.setCharField('charImage', URL.createObjectURL(file));
            }} 
          />
        )}
      </div>

      <div style={{ padding: '10px 20px 20px', backgroundColor: 'var(--card-bg)' }}>
        <button className="btn-primary" onClick={onNext} disabled={isNextDisabled()} style={{ marginTop: 0 }}>
          {isLast ? t('onboarding.nextBtn') : t('onboarding.nextBtn')}
        </button>
      </div>
      <style dangerouslySetInnerHTML={{__html: `@keyframes fadeIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }`}} />
    </div>
  );
}

function NarrativeStep({ step, store, onNext }: { step: number, store: any, onNext: () => void }) {
  const { t } = useLocale();
  const charNameStr = store.charName || '캐릭터';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertVariable = (variable: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = store.charNarrative;

    const newVal = currentVal.substring(0, start) + variable + currentVal.substring(end);
    store.setCharField('charNarrative', newVal.slice(0, 700));

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  const showSubtitle = step === 1 || step === 3;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.3s ease', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px 20px' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '10px', lineHeight: '1.4' }}>
          {step === 1 && t('onboarding.narrativeStep1Title')}
          {step === 2 && t('onboarding.narrativeStep2Title').replace('{name}', charNameStr)}
          {step === 3 && <span dangerouslySetInnerHTML={{ __html: t('onboarding.narrativeStep3Title') }} />}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: showSubtitle ? '20px' : '0px', minHeight: showSubtitle ? '20px' : '0' }}>
          {step === 1 && t('onboarding.narrativeStep1Subtitle')}
          {step === 3 && t('onboarding.narrativeStep3Subtitle')}
        </p>

        {step === 1 && (
          <div style={{ marginBottom: '20px' }}>
            <AutoResizeTextarea className="input-field" autoFocus value={store.charWorldview} onChange={e => store.setCharField('charWorldview', e.target.value.slice(0, 500))} placeholder={t('onboarding.narrativeStep1Placeholder')} style={{ marginBottom: '4px' }} />
            <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{store.charWorldview.length}/500</div>
          </div>
        )}
        {step === 2 && (
          <div style={{ marginBottom: '20px', marginTop: '20px' }}>
            <AutoResizeTextarea className="input-field" autoFocus value={store.charExtra} onChange={e => store.setCharField('charExtra', e.target.value.slice(0, 500))} placeholder={t('onboarding.narrativeStep2Placeholder').replace('{name}', charNameStr)} style={{ marginBottom: '4px' }} />
            <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{store.charExtra.length}/500</div>
          </div>
        )}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            <div>
              <AutoResizeTextarea 
                ref={textareaRef}
                className="input-field" 
                autoFocus 
                value={store.charNarrative} 
                onChange={e => store.setCharField('charNarrative', e.target.value.slice(0, 700))} 
                placeholder={t('onboarding.narrativeStep3Placeholder')} 
                style={{ marginBottom: '4px' }} 
              />
              <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{store.charNarrative.length}/700</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={() => insertVariable('{캐릭터}')}
                style={{ padding: '6px 12px', backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
              >
                {'{캐릭터}'}
              </button>
              <button 
                onClick={() => insertVariable('{유저}')}
                style={{ padding: '6px 12px', backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
              >
                {'{유저}'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '10px 20px 20px', backgroundColor: 'var(--card-bg)' }}>
        <button className="btn-primary" onClick={onNext} style={{ marginTop: 0 }}>
          {t('onboarding.nextBtn')}
        </button>
      </div>
    </div>
  );
}

function UserStep({ step, store, onNext }: { step: number, store: any, onNext: () => void }) {
  const { t, locale } = useLocale();
  const isLast = step === 4;
  const userNameText = locale === 'ja' ? (store.userName || '私') : (store.userName ? applyJosa(store.userName, '이/가') : '내가');
  const charNameText = store.charName ? store.charName : (locale === 'ja' ? t('common.character') : '캐릭터');
  const charNameJosaGa = locale === 'ja' ? (store.charName || t('common.character')) : (store.charName ? applyJosa(store.charName, '이/가') : '캐릭터가');
  const userNameStr = store.userName || '나';

  const isNextDisabled = () => {
    if (step === 1 && !store.userName.trim()) return true;
    if (step === 2 && !store.userGender) return true;
    if (step === 3 && !store.userFeeling.trim()) return true;
    return false;
  };

  const showSubtitle = step === 1 || step === 4;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.3s ease', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px 20px' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '10px', lineHeight: '1.4' }}>
          {step === 1 && t('onboarding.userStep1Title')}
          {step === 2 && t('onboarding.userStep2Title').replace('{name}', userNameStr)}
          {step === 3 && t('onboarding.userStep3Title').replace('{name}', userNameText).replace('{charName}', charNameText)}
          {step === 4 && t('onboarding.userStep4Title').replace('{name}', userNameStr)}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: showSubtitle ? '45px' : '25px', minHeight: showSubtitle ? '20px' : '0' }}>
          {step === 1 && t('onboarding.userStep1Subtitle').replace('{charName}', charNameJosaGa)}
          {step === 4 && t('onboarding.userStep4Subtitle')}
        </p>

        {step === 1 && <input className="input-field" autoFocus value={store.userName} onChange={e => store.setUserField('userName', e.target.value.slice(0, 10))} placeholder={t('onboarding.userStep1Placeholder')} />}
        {step === 2 && <GenderSelect value={store.userGender} onChange={v => store.setUserField('userGender', v)} />}
        {step === 3 && <input className="input-field" autoFocus value={store.userFeeling} onChange={e => store.setUserField('userFeeling', e.target.value.slice(0, 300))} placeholder={t('onboarding.userStep3Placeholder')} />}
        {step === 4 && (
          <ImageUpload 
            imagePreview={store.userImage} 
            onFileSelect={(file) => {
              store.setUserField('userImageFile', file);
              store.setUserField('userImage', URL.createObjectURL(file));
            }} 
          />
        )}
      </div>

      <div style={{ padding: '10px 20px 20px', backgroundColor: 'var(--card-bg)' }}>
        <button className="btn-primary" onClick={onNext} disabled={isNextDisabled()} style={{ marginTop: 0 }}>
          {isLast ? t('onboarding.finishBtn') : t('onboarding.nextBtn')}
        </button>
      </div>
    </div>
  );
}
