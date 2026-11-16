/**
 * The databases the workbench knows about.
 *
 * Kept in a tiny external store rather than the app reducer: a database is a self-contained
 * record that only the database screens read, and a `useSyncExternalStore` keeps those screens
 * in step when one is added or removed without threading a new slice through the whole store.
 * The list is stored in the app's SQLite database, so a database added today is there next
 * launch; in a plain browser it lives in memory for the session.
 */

import { useSyncExternalStore } from 'react';

import { getDb, serialized } from '@/lib/db/client';
import { loadDatabases, saveDatabases } from '@/lib/db/catalog';
import { DATABASES, type Database } from './data';

let items: Database[] = [...DATABASES];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Repair a stored row the shipped catalogue has since grown past.
 *
 * The operations table was added after these rows were first written down, so a database
 * seeded before it carries an empty `operations` list and cannot search. The shipped
 * definition for that id is authoritative for the shape; the user's own edits stay.
 */
export function reconcileDatabase(database: Database): Database {
  if (database.operations?.length) {
    return database;
  }
  const shipped = DATABASES.find((base) => base.id === database.id);
  return shipped ? { ...database, operations: shipped.operations } : database;
}

/** Fill the list from the database. Called once, by `bootStorage`. */
export async function hydrateDatabases(): Promise<void> {
  const db = getDb();
  if (!db) {
    return;
  }
  const stored = await loadDatabases(db);
  if (stored.length > 0) {
    items = stored.map(reconcileDatabase);
    emit();
    return;
  }
  // First run on this machine: the shipped catalogue is the starting point, written down once
  // so it behaves like any other row — the user can edit or remove any of it.
  items = [...DATABASES];
  void serialized(() => saveDatabases(db, items));
  emit();
}

function persist(): void {
  const db = getDb();
  if (!db) {
    return;
  }
  void serialized(() => saveDatabases(db, items)).catch((error) => {
    console.error('openlab could not write the database catalogue', error);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The databases, live. */
export function useDatabases(): Database[] {
  return useSyncExternalStore(subscribe, () => items);
}

/** A database by id, or undefined when the link is stale. */
export function findDatabase(id: string): Database | undefined {
  return items.find((database) => database.id === id);
}

/** Every database, in order. For readers that are not components — the agent's tools. */
export function allDatabases(): Database[] {
  return items;
}

/** Add a database to the front of the catalogue. */
export function addDatabase(database: Database): void {
  items = [database, ...items];
  persist();
  emit();
}

/** Remove a database. */
export function removeDatabase(id: string): void {
  items = items.filter((database) => database.id !== id);
  persist();
  emit();
}
