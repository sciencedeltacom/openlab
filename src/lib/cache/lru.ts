/**
 * A cache with a ceiling.
 *
 * Anything that remembers across calls needs a limit, or it is a leak with extra steps. This
 * keeps at most `capacity` entries and drops the least recently used one when it is full: a
 * `get` counts as use, so the entries that stay are the ones actually being read.
 *
 * It is small on purpose. The app has few caches — a single-value one needs no class — and the
 * ones that matter are per-unit-of-work buffers that a scope disposes.
 */

export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly capacity: number) {}

  /** The value for a key, marked as recently used. */
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) {
      return undefined;
    }
    // Re-insert so the key moves to the end, which is the "most recent" side.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Remember a value, dropping the least recently used entry when the cache is full. */
  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
  }

  /** How many entries are held — never more than the capacity. */
  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
