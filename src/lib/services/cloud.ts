/**
 * The connected cloud stores, as a service.
 *
 * Same shape as the sources: a list the Files page subscribes to, written through to SQLite,
 * owned by the container instead of a module-level `let`. The paired folders ride along — one
 * store is nothing without the other — so the Files page reads both from here.
 */

import { loadConnections, loadPairs, saveConnections, savePairs } from '@/lib/db/catalog';
import { getDb, serialized } from '@/lib/db/client';
import type { CloudConnection, SyncPair } from '@/lib/cloud/types';
import { ExternalStore } from './external';

export class CloudService {
  readonly store = new ExternalStore<CloudConnection[]>([]);
  readonly pairs = new ExternalStore<SyncPair[]>([]);

  /** Fill both lists from the database. Called once, by `bootStorage`. */
  async hydrate(): Promise<void> {
    const db = getDb();
    if (!db) {
      return;
    }
    this.store.set(await loadConnections(db));
    this.pairs.set(await loadPairs(db));
  }

  private persist(): void {
    const db = getDb();
    if (!db) {
      return;
    }
    void serialized(() => saveConnections(db, this.store.get())).catch((error) => {
      console.error('openlab could not write the cloud connections', error);
    });
  }

  private persistPairs(): void {
    const db = getDb();
    if (!db) {
      return;
    }
    void serialized(() => savePairs(db, this.pairs.get())).catch((error) => {
      console.error('openlab could not write the paired folders', error);
    });
  }

  /** Add a connection to the front of the list. */
  add(connection: CloudConnection): void {
    this.store.update((items) => [connection, ...items]);
    this.persist();
  }

  /** Remove a connection, and every folder paired through it. */
  remove(id: string): void {
    this.store.update((items) => items.filter((connection) => connection.id !== id));
    this.pairs.update((items) => items.filter((pair) => pair.connectionId !== id));
    this.persist();
    this.persistPairs();
  }

  /** A connection by id, or undefined when the link is stale. */
  find(id: string): CloudConnection | undefined {
    return this.store.get().find((connection) => connection.id === id);
  }

  /** Add a paired folder to the front of the list. */
  addPair(pair: SyncPair): void {
    this.pairs.update((items) => [pair, ...items]);
    this.persistPairs();
  }

  /** Remove a paired folder. The two folders themselves are untouched. */
  removePair(id: string): void {
    this.pairs.update((items) => items.filter((pair) => pair.id !== id));
    this.persistPairs();
  }

  /** A pair by id, or undefined when the link is stale. */
  findPair(id: string): SyncPair | undefined {
    return this.pairs.get().find((pair) => pair.id === id);
  }
}
