"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import Link from 'next/link';
import { Eye, EyeOff, ChevronLeft } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('');
  const [birthdate, setBirthdate] = useState('');
  
  const [error, setError] = useState('');
  const [idError, setIdError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // 영소문자/숫자 외 문자가 포함되어 있는지 확인
    if (/[^a-z0-9]/.test(val)) {
      setIdError(true);
    } else {
      setIdError(false);
    }
    // 소문자 변환, 정규식으로 제거 후 최대 10자까지만 설정
    setId(val.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10));
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== passwordConfirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setLoading(true);

    try {
      const pseudoEmail = `${id}@dreamary.internal`;
      
      // Firebase Auth 생성
      const userCredential = await createUserWithEmailAndPassword(auth, pseudoEmail, password);
      const user = userCredential.user;

      // Firestore accounts 컬렉션에 사용자 메타데이터 저장
      await setDoc(doc(db, 'accounts', user.uid), {
        id,
        email,
        gender,
        birthdate,
        createdAt: Date.now()
      });

      alert(t('auth.registerSuccess'));
      router.push('/mypage');
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError(t('auth.idInUse'));
      } else if (err.code === 'auth/weak-password') {
        setError(t('auth.weakPassword'));
      } else {
        setError(t('auth.registerFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container" style={{ padding: '20px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: 'var(--bg-color)' }}>
      <header style={{ marginBottom: '30px', marginTop: '20px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => router.back()} style={{ position: 'absolute', left: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>{t('auth.register')}</h1>
      </header>

      <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '40px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>{t('auth.idRequired')}</label>
          <input
            type="text"
            value={id}
            onChange={handleIdChange}
            placeholder={t('auth.idHint')}
            maxLength={10}
            required
            style={{ width: '100%', padding: '15px', borderRadius: '12px', border: `1px solid ${idError ? 'red' : 'var(--border-color)'}`, fontSize: '1rem', outline: 'none' }}
          />
          {idError && <div style={{ color: 'red', fontSize: '0.8rem', marginTop: '5px' }}>{t('auth.idError')}</div>}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>{t('auth.passwordRequired')}</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.passwordHint')}
              required
              minLength={6}
              style={{ width: '100%', padding: '15px', paddingRight: '45px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', display: 'flex', alignItems: 'center' }}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>{t('auth.passwordConfirmRequired')}</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPasswordConfirm ? "text" : "password"}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder={t('auth.passwordConfirmHint')}
              required
              style={{ width: '100%', padding: '15px', paddingRight: '45px', borderRadius: '12px', border: `1px solid ${passwordConfirm && password !== passwordConfirm ? 'red' : 'var(--border-color)'}`, fontSize: '1rem', outline: 'none' }}
            />
            <button
              type="button"
              onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
              style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', display: 'flex', alignItems: 'center' }}
            >
              {showPasswordConfirm ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          {passwordConfirm && password !== passwordConfirm && (
            <div style={{ color: 'red', fontSize: '0.8rem', marginTop: '5px' }}>{t('auth.passwordMismatch')}</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>{t('auth.emailRequired')}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.emailHint')}
            required
            style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>{t('auth.genderRequired')}</label>
          <select 
            value={gender} 
            onChange={(e) => setGender(e.target.value)} 
            required
            style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', backgroundColor: 'white' }}
          >
            <option value="">{t('auth.select')}</option>
            <option value="남성">{t('gender.male')}</option>
            <option value="여성">{t('gender.female')}</option>
            <option value="그 외">{t('gender.other')}</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>{t('auth.birthdateRequired')}</label>
          <input
            type="date"
            value={birthdate}
            max={today}
            onChange={(e) => setBirthdate(e.target.value)}
            required
            style={{ width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '1rem', outline: 'none', backgroundColor: 'white', WebkitAppearance: 'none', display: 'block', color: birthdate ? 'black' : 'var(--gray-500)' }}
          />
        </div>

        {error && <div style={{ color: 'red', fontSize: '0.9rem' }}>{error}</div>}

        <button
          type="submit"
          disabled={loading || !id || !password || !passwordConfirm || !email || !gender || !birthdate}
          style={{ 
            marginTop: '10px', padding: '16px', borderRadius: '12px', border: 'none', 
            backgroundColor: loading || !id || !password || !email || !gender || !birthdate ? 'var(--gray-300)' : 'var(--point-color)', 
            color: 'white', fontSize: '1.1rem', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? t('auth.registering') : t('auth.doRegister')}
        </button>
      </form>
    </div>
  );
}
