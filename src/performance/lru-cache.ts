/** Tiny bounded LRU used for derived runtime geometry/layout only. */
export class LruCache<K, V> {
  private readonly values = new Map<K, V>();
  hits = 0;
  misses = 0;

  constructor(readonly capacity: number) {}

  get(key: K): V | undefined {
    const value = this.values.get(key);
    if (value === undefined) {
      this.misses++;
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, value);
    this.hits++;
    return value;
  }

  set(key: K, value: V): void {
    if (this.values.has(key)) this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > Math.max(1, this.capacity)) {
      const oldest = this.values.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }

  clear(): void {
    this.values.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number { return this.values.size; }
}
