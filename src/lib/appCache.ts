const CACHE_VERSION = 'v1';
const CACHE_PREFIX = `dreamary_app_cache_${CACHE_VERSION}`;
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

interface CacheEnvelope<T> {
  ownerId: string;
  savedAt: number;
  data: T;
}

function cacheKey(ownerId: string, section: string) {
  return `${CACHE_PREFIX}:${ownerId}:${section}`;
}

/**
 * Reads only data stored under the already-resolved Firebase UID or guest UUID.
 * Never call this with an auth hint while Firebase authentication is still checking.
 */
export function readUserCache<T>(ownerId: string, section: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | null {
  if (typeof window === 'undefined' || !ownerId) return null;
  try {
    const raw = localStorage.getItem(cacheKey(ownerId, section));
    if (!raw) return null;
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (envelope.ownerId !== ownerId || Date.now() - envelope.savedAt > maxAgeMs) {
      localStorage.removeItem(cacheKey(ownerId, section));
      return null;
    }
    return envelope.data;
  } catch {
    localStorage.removeItem(cacheKey(ownerId, section));
    return null;
  }
}

export function writeUserCache<T>(ownerId: string, section: string, data: T) {
  if (typeof window === 'undefined' || !ownerId) return;
  try {
    const envelope: CacheEnvelope<T> = { ownerId, savedAt: Date.now(), data };
    localStorage.setItem(cacheKey(ownerId, section), JSON.stringify(envelope));
  } catch (error) {
    console.warn('App cache write skipped:', error);
  }
}

export function clearUserCache(ownerId: string, sections?: string[]) {
  if (typeof window === 'undefined' || !ownerId) return;
  try {
    if (sections) {
      sections.forEach(section => localStorage.removeItem(cacheKey(ownerId, section)));
      return;
    }
    const ownerPrefix = `${CACHE_PREFIX}:${ownerId}:`;
    Object.keys(localStorage)
      .filter(key => key.startsWith(ownerPrefix))
      .forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.warn('App cache clear skipped:', error);
  }
}
