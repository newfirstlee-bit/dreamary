const DB_NAME = 'dreamary-image-cache';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [0, 500];
const CACHE_IO_TIMEOUT_MS = 1000;

class PermanentImageError extends Error {}

interface CachedImageRecord {
  url: string;
  blob: Blob;
  savedAt: number;
}

const inFlight = new Map<string, Promise<Blob>>();

function openImageDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) { db?.close(); return; }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), CACHE_IO_TIMEOUT_MS);
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
  });
}

export async function readCachedImage(url: string): Promise<Blob | null> {
  const db = await openImageDb();
  if (!db) return null;

  return new Promise((resolve) => {
    const finish = (blob: Blob | null) => {
      clearTimeout(timer);
      resolve(blob);
      db.close();
    };
    const timer = setTimeout(() => finish(null), CACHE_IO_TIMEOUT_MS);
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(url);
    request.onsuccess = () => {
      const record = request.result as CachedImageRecord | undefined;
      if (!record || Date.now() - record.savedAt > MAX_CACHE_AGE_MS) {
        finish(null);
        return;
      }
      finish(record.blob);
    };
    request.onerror = () => finish(null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
}

async function writeCachedImage(url: string, blob: Blob): Promise<void> {
  const db = await openImageDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ url, blob, savedAt: Date.now() } satisfies CachedImageRecord);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
    transaction.onabort = () => {
      db.close();
      resolve();
    };
  });
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchImageBlob(url: string): Promise<Blob> {
  let lastError: unknown;

  for (const retryDelay of RETRY_DELAYS_MS) {
    if (retryDelay) await delay(retryDelay);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        cache: 'force-cache',
        mode: 'cors',
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          throw new PermanentImageError(`HTTP ${response.status}`);
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size === 0) {
        throw new PermanentImageError('Invalid image response');
      }
      return blob;
    } catch (error) {
      if (error instanceof PermanentImageError) throw error;
      lastError = error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Image download failed');
}

export function downloadAndCacheImage(url: string): Promise<Blob> {
  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = fetchImageBlob(url)
    .then(blob => {
      // Rendering must not wait for an IndexedDB disk write.
      void writeCachedImage(url, blob).catch(() => undefined);
      return blob;
    })
    .finally(() => inFlight.delete(url));

  inFlight.set(url, promise);
  return promise;
}

export async function resolveImageFromCacheOrNetwork(url: string): Promise<Blob> {
  const cached = await readCachedImage(url);
  if (cached) return cached;
  return downloadAndCacheImage(url);
}

export function warmImageCache(url: string | null | undefined): void {
  const normalized = url?.trim();
  if (!normalized || typeof window === 'undefined' || !/^https?:\/\//i.test(normalized)) return;
  void readCachedImage(normalized).then(cached => {
    if (!cached) void downloadAndCacheImage(normalized).catch(() => undefined);
  });
}
