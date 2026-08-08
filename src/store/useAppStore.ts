import { create } from 'zustand';
import { Character, Topic, getTopics } from '@/lib/db';
import { getCharactersWithGuestRecovery } from '@/lib/ownership';

interface AppState {
  characters: Character[] | null;
  characterOwnerId: string | null;
  topics: Topic[] | null;
  isCharactersLoaded: boolean;
  isTopicsLoaded: boolean;
  loadCharacters: (userId: string, isAuthenticated: boolean) => Promise<Character[]>;
  loadTopics: () => Promise<Topic[]>;
  setCharacters: (userId: string, chars: Character[]) => void;
  clearStore: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  characters: null,
  characterOwnerId: null,
  topics: null,
  isCharactersLoaded: false,
  isTopicsLoaded: false,

  loadCharacters: async (userId: string, isAuthenticated: boolean) => {
    // 이미 로드 중이거나 로드 완료된 상태라면 기존 값을 반환
    const state = get();
    if (state.isCharactersLoaded && state.characterOwnerId === userId && state.characters) {
      return state.characters;
    }

    // A login/logout changes the data owner. Never reuse another owner's list.
    set({ characters: null, characterOwnerId: userId, isCharactersLoaded: false });

    try {
      const chars = await getCharactersWithGuestRecovery(userId, isAuthenticated);
      // Ignore a late response if auth changed again while this request ran.
      if (get().characterOwnerId === userId) {
        set({ characters: chars, isCharactersLoaded: true });
      }
      return chars;
    } catch (error) {
      console.error('Failed to load characters in store:', error);
      return [];
    }
  },

  loadTopics: async () => {
    const state = get();
    if (state.isTopicsLoaded && state.topics) {
      return state.topics;
    }

    try {
      const loadedTopics = await getTopics();
      set({ topics: loadedTopics, isTopicsLoaded: true });
      return loadedTopics;
    } catch (error) {
      console.error('Failed to load topics in store:', error);
      return [];
    }
  },

  setCharacters: (userId: string, chars: Character[]) => {
    set({ characters: chars, characterOwnerId: userId, isCharactersLoaded: true });
  },

  clearStore: () => {
    set({ characters: null, characterOwnerId: null, topics: null, isCharactersLoaded: false, isTopicsLoaded: false });
  }
}));

/** Character writes must invalidate the shared read cache used by all tabs. */
export function invalidateCharacterStore(ownerId?: string) {
  const state = useAppStore.getState();
  if (ownerId && state.characterOwnerId && state.characterOwnerId !== ownerId) return;
  useAppStore.setState({
    characters: null,
    characterOwnerId: null,
    isCharactersLoaded: false,
  });
}
