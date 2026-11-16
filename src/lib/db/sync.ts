/**
 * Writing entities back.
 *
 * A save diffs the state it was handed against what it wrote last time by *reference*: the
 * reducer only ever replaces the entities it changed, so `item !== previous.item` is exactly
 * the set of rows that need an UPDATE. Everything else is left untouched, which is what keeps
 * a 400 ms autosave from rewriting a whole lab on every streamed token.
 *
 * Order is stored too: every ordered table carries a `position` column, and a row is rewritten
 * when its index changes as well as when its contents do. Workspace tables are keyed by
 * `(scope, id)` so several projects can share one syncer without colliding.
 */

import { getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core';

import type { Db } from './client';

/** What a row mapper produces. Column names are the domain field names. */
export type Row = Record<string, unknown>;

/** Rows per statement; comfortably below SQLite's parameter-per-statement ceiling. */
const CHUNK = 100;

/** The `set` clause for an upsert: take the incoming value for every column but the key. */
function excludedSet(table: AnySQLiteTable, keyProperty: string): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [property, column] of Object.entries(getTableColumns(table))) {
    if (property === keyProperty) {
      continue;
    }
    set[property] = sql.raw(`excluded."${column.name}"`);
  }
  return set;
}

/** Insert rows, updating the ones that are already there. */
export async function upsertRows(
  db: Db,
  table: AnySQLiteTable,
  rows: Row[],
  keyProperty = 'id',
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const set = excludedSet(table, keyProperty);
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    // ponytail: drizzle's insert builder is typed per table; the mappers are where the shape
    // is actually checked (they `satisfies` the row types), so the generic call is cast, not
    // left unchecked.
    await db
      .insert(table)
      .values(chunk as never)
      .onConflictDoUpdate({ target: getTableColumns(table)[keyProperty] as never, set });
  }
}

/** Delete rows by key. */
export async function deleteRows(
  db: Db,
  table: AnySQLiteTable,
  keys: string[],
  keyProperty = 'id',
): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  for (let start = 0; start < keys.length; start += CHUNK) {
    const chunk = keys.slice(start, start + CHUNK);
    await db.delete(table).where(inArray(getTableColumns(table)[keyProperty], chunk));
  }
}

/**
 * One ordered table's rows, updated in place.
 *
 * The syncer remembers the entity references it last wrote; `sync` writes only what changed
 * and deletes what disappeared. `scope` separates rows of the same table that belong to
 * different owners (a project's tasks).
 */
export class TableSyncer<T extends { id: string }> {
  private previous = new Map<string, { item: T; position: number }>();

  constructor(
    private readonly table: AnySQLiteTable,
    private readonly toRow: (item: T, position: number, scope: string) => Row,
  ) {}

  async sync(db: Db, items: readonly T[], scope = '', force = false): Promise<void> {
    const changed: Row[] = [];
    const seen = new Set<string>();
    items.forEach((item, position) => {
      const key = `${scope}\u0000${item.id}`;
      seen.add(key);
      const before = this.previous.get(key);
      if (force || before?.item !== item || before.position !== position) {
        changed.push(this.toRow(item, position, scope));
      }
    });
    const removed = [...this.previous.keys()]
      .filter((key) => key.startsWith(`${scope}\u0000`) && !seen.has(key))
      .map((key) => key.slice(scope.length + 1));

    await upsertRows(db, this.table, changed);
    await deleteRows(db, this.table, removed);
    // Keep the other scopes' memories; replace this scope's.
    const kept = new Map([...this.previous].filter(([key]) => !key.startsWith(`${scope}\u0000`)));
    items.forEach((item, position) => {
      kept.set(`${scope}\u0000${item.id}`, { item, position });
    });
    this.previous = kept;
  }

  /** Forget what was written, so the next save rewrites everything. */
  reset(): void {
    this.previous.clear();
  }

  /**
   * Adopt `items` as the last-written set.
   *
   * The diff is against what this process wrote. A process that has just started has written
   * nothing, so its first save would rewrite every row and delete none — a row the caller
   * removed would survive. Handing the freshly loaded records to this method makes that first
   * save behave like the app's next autosave: what changed is written, what disappeared is
   * deleted, and an untouched row is left alone.
   */
  prime(items: readonly T[], scope = ''): void {
    const kept = new Map([...this.previous].filter(([key]) => !key.startsWith(`${scope}\u0000`)));
    items.forEach((item, position) => {
      kept.set(`${scope}\u0000${item.id}`, { item, position });
    });
    this.previous = kept;
  }

  /**
   * Adopt the keys already stored under `scope`, when the records themselves are not at hand.
   *
   * For a table read whole (the catalogue), the keys are enough to delete what disappears; a
   * row is rewritten on the next save, which is what a first save of a fresh process does
   * anyway.
   */
  async primeFromDb(db: Db, scope = ''): Promise<void> {
    const key = getTableColumns(this.table).id;
    const rows = (await db.select({ key }).from(this.table)) as unknown as { key: string }[];
    const kept = new Map([...this.previous].filter(([existing]) => !existing.startsWith(`${scope}\u0000`)));
    for (const row of rows) {
      kept.set(`${scope}\u0000${row.key}`, { item: { id: row.key } as T, position: -1 });
    }
    this.previous = kept;
  }
}

/**
 * A table keyed by something other than `id`, holding one JSON value per key.
 *
 * The settings rows and the review maps are this shape: a small record whose entries change
 * whole, so the diff is on the serialised value rather than on references.
 */
export class MapSyncer<T> {
  private previous = new Map<string, string>();

  constructor(
    private readonly table: AnySQLiteTable,
    private readonly keyProperty: string,
    private readonly toRow: (key: string, value: T) => Row,
  ) {}

  async sync(db: Db, entries: Record<string, T>): Promise<void> {
    const changed: Row[] = [];
    for (const [key, value] of Object.entries(entries)) {
      const serialized = JSON.stringify(value);
      if (this.previous.get(key) !== serialized) {
        changed.push(this.toRow(key, value));
      }
    }
    const removed = [...this.previous.keys()].filter((key) => !(key in entries));

    await upsertRows(db, this.table, changed, this.keyProperty);
    await deleteRows(db, this.table, removed, this.keyProperty);
    this.previous = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]));
  }

  /** Adopt `entries` as the last-written set, so a fresh process still deletes what it drops. */
  prime(entries: Record<string, T>): void {
    this.previous = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]));
  }

  /** Forget what was written, so the next save rewrites everything. */
  reset(): void {
    this.previous.clear();
  }
}
