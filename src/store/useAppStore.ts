import { create } from 'zustand';
import { Character, Topic, getTopics } from '@/lib/db';
import { getCharactersWithGuestRecovery } from '@/lib/ownership';
import { auth } from '@/lib/firebase';
import { profileReadCache } from '@/lib/dataReadCache';

type CharacterAuthMode = 'authenticated' | 'guest';

let characterRequest: { sequence: number; promise: Promise<Character[]> } | null = null;

interface AppState {
  characters: Character[] | null;
  characterOwnerId: string | null;
  characterAuthMode: CharacterAuthMode | null;
  characterLoadSequence: number;
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
  characterAuthMode: null,
  characterLoadSequence: 0,
  topics: null,
  isCharactersLoaded: false,
  isTopicsLoaded: false,

  loadCharacters: async (userId: string, isAuthenticated: boolean) => {
    // Firebase 로그인 성공 직후 React context 반영이 한 렌더 늦어질 수 있다.
    // 같은 UID의 SDK 사용자가 있으면 로그인 소유자로 판정해 guest 복구를 건너뛰지 않는다.
    const authenticatedOwner = isAuthenticated || auth.currentUser?.uid === userId;
    const requestedAuthMode: CharacterAuthMode = authenticatedOwner ? 'authenticated' : 'guest';
    const state = get();
    if (
      state.isCharactersLoaded
      && state.characterOwnerId === userId
      && state.characterAuthMode === requestedAuthMode
      && state.characters
    ) {
      return state.characters;
    }

    if (characterRequest?.sequence === state.characterLoadSequence
      && state.characterOwnerId === userId
      && state.characterAuthMode === requestedAuthMode) {
      return characterRequest.promise;
    }

    // UID뿐 아니라 인증 모드도 캐시 키로 사용한다. 같은 UID라도 guest/auth 전환 결과는 재사용하지 않는다.
    const requestSequence = state.characterLoadSequence + 1;
    set({
      characters: null,
      characterOwnerId: userId,
      characterAuthMode: requestedAuthMode,
      characterLoadSequence: requestSequence,
      isCharactersLoaded: false,
    });

    const promise = getCharactersWithGuestRecovery(userId, authenticatedOwner).then(chars => {
      const current = get();
      // 인증/소유자 전환 뒤 도착한 이전 요청은 공용 캐시를 덮어쓰지 않는다.
      if (
        current.characterLoadSequence === requestSequence
        && current.characterOwnerId === userId
        && current.characterAuthMode === requestedAuthMode
      ) {
        set({ characters: chars, isCharactersLoaded: true });
      }
      return chars;
    }).catch(error => {
      console.error('Failed to load characters in store:', error);
      throw error;
    }).finally(() => {
      if (characterRequest?.sequence === requestSequence) characterRequest = null;
    });
    characterRequest = { sequence: requestSequence, promise };
    return promise;
  },

  loadTopics: async () => {
    const state = get();
    try {
      // getTopics owns TTL and in-flight deduplication, including direct callers.
      const loadedTopics = await getTopics();
      if (get().characterLoadSequence === state.characterLoadSequence) {
        set({ topics: loadedTopics, isTopicsLoaded: true });
      }
      return loadedTopics;
    } catch (error) {
      console.error('Failed to load topics in store:', error);
      throw error;
    }
  },

  setCharacters: (userId: string, chars: Character[]) => {
    set(state => ({
      characters: chars,
      characterOwnerId: userId,
      characterAuthMode: auth.currentUser?.uid === userId ? 'authenticated' : 'guest',
      characterLoadSequence: state.characterLoadSequence + 1,
      isCharactersLoaded: true,
    }));
  },

  clearStore: () => {
    profileReadCache.clear();
    set(state => ({
      characters: null,
      characterOwnerId: null,
      characterAuthMode: null,
      characterLoadSequence: state.characterLoadSequence + 1,
      topics: null,
      isCharactersLoaded: false,
      isTopicsLoaded: false,
    }));
  }
}));

/** Character writes must invalidate the shared read cache used by all tabs. */
export function invalidateCharacterStore(ownerId?: string) {
  const state = useAppStore.getState();
  if (ownerId && state.characterOwnerId && state.characterOwnerId !== ownerId) return;
  useAppStore.setState(current => ({
    characters: null,
    characterOwnerId: null,
    characterAuthMode: null,
    characterLoadSequence: current.characterLoadSequence + 1,
    isCharactersLoaded: false,
  }));
}
