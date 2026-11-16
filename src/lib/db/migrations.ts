/**
 * Applying generated migrations.
 *
 * `drizzle-kit generate` writes `drizzle/NNNN_name.sql` plus a journal; this runs those files
 * against whatever database the app booted, recording each in a `__drizzle_migrations` table
 * shaped exactly like drizzle's own migrator, so the bookkeeping stays compatible with
 * drizzle-kit tooling.
 *
 * The SQL arrives as strings rather than as a folder: inside the webview there is no
 * filesystem, and the bundle in `migrations.bundle.ts` is what carries them. The verification
 * scripts load the same files from disk and share this applier, so the tested path and the
 * shipped path are one path.
 */

import { sql } from 'drizzle-orm';

import type { Db } from './client';

/** One generated migration, as the applier needs it. */
export interface BundledMigration {
  /** The journal tag, e.g. `0000_ancient_gladiator`. */
  tag: string;
  /** The journal's creation time; also the ordering key. */
  when: number;
  /** The file's full SQL text. */
  sql: string;
}

/** Split a generated file into the statements the executor runs one at a time. */
export function splitStatements(text: string): string[] {
  return text
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** SHA-256 in the browser, the tag elsewhere; used only as a content fingerprint. */
async function fingerprint(text: string): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) {
    return `unhashed:${text.length}`;
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** True when the table drizzle's migrator keeps its bookkeeping in exists. */
const ENSURE_TABLE = sql`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )
`;

/**
 * The migrations this database still needs, after proving that every recorded one is the
 * file this build carries.
 *
 * The old applier compared only timestamps: an edited migration, or a database written by a
 * newer build, was silently accepted. A mismatch now stops the boot rather than running a
 * half-understood schema.
 */
export async function pendingMigrations(db: Db, migrations: BundledMigration[]): Promise<BundledMigration[]> {
  await db.run(ENSURE_TABLE);
  const applied = await db.values<[unknown, unknown]>(
    sql`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC`,
  );
  const byWhen = new Map(migrations.map((migration) => [migration.when, migration]));

  let last = 0;
  for (const [hash, createdAt] of applied) {
    const when = Number(createdAt ?? 0);
    last = Math.max(last, when);
    const migration = byWhen.get(when);
    if (!migration) {
      throw new Error(
        `the database records a migration this build does not carry (created_at ${when}); open it with a newer openlab or restore a backup`,
      );
    }
    const expected = await fingerprint(migration.sql);
    if (expected !== hash) {
      throw new Error(
        `migration ${migration.tag} does not match the one this database was built with; restore a backup instead of running a different schema`,
      );
    }
  }

  return [...migrations].sort((a, b) => a.when - b.when).filter((one) => one.when > last);
}

/**
 * Apply every migration the database has not seen yet, in order.
 *
 * Each file runs in its own transaction together with its bookkeeping row, so an interrupted
 * migration is either fully applied and recorded, or not applied at all.
 */
export async function applyMigrations(db: Db, migrations: BundledMigration[]): Promise<void> {
  const pending = await pendingMigrations(db, migrations);
  for (const migration of pending) {
    const hash = await fingerprint(migration.sql);
    await db.transaction(async (tx) => {
      for (const statement of splitStatements(migration.sql)) {
        await tx.run(sql.raw(statement));
      }
      await tx.run(
        sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${hash}, ${migration.when})`,
      );
    });
  }
}
