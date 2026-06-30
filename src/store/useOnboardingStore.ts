import { create } from 'zustand';

export interface OnboardingState {
  // Character State
  charName: string;
  charFeeling: string;
  charTitle: string;
  charExampleChat: string;
  charNegative: string;
  charExtra: string;
  charImage: string | null;
  charImageFile: File | null;

  // User State (3~5번 제외된 스텝 구조)
  userName: string;
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
  charFeeling: '',
  charTitle: '',
  charExampleChat: '',
  charNegative: '',
  charExtra: '',
  charImage: null,
  charImageFile: null,

  userName: '',
  userFeeling: '',
  userExtra: '',
  userImage: null,
  userImageFile: null,

  setCharField: (field, value) => set((state) => ({ ...state, [field]: value })),
  setUserField: (field, value) => set((state) => ({ ...state, [field]: value })),
  
  reset: () => set({
    charName: '', charFeeling: '', charTitle: '', charExampleChat: '', charNegative: '', charExtra: '', charImage: null, charImageFile: null,
    userName: '', userFeeling: '', userExtra: '', userImage: null, userImageFile: null
  })
}));
