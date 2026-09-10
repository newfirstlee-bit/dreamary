export type ImageKind = 'character_profile' | 'user_profile' | 'home_background' | 'image_preview';

const reportedFailures = new Set<string>();

export function reportImageLoadFailure(url: string, kind: ImageKind, reason: string): void {
  if (typeof window === 'undefined') return;

  let host = 'unknown';
  try {
    host = new URL(url).hostname;
  } catch {
    // URL 자체는 전송하지 않고 호스트 파싱 실패만 구분합니다.
  }

  const dedupeKey = `${kind}:${url}`;
  if (reportedFailures.has(dedupeKey)) return;
  reportedFailures.add(dedupeKey);

  const clarity = (window as Window & { clarity?: (...args: unknown[]) => void }).clarity;
  if (!clarity) return;

  clarity('set', 'image_failure_kind', kind);
  clarity('set', 'image_failure_host', host);
  clarity('set', 'image_failure_reason', reason.slice(0, 40));
  clarity('event', 'image_load_failed');
}
