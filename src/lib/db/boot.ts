/**
 * Storage boot.
 *
 * The desktop app keeps its records in SQLite (see `src/lib/db`). Booting means: open the
 * database through the Rust command surface, bring the schema up to date, then hydrate every
 * in-memory store from it — before the first render, so no surface ever shows seed data that
 * is about to be replaced by what is actually there.
 *
 * In a plain browser (`vite dev` without Tauri) there is nothing to reach; the app runs in
 * memory and nothing persists. Boot never throws: a failed database must not keep the
 * workbench from opening.
 */

import { hydrateDatabases } from '../../components/databases/store';
import { hydrateAgents } from '../../components/agents/store';
import { hydrateTopics } from '../../components/autoresearch/store';
import { hydrateLiterature } from '../../components/literature/store';
import { initPersistence } from '../../store/persist';
import { invokeCommand, isDesktop } from '../ipc';
import { hydrateSources } from '../catalog/sources';
import { hydrateConnections } from '../cloud/store';
import { hydrateExperiments } from '../../components/experiments/store';
import { logError } from '@/lib/log';
import { createDb, serialized, setDb } from './client';
import { reportStorageIssue, clearStorageIssue } from './health';
import { applyMigrations, pendingMigrations } from './migrations';
import { bundledMigrations } from './migrations.bundle';
import { tauriExecutor } from './tauri';

let booted = false;
let attempt: Promise<void> | null = null;

/**
 * Open the database, migrate it, and hydrate the stores.
 *
 * Safe to call more than once: a successful boot is final, and a failed one may be retried
 * (the notice above the shell offers that button). A retry must not race the first attempt,
 * so the in-flight promise is shared.
 */
export function bootStorage(): Promise<void> {
  if (booted) return Promise.resolve();
  attempt ??= open().finally(() => {
    attempt = null;
  });
  return attempt;
}

async function open(): Promise<void> {
  if (!isDesktop()) {
    // Browser development is intentionally in-memory; there is nothing to warn about.
    booted = true;
    return;
  }
  try {
    const db = createDb(tauriExecutor());
    // A backup is cheap next to losing the schema. It is taken only when there is something
    // to apply, and a failed backup stops the migration rather than proceeding unprotected.
    await serialized(async () => {
      const pending = await pendingMigrations(db, bundledMigrations);
      if (pending.length > 0) {
        const backup = await invokeCommand<string | null>('db_backup', {});
        if (!backup.ok) {
          throw new Error(`could not back up the database before migrating: ${backup.error.message}`);
        }
      }
      await applyMigrations(db, bundledMigrations);
    });
    setDb(db);
    await Promise.all([
      initPersistence(),
      hydrateDatabases(),
      hydrateAgents(),
      hydrateTopics(),
      hydrateSources(),
      hydrateConnections(),
      hydrateExperiments(),
      hydrateLiterature(),
    ]);
    // A daily copy, taken after the schema is current and before the reader does any work.
    // It is best-effort: a failed copy must not keep the workbench from opening.
    void invokeCommand<string | null>('db_backup_if_due', { hours: 24 }).then((result) => {
      if (!result.ok) {
        void logError('backup', new Error(result.error.message));
      }
    });
    booted = true;
    clearStorageIssue('open');
  } catch (error) {
    void logError('boot', error);
    // The workbench still opens, but it will not remember anything — say so visibly instead
    // of logging it where only a developer will see it.
    console.error('openlab could not open its database; this session will not persist', error);
    reportStorageIssue('open', error);
  }
}
