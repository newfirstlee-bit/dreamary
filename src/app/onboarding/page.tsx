"use client";

import { useState, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useOnboardingStore } from '@/store/useOnboardingStore';
import { getUserId } from '@/lib/auth';
import { saveCharacter, saveUserProfile, Character, UserProfile } from '@/lib/db';
import { uploadImageToImgbb } from '@/lib/imgbb';
import { ChevronLeft, Camera, Loader2, User } from 'lucide-react';

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

type Phase = 'character' | 'intermission' | 'user' | 'saving';

export default function OnboardingPage() {
  const router = useRouter();
  const store = useOnboardingStore();
  const [phase, setPhase] = useState<Phase>('character');
  const [charStep, setCharStep] = useState(1);
  const [userStep, setUserStep] = useState(1);

  const handleNextCharStep = () => {
    if (charStep < 7) {
      setCharStep(charStep + 1);
    } else {
      setPhase('intermission');
    }
  };

  const handleNextUserStep = () => {
    if (userStep === 1) setUserStep(2);
    else if (userStep === 2) setUserStep(6);
    else if (userStep === 6) setUserStep(7);
    else if (userStep === 7) handleFinish();
  };

  const handleBack = () => {
    if (phase === 'character') {
      if (charStep > 1) setCharStep(charStep - 1);
      else router.push('/');
    } else if (phase === 'intermission') {
      setPhase('character');
      setCharStep(7);
    } else if (phase === 'user') {
      if (userStep === 7) setUserStep(6);
      else if (userStep === 6) setUserStep(2);
      else if (userStep === 2) setUserStep(1);
      else if (userStep === 1) setPhase('intermission');
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
        id: crypto.randomUUID(),
        userId,
        name: store.charName,
        feeling: store.charFeeling,
        title: store.charTitle,
        exampleChat: store.charExampleChat,
        negative: store.charNegative,
        extra: store.charExtra,
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
          feeling: store.userFeeling,
          extra: store.userExtra,
          createdAt: Date.now()
        };
        if (userImgUrl) newUser.image = userImgUrl;
        
        await saveUserProfile(newUser as UserProfile);
      } else {
        // Save empty user profile to prevent inheriting global one
        const emptyUser: any = {
          id: newChar.id,
          name: '유저',
          feeling: '',
          createdAt: Date.now()
        };
        await saveUserProfile(emptyUser as UserProfile);
      }

      store.reset();
      router.push('/');
    } catch (err) {
      console.error(err);
      alert("저장 중 오류가 발생했습니다. (Firebase Firestore 설정이 비어있거나 규칙 권한이 없을 가능성이 높습니다.)");
      setPhase('intermission');
    }
  };

  const renderProgressBar = () => {
    let progress = 0;
    if (phase === 'character') {
      progress = (charStep / 7) * 100;
    } else if (phase === 'user') {
      const stepIndex = [1, 2, 6, 7].indexOf(userStep) + 1;
      progress = (stepIndex / 4) * 100;
    }

    if (phase === 'intermission' || phase === 'saving') return null;

    return (
      <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--border-color)' }}>
        <div style={{ height: '100%', width: `${progress}%`, backgroundColor: 'var(--point-color)', transition: 'width 0.3s ease' }} />
      </div>
    );
  };

  return (
    <div className="app-container">
      {renderProgressBar()}
      
      <header style={{ display: 'flex', alignItems: 'center', padding: '20px', paddingBottom: '10px' }}>
        {phase !== 'saving' && (
          <button onClick={handleBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center' }}>
            <ChevronLeft size={28} color="var(--gray-800)" />
          </button>
        )}
      </header>

      <main className="content" style={{ display: 'flex', flexDirection: 'column' }}>
        {phase === 'character' && <CharacterStep step={charStep} store={store} onNext={handleNextCharStep} />}
        {phase === 'intermission' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '20px' }}>캐릭터 생성이 완료되었습니다!</h1>
            
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '30px', gap: '10px' }}>
              <div style={{ width: '100px', height: '100px', borderRadius: '25px', overflow: 'hidden', position: 'relative', backgroundColor: 'var(--gray-200)', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
                {store.charImage ? (
                  <Image src={store.charImage} alt={store.charName} fill style={{ objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <User size={48} color="var(--gray-500)" />
                  </div>
                )}
              </div>
              <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{store.charName}</span>
            </div>

            <p style={{ color: 'var(--text-muted)', marginBottom: '40px', lineHeight: '1.5' }}>내 캐릭터(유저 프로필)도 설정할까요?<br/>설정해두면 더 자연스러운 교환일기가 가능합니다.</p>
            <div style={{ display: 'flex', gap: '15px', width: '100%' }}>
              <button onClick={() => handleFinish()} style={{ flex: 1, padding: '15px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', cursor: 'pointer', fontWeight: 'bold' }}>
                나중에
              </button>
              <button onClick={() => setPhase('user')} style={{ flex: 1, padding: '15px', borderRadius: '10px', border: 'none', backgroundColor: 'var(--point-color)', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>
                좋아요
              </button>
            </div>
          </div>
        )}
        {phase === 'user' && <UserStep step={userStep} store={store} onNext={handleNextUserStep} />}
        {phase === 'saving' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
            <p style={{ fontWeight: 'bold', color: 'var(--point-color)', marginTop: '15px' }}>저장 중...</p>
          </div>
        )}
      </main>
      
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
          min-height: 120px;
          resize: vertical;
        }
      `}} />
    </div>
  );
}

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
    if (step === 2 && !store.charFeeling.trim()) return true;
    if (step === 3 && !store.charTitle.trim()) return true;
    if (step === 4 && !store.charExampleChat.trim()) return true;
    if (step === 5 && !store.charNegative.trim()) return true;
    return false;
  };

  const showSubtitle = step === 4 || step === 5 || step === 7;
  
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.3s ease' }}>
      <div style={{ flex: 1 }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '10px', lineHeight: '1.4' }}>
          {step === 1 && "캐릭터의 이름은 무엇인가요?"}
          {step === 2 && `${charNameText} 나에게 느끼는 감정은?`}
          {step === 3 && `${charNameText} 나를 부르는 호칭은?`}
          {step === 4 && `${charNameStr}의 대화 예시를 알려주세요`}
          {step === 5 && "절대 하면 안되는 말과 행동을 알려주세요"}
          {step === 6 && "추가로 설정하고 싶은 내용이 있나요? (선택)"}
          {step === 7 && `${charNameStr}의 사진이 있나요? (선택)`}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: showSubtitle ? '45px' : '25px', minHeight: showSubtitle ? '20px' : '0' }}>
          {step === 4 && '캐입을 위해 최소 5문장 이상 작성해주세요. ""로 문장을 구분해주세요.'}
          {step === 5 && "캐붕 방지를 위해 금지 사항을 작성해주세요."}
          {step === 7 && "사진이 없으면 기본 아이콘이 표시됩니다."}
        </p>

        {step === 1 && <input className="input-field" autoFocus value={store.charName} onChange={e => store.setCharField('charName', e.target.value.slice(0, 10))} placeholder="예: 그라하 티아" />}
        {step === 2 && <input className="input-field" autoFocus value={store.charFeeling} onChange={e => store.setCharField('charFeeling', e.target.value.slice(0, 300))} placeholder="은인이자 동료. 썸타는 것 같은데 안사귐" />}
        {step === 3 && <input className="input-field" autoFocus value={store.charTitle} onChange={e => store.setCharField('charTitle', e.target.value.slice(0, 300))} placeholder="이름, 당신, 야, 등" />}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            <textarea 
              ref={charExampleChatRef}
              className="input-field" 
              autoFocus 
              value={store.charExampleChat} 
              onChange={e => store.setCharField('charExampleChat', e.target.value.slice(0, 300))} 
              placeholder="야, 오다 주웠다. 오늘 뭐...무슨 데이? 그런 날이라며?" 
              style={{ marginBottom: 0 }}
            />
            <button 
              onClick={handleInsertQuotes}
              style={{
                alignSelf: 'flex-start',
                padding: '6px 12px',
                backgroundColor: 'var(--point-color)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
              }}
            >
              "" 추가
            </button>
          </div>
        )}
        {step === 5 && <textarea className="input-field" autoFocus value={store.charNegative} onChange={e => store.setCharField('charNegative', e.target.value.slice(0, 300))} placeholder="현대문물 언급, 밈 사용 금지. 반말 금지 등" />}
        {step === 6 && (
          <div style={{ position: 'relative', marginBottom: '20px' }}>
            <textarea className="input-field" autoFocus value={store.charExtra} onChange={e => store.setCharField('charExtra', e.target.value.slice(0, 300))} placeholder="외모, 배경 스토리, 특별한 설정 등을 자유롭게 적어주세요." style={{ marginBottom: 0, paddingBottom: '30px' }} />
            <span style={{ position: 'absolute', bottom: '15px', right: '15px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{store.charExtra.length}/300</span>
          </div>
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

      <button className="btn-primary" onClick={onNext} disabled={isNextDisabled()}>
        {isLast ? "생성 완료" : "다음"}
      </button>
      <style dangerouslySetInnerHTML={{__html: `@keyframes fadeIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }`}} />
    </div>
  );
}

function UserStep({ step, store, onNext }: { step: number, store: any, onNext: () => void }) {
  const isLast = step === 7;
  const userNameText = store.userName ? applyJosa(store.userName, '이/가') : '내가';
  const charNameText = store.charName ? store.charName : '캐릭터';
  const charNameJosaGa = store.charName ? applyJosa(store.charName, '이/가') : '캐릭터가';
  const userNameStr = store.userName || '나';

  const isNextDisabled = () => {
    if (step === 1 && !store.userName.trim()) return true;
    if (step === 2 && !store.userFeeling.trim()) return true;
    return false;
  };

  const showSubtitle = step === 1 || step === 7;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.3s ease' }}>
      <div style={{ flex: 1 }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '10px', lineHeight: '1.4' }}>
          {step === 1 && "내 이름/드림주 이름을 알려주세요"}
          {step === 2 && `${userNameText} ${charNameText}에게 느끼는 감정은?`}
          {step === 6 && `${userNameStr}의 추가 설정이 있나요? (선택)`}
          {step === 7 && `${userNameStr}의 사진이 있나요? (선택)`}
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: showSubtitle ? '45px' : '25px', minHeight: showSubtitle ? '20px' : '0' }}>
          {step === 1 && `${charNameJosaGa} 나를 이 이름으로 불러줘요.`}
          {step === 7 && "사진이 없으면 기본 아이콘이 표시됩니다."}
        </p>

        {step === 1 && <input className="input-field" autoFocus value={store.userName} onChange={e => store.setUserField('userName', e.target.value.slice(0, 10))} placeholder="예: 여주, 모험가" />}
        {step === 2 && <input className="input-field" autoFocus value={store.userFeeling} onChange={e => store.setUserField('userFeeling', e.target.value.slice(0, 300))} placeholder="예: 드림캐를 짝사랑하며 부끄러움이 많다." />}
        {step === 6 && (
          <div style={{ position: 'relative', marginBottom: '20px' }}>
            <textarea className="input-field" autoFocus value={store.userExtra} onChange={e => store.setUserField('userExtra', e.target.value.slice(0, 300))} placeholder="외모, 직업, 두 사람의 관계 배경 등을 자유롭게 적어주세요." style={{ marginBottom: 0, paddingBottom: '30px' }} />
            <span style={{ position: 'absolute', bottom: '15px', right: '15px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{store.userExtra.length}/300</span>
          </div>
        )}
        {step === 7 && (
          <ImageUpload 
            imagePreview={store.userImage} 
            onFileSelect={(file) => {
              store.setUserField('userImageFile', file);
              store.setUserField('userImage', URL.createObjectURL(file));
            }} 
          />
        )}
      </div>

      <button className="btn-primary" onClick={onNext} disabled={isNextDisabled()}>
        {isLast ? "모두 완료" : "다음"}
      </button>
    </div>
  );
}
