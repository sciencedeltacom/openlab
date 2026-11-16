/**
 * The database handle.
 *
 * Drizzle's SQLite proxy driver is what makes the same schema code run in two places: inside
 * the Tauri webview, where every statement travels over IPC to Rust and SQLite (`tauri.ts`),
 * and inside the verification scripts, where the same statements run against `bun:sqlite`.
 * The driver only needs an {@link Executor} — a function that takes SQL and returns rows —
 * so everything above this line is ordinary Drizzle.
 *
 * One {@link Db} is created at boot and read through {@link getDb}. Writes go through
 * {@link serialized} so a `begin`/`commit` issued by a transaction is never interleaved with
 * someone else's statement: SQLite has one writer and this is it.
 */

import { drizzle, type AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import { sql } from 'drizzle-orm';

import * as schema from './schema';

/** The verbs drizzle asks a proxy driver to run. */
export type SqlMethod = 'run' | 'all' | 'values' | 'get';

/**
 * Execute one statement.
 *
 * `rows` is a list of positional rows for `all`/`values`, the row itself for `get` (or `null`
 * when there is none) — which is what drizzle's proxy maps, and why this cannot be typed as
 * `unknown[]`.
 */
export type Executor = (sql: string, params: unknown[], method: SqlMethod) => Promise<{ rows: unknown }>;

/** A drizzle database bound to the schema. */
export type Db = ReturnType<typeof createDb>;

/** Bind an executor to the schema. */
export function createDb(executor: Executor) {
  return drizzle(executor as unknown as AsyncRemoteCallback, { schema });
}

let current: Db | null = null;

/** Install the database the app reads through. Called once, at boot. */
export function setDb(db: Db | null): void {
  current = db;
}

/** The database, or `null` in a plain browser where there is no SQLite to talk to. */
export function getDb(): Db | null {
  return current;
}

let tail: Promise<unknown> = Promise.resolve();

/**
 * Run `work` after everything already queued has finished.
 *
 * A save is a transaction over many statements; two saves racing would interleave their
 * `begin`/`commit` blocks. This is the queue that makes writes sequential without making the
 * callers async-aware.
 */
export function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work);
  tail = run.catch(() => undefined);
  return run;
}

/**
 * Run `work` inside a transaction on the shared connection.
 *
 * The proxy driver has no interactive transaction of its own — it would issue exactly these
 * `begin`/`commit` statements — so this is not a reimplementation, just the same thing with
 * the {@link Db} type kept intact for the writers inside.
 */
export async function withTransaction(db: Db, work: () => Promise<void>): Promise<void> {
  await db.run(sql`begin`);
  try {
    await work();
    await db.run(sql`commit`);
  } catch (error) {
    await db.run(sql`rollback`);
    throw error;
  }
}
