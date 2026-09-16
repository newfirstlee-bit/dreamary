import { reportImageLoadFailure, ImageKind } from './imageDiagnostics';
import { resolveImageFromCacheOrNetwork } from './imageCache';

const loadingImages = new Map<string, Promise<Blob | null>>();
const resolvedImages = new Map<string, Blob>();
const MAX_PRELOADED_IMAGES = 20;

const normalizeImageUrl = (url: string | null | undefined) => {
  const trimmed = url?.trim();
  return trimmed || null;
};

export function preloadImage(
  url: string | null | undefined,
  kind: ImageKind = 'home_background'
): Promise<Blob | null> {
  const normalized = normalizeImageUrl(url);
  if (!normalized || typeof window === 'undefined') return Promise.resolve(null);
  const resolved = resolvedImages.get(normalized);
  if (resolved) { resolvedImages.delete(normalized); resolvedImages.set(normalized, resolved); return Promise.resolve(resolved); }
  const existing = loadingImages.get(normalized);
  if (existing) return existing;

  const promise = resolveImageFromCacheOrNetwork(normalized)
    .then(blob => {
      resolvedImages.set(normalized, blob);
      while (resolvedImages.size > MAX_PRELOADED_IMAGES || Array.from(resolvedImages.values()).reduce((total, image) => total + image.size, 0) > 50 * 1024 * 1024) {
        const oldest = resolvedImages.keys().next().value!;
        resolvedImages.delete(oldest);
      }
      return blob;
    })
    .catch(error => {
      reportImageLoadFailure(normalized, kind, error instanceof Error ? error.message : 'unknown');
      throw error;
    })
    .finally(() => loadingImages.delete(normalized));

  loadingImages.set(normalized, promise);
  return promise;
}

export async function preloadImages(
  urls: Array<string | null | undefined>,
  concurrency = 4
): Promise<void> {
  if (typeof window === 'undefined') return;

  const queue = Array.from(new Set(urls.map(normalizeImageUrl).filter(Boolean))) as string[];
  if (queue.length === 0) return;

  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, queue.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (index < queue.length) {
        const current = queue[index++];
        try {
          await preloadImage(current);
        } catch {
          // 미리 불러오기에 실패해도 화면 전환 자체를 막지 않는다.
        }
      }
    })
  );
}
