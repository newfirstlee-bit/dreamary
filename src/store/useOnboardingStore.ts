import { create } from 'zustand';

export interface OnboardingState {
  // Character State
  charName: string;
  charGender: '남성' | '여성' | '그 외' | '';
  charFeeling: string;
  charTitle: string;
  charExampleChat: string;
  charNegative: string;
  charWorldview: string;
  charExtra: string;
  charNarrative: string;
  charImage: string | null;
  charImageFile: File | null;

  // User State
  userName: string;
  userGender: '남성' | '여성' | '그 외' | '';
  userFeeling: string;
  userExtra: string;
  userImage: string | null;
  userImageFile: File | null;

  // Setters
  setCharField: (field: keyof OnboardingState, value: any) => void;
  setUserField: (field: keyof OnboardingState, value: any) => void;
  
  // Resetter
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  charName: '',
  charGender: '',
  charFeeling: '',
  charTitle: '',
  charExampleChat: '',
  charNegative: '',
  charWorldview: '',
  charExtra: '',
  charNarrative: '',
  charImage: null,
  charImageFile: null,

  userName: '',
  userGender: '',
  userFeeling: '',
  userExtra: '',
  userImage: null,
  userImageFile: null,

  setCharField: (field, value) => set((state) => ({ ...state, [field]: value })),
  setUserField: (field, value) => set((state) => ({ ...state, [field]: value })),
  
  reset: () => set({
    charName: '', charGender: '', charFeeling: '', charTitle: '', charExampleChat: '', charNegative: '', charWorldview: '', charExtra: '', charNarrative: '', charImage: null, charImageFile: null,
    userName: '', userGender: '', userFeeling: '', userExtra: '', userImage: null, userImageFile: null
  })
}));
