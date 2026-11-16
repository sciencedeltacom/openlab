/**
 * A review run's scratch, scoped to the run.
 *
 * Deduplicating retrieved records is per-run state: it is only meaningful while one run is
 * reading pages, and it must not outlive it. So it is a **scoped** service — the container
 * creates one when a run opens its scope and disposes it when the run finishes, which is what
 * makes "this memory belongs to one unit of work" a fact the graph enforces rather than a
 * convention in a comment.
 *
 * The set of seen ids is bounded: a run that pages through thousands of records keeps the most
 * recent few thousand, which is more than enough to collapse the overlap between consecutive
 * pages, and never an unbounded list.
 */

import { LruCache } from '@/lib/cache/lru';

/** How many ids a run remembers before the oldest fall off. */
const SEEN_CAPACITY = 5_000;

export class RunBuffer {
  private readonly seen = new LruCache<string, true>(SEEN_CAPACITY);

  /** Whether this run has already taken this record in. */
  has(id: string): boolean {
    return this.seen.get(id) === true;
  }

  /** Take a record in, so the next page that repeats it is ignored. */
  mark(id: string): void {
    this.seen.set(id, true);
  }

  /** How many distinct records this run is still holding. */
  get count(): number {
    return this.seen.size;
  }

  /** Release the run's scratch. Called by the scope when the run finishes. */
  dispose(): void {
    this.seen.clear();
  }
}
