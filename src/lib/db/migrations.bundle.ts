/**
 * The migrations as the webview sees them.
 *
 * Vite inlines each generated SQL file and the journal, so the built app carries its own
 * schema history with no filesystem access. The verification scripts read the same files from
 * disk instead (`loadMigrationsFromDisk` in `scripts/verify-storage.ts`) and share the
 * applier in `migrations.ts`.
 */

import journal from '../../../drizzle/meta/_journal.json';
import type { BundledMigration } from './migrations';

// ponytail: the glob is written out in full because Vite resolves glob patterns statically.
const files = import.meta.glob('../../../drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every generated migration, in journal order. */
export const bundledMigrations: BundledMigration[] = journal.entries.map((entry) => ({
  tag: entry.tag,
  when: entry.when,
  sql: files[`../../../drizzle/${entry.tag}.sql`] ?? missing(entry.tag),
}));

function missing(tag: string): never {
  throw new Error(`the bundled migrations are missing ${tag}; run \`bun run db:generate\``);
}
