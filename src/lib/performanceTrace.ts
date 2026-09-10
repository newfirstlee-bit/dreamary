type Operation = 'diary.create' | 'diary.edit';
type Phase = 'api' | 'lookup' | 'generation' | 'regeneration' | 'save' | 'delete';

/** Fixed labels only: never include diary text, tokens, UID or image URLs. */
export async function measurePhase<T>(operation: Operation, phase: Phase, action: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let success = false;
  try {
    const result = await action();
    success = true;
    return result;
  } finally {
    const entry = { operation, phase, durationMs: Math.round(performance.now() - started), success, at: Date.now() };
    console.info('[dreamary_performance]', entry);
    if (typeof window !== 'undefined') {
      try {
        const raw = JSON.parse(localStorage.getItem('dreamary_performance') || '[]');
        const history = Array.isArray(raw) ? raw : [];
        localStorage.setItem('dreamary_performance', JSON.stringify([...history.slice(-99), entry]));
      } catch { /* Diagnostics must never fail an API call. */ }
    }
  }
}
