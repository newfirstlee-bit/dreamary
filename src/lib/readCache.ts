/** Bounded, short-lived read cache. Invalidation also detaches pending reads. */
export class ReadCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();
  private pending = new Map<string, Promise<T>>();

  constructor(private ttlMs: number, private maxEntries = 100) {}

  get(key: string, read: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    this.entries.delete(key);
    const pending = this.pending.get(key);
    if (pending) return pending;

    const request = Promise.resolve().then(read).then(value => {
      // A write/logout during a read must not repopulate the invalidated cache.
      if (this.pending.get(key) === request) {
        this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        while (this.entries.size > this.maxEntries) {
          this.entries.delete(this.entries.keys().next().value!);
        }
      }
      return value;
    }).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  clear() {
    this.entries.clear();
    this.pending.clear();
  }
}
