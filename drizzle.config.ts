/**
 * Drizzle Kit configuration.
 *
 * `bun run db:generate` turns `src/lib/db/schema.ts` into the SQL files under `drizzle/`,
 * which the app bundles and applies at startup (see `src/lib/db/migrations.ts`). Migrations
 * are generated, never hand-edited; a schema change is a schema edit plus a generate.
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
});
