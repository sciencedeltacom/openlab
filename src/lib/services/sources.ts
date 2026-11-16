/**
 * The saved sources, as a service.
 *
 * The list used to be a module-level `let` with its own listener set — shared mutable state
 * that no one owned and nothing could release. It is a service now: the container builds it
 * once, hands it to whoever needs it, and the state lives in a field rather than in the module.
 * The public functions in `@/lib/catalog/sources` are thin wrappers over this, so the screens
 * never had to learn about the change.
 */

import { loadSources, saveSources } from '@/lib/db/catalog';
import { getDb, serialized } from '@/lib/db/client';
import type { Source } from '@/lib/catalog/sources';
import { ExternalStore } from './external';

export class SourcesService {
  readonly store = new ExternalStore<Source[]>([]);

  /** Fill the list from the database. Called once, by `bootStorage`. */
  async hydrate(): Promise<void> {
    const db = getDb();
    if (!db) {
      return;
    }
    this.store.set(await loadSources(db));
  }

  private persist(): void {
    const db = getDb();
    if (!db) {
      return;
    }
    void serialized(() => saveSources(db, this.store.get())).catch((error) => {
      console.error('openlab could not write the sources', error);
    });
  }

  /** Add a source to the front of the list. */
  add(source: Source): void {
    this.store.update((items) => [source, ...items]);
    this.persist();
  }

  /** Remove a source. */
  remove(id: string): void {
    this.store.update((items) => items.filter((source) => source.id !== id));
    this.persist();
  }

  /** Change a source in place — its name, its database, its filters, its preview. */
  patch(id: string, patch: Partial<Source>): void {
    this.store.update((items) =>
      items.map((source) => (source.id === id ? { ...source, ...patch, id: source.id } : source)),
    );
    this.persist();
  }

  /** A source by id, or undefined when the link is stale. */
  find(id: string): Source | undefined {
    return this.store.get().find((source) => source.id === id);
  }

  /** Every source id, for a reader that only needs the keys. */
  ids(): string[] {
    return this.store.get().map((source) => source.id);
  }
}
