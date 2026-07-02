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

type Phase = 'character' | 'narrative-prompt' | 'narrative' | 'user' | 'saving';

export default function OnboardingPage() {
  const router = useRouter();
  const store = useOnboardingStore();
  const [phase, setPhase] = useState<Phase>('character');
  const [charStep, setCharStep] = useState(1);
  const [narrativeStep, setNarrativeStep] = useState(1);
  const [userStep, setUserStep] = useState(1);
  const [viewportStyle, setViewportStyle] = useState({ height: '100dvh', top: 0 });
  const [showUserModal, setShowUserModal] = useState(false);

  useEffect(() => {
    trackEvent('Onboarding_Started');
    
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
      if (charStep > 1) setCharStep(charStep - 1);
      else router.push('/');
    } else if (phase === 'narrative-prompt') {
      setPhase('character');
      setCharStep(7);
    } else if (phase === 'narrative') {
      if (narrativeStep > 1) setNarrativeStep(narrativeStep - 1);
      else setPhase('narrative-prompt');
    } else if (phase === 'user') {
      if (userStep > 1) setUserStep(userStep - 1);
      else {
        setPhase('narrative-prompt');
        setShowUserModal(true);
      }
    }
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
        createdAt: Date.now()
      };
      if (charImgUrl) {
        newChar.image = charImgUrl;
        newChar.homeBackgroundImage = charImgUrl;
      }

      await saveCharacter(newChar as Character);

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
      } else {
        // Save empty user profile
        const emptyUser: any = {
          id: newChar.id,
          name: '유저',
          feeling: '',
          createdAt: Date.now()
        };
        await saveUserProfile(emptyUser as UserProfile);
      }

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

    if (phase === 'narrative-prompt' || phase === 'saving') return null;

    return (
      <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--border-color)' }}>
        <div style={{ height: '100%', width: `${progress}%`, backgroundColor: 'var(--point-color)', transition: 'width 0.3s ease' }} />
      </div>
    );
  };

  return (
    <div className="app-container" style={{ 
      minHeight: viewportStyle.height, 
      height: viewportStyle.height, 
      position: 'absolute', 
      top: viewportStyle.top, 
      left: '50%', 
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: '480px'
    }}>
      {renderProgressBar()}
      
      <header style={{ display: 'flex', alignItems: 'center', padding: '20px', paddingBottom: '10px' }}>
        {phase !== 'saving' && (
          <button onClick={handleBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center' }}>
            <ChevronLeft size={28} color="var(--gray-800)" />
          </button>
        )}
      </header>

      <main className="content" style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
        {phase === 'character' && <CharacterStep step={charStep} store={store} onNext={handleNextCharStep} />}
        
        {phase === 'narrative-prompt' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 20px' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <h1 style={{ fontSize: '1.5rem', marginBottom: '10px', lineHeight: '1.4' }}>캐릭터 생성 완료!<br/>서사를 추가로 입력할 수 있어요</h1>
              <p style={{ color: 'var(--text-muted)', marginBottom: '0', lineHeight: '1.5', fontSize: '1rem' }}>세계관, 서사를 추가로 입력하면<br/>{store.charName} 캐릭터 해석에 큰 도움이 돼요.</p>
            </div>
            
            <div style={{ width: '100%', paddingBottom: '20px' }}>
              <p style={{ color: 'var(--gray-500)', fontSize: '14px', marginBottom: '15px', textAlign: 'center' }}>설정은 마이페이지에서 언제든지 추가할 수 있어요</p>
              <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                <button onClick={() => setShowUserModal(true)} style={{ flex: 3, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)', cursor: 'pointer', fontWeight: '500', fontSize: '16px' }}>
                  나중에
                </button>
                <button onClick={() => setPhase('narrative')} style={{ flex: 7, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>
                  서사 입력하기
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
            <p style={{ fontWeight: 'bold', color: 'var(--point-color)', marginTop: '15px' }}>저장 중...</p>
          </div>
        )}
      </main>
      
      {showUserModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '15px', padding: '30px 20px', width: '100%', maxWidth: '340px', textAlign: 'center', display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.2s ease' }}>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '15px', lineHeight: '1.4' }}>내 캐릭터도 설정할 수 있어요</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '30px', lineHeight: '1.5', fontSize: '0.95rem' }}>{applyJosa(store.charName || '캐릭터', '과/와')} 더 자연스러운<br/>대화를 할 수 있도록 도와줘요</p>
            
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button onClick={() => { setShowUserModal(false); handleFinish(); }} style={{ flex: 1, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)', cursor: 'pointer', fontWeight: '500', fontSize: '15px' }}>
                나중에
              </button>
              <button onClick={() => { setShowUserModal(false); setPhase('user'); }} style={{ flex: 1, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                좋아요
              </button>
            </div>
          </div>
        </div>
      )}
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
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
      <p style={{ marginTop: '10px', fontSize: '16px', color: 'var(--text-muted)' }}>터치하여 사진 업로드</p>
      <p style={{ marginTop: '4px', fontSize: '14px', color: '#ff4d4f', fontWeight: 'bold' }}>절대로 생성형 AI학습에 사용되지 않습니다</p>
      <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />
    </div>
  );
}

function GenderSelect({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  const options = ['남성', '여성', '그 외'];
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
  const isLast = step === 7;
  const charNameText = store.charName ? applyJosa(store.charName, '이/가') : '캐릭터가';
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
          {step === 1 && "캐릭터의 이름은 무엇인가요?"}
          {step === 2 && `${charNameStr}의 성별은 무엇인가요?`}
          {step === 3 && `${charNameText} 나에게 느끼는 감정은?`}
          {step === 4 && `${charNameText} 나를 부르는 호칭은?`}
          {step === 5 && `${charNameStr}의 대화 예시를 알려주세요`}
          {step === 6 && "절대 하면 안되는 말과 행동을 알려주세요"}
          {step === 7 && `${charNameStr}의 사진이 있나요? (선택)`}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: showSubtitle ? '45px' : '25px', minHeight: showSubtitle ? '20px' : '0' }}>
          {step === 5 && '캐입을 위해 최소 5문장 이상 작성해주세요. ""로 문장을 구분해주세요.'}
          {step === 6 && "캐붕 방지를 위해 금지 사항을 작성해주세요."}
          {step === 7 && "사진이 없으면 기본 아이콘이 표시됩니다."}
        </p>

        {step === 1 && <input className="input-field" autoFocus value={store.charName} onChange={e => store.setCharField('charName', e.target.value.slice(0, 10))} placeholder="예: 에스티니앙" />}
        {step === 2 && <GenderSelect value={store.charGender} onChange={v => store.setCharField('charGender', v)} />}
        {step === 3 && <input className="input-field" autoFocus value={store.charFeeling} onChange={e => store.setCharField('charFeeling', e.target.value.slice(0, 300))} placeholder="은인이자 동료. 썸타는 것 같은데 안사귐" />}
        {step === 4 && <input className="input-field" autoFocus value={store.charTitle} onChange={e => store.setCharField('charTitle', e.target.value.slice(0, 300))} placeholder="이름, 당신, 야, 등" />}
        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            <AutoResizeTextarea 
              ref={charExampleChatRef}
              className="input-field" 
              autoFocus 
              value={store.charExampleChat} 
              onChange={e => store.setCharField('charExampleChat', e.target.value.slice(0, 300))} 
              placeholder="오다 주웠다. 오늘 뭐시기 데이? 라던데." 
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
              "" 추가
            </button>
          </div>
        )}
        {step === 6 && (
          <AutoResizeTextarea 
            className="input-field" 
            autoFocus 
            value={store.charNegative} 
            onChange={e => store.setCharField('charNegative', e.target.value.slice(0, 300))} 
            placeholder="현대문물 언급, 밈 사용 금지. 반말 금지 등" 
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
          {isLast ? "다음" : "다음"}
        </button>
      </div>
      <style dangerouslySetInnerHTML={{__html: `@keyframes fadeIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }`}} />
    </div>
  );
}

function NarrativeStep({ step, store, onNext }: { step: number, store: any, onNext: () => void }) {
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
          {step === 1 && "세계관을 알려주세요(선택)"}
          {step === 2 && `${charNameStr}의 추가 설정이 있나요?(선택)`}
          {step === 3 && <>드림주/나와의 서사를<br/>작성해주세요 (선택)</>}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: showSubtitle ? '20px' : '0px', minHeight: showSubtitle ? '20px' : '0' }}>
          {step === 1 && "장르명이 아닌 장르의 세계관을 작성해주세요"}
          {step === 3 && "캐릭터의 대사나 속마음을 포함하여 시간 흐름대로 작성해주시면 오류를 줄일 수 있어요"}
        </p>

        {step === 1 && (
          <div style={{ marginBottom: '20px' }}>
            <AutoResizeTextarea className="input-field" autoFocus value={store.charWorldview} onChange={e => store.setCharField('charWorldview', e.target.value.slice(0, 500))} placeholder="서양 근세 판타지, 에너지를 전투에 접목하여 사용한다." style={{ marginBottom: '4px' }} />
            <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{store.charWorldview.length}/500</div>
          </div>
        )}
        {step === 2 && (
          <div style={{ marginBottom: '20px', marginTop: '20px' }}>
            <AutoResizeTextarea className="input-field" autoFocus value={store.charExtra} onChange={e => store.setCharField('charExtra', e.target.value.slice(0, 500))} placeholder={`성격, 말버릇, 직업, 성장과정 등 ${charNameStr}의 설정을 작성해주세요`} style={{ marginBottom: '4px' }} />
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
                placeholder="첫만남: 길바닥에서 {캐릭터}가 {유저}에게 삥을 뜯었다" 
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
          다음
        </button>
      </div>
    </div>
  );
}

function UserStep({ step, store, onNext }: { step: number, store: any, onNext: () => void }) {
  const isLast = step === 4;
  const userNameText = store.userName ? applyJosa(store.userName, '이/가') : '내가';
  const charNameText = store.charName ? store.charName : '캐릭터';
  const charNameJosaGa = store.charName ? applyJosa(store.charName, '이/가') : '캐릭터가';
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
          {step === 1 && "내 이름/드림주 이름을 알려주세요"}
          {step === 2 && `${userNameStr}의 성별은 어떻게 되나요?`}
          {step === 3 && `${userNameText} ${charNameText}에게 느끼는 감정은?`}
          {step === 4 && `${userNameStr}의 사진이 있나요? (선택)`}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: showSubtitle ? '45px' : '25px', minHeight: showSubtitle ? '20px' : '0' }}>
          {step === 1 && `${charNameJosaGa} 나를 이 이름으로 불러줘요.`}
          {step === 4 && "사진이 없으면 기본 아이콘이 표시됩니다."}
        </p>

        {step === 1 && <input className="input-field" autoFocus value={store.userName} onChange={e => store.setUserField('userName', e.target.value.slice(0, 10))} placeholder="예: 여주, 모험가" />}
        {step === 2 && <GenderSelect value={store.userGender} onChange={v => store.setUserField('userGender', v)} />}
        {step === 3 && <input className="input-field" autoFocus value={store.userFeeling} onChange={e => store.setUserField('userFeeling', e.target.value.slice(0, 300))} placeholder="예: 드림캐를 짝사랑하며 부끄러움이 많다." />}
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
          {isLast ? "모두 완료" : "다음"}
        </button>
      </div>
    </div>
  );
}
