/**
 * The headless workbench.
 *
 * A command needs the same two things the app boots with: the SQLite store (workspaces,
 * sessions, the tracker, the catalogue) and the folder the lab works in. This module opens
 * both through the app's own code — `lib/db` for the store, the store modules for the
 * catalogue, `store/persist` for the persisted slice — so a change made here is a change the
 * app sees, in the same file, with the same shape. Nothing about the storage layer is
 * reimplemented; only the Rust half of the transport is, over `bun:sqlite`.
 */

import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { hydrateAgents } from '@/components/agents/store';
import { hydrateTopics } from '@/components/autoresearch/store';
import { hydrateDatabases } from '@/components/databases/store';
import { hydrateExperiments } from '@/components/experiments/store';
import { hydrateLiterature } from '@/components/literature/store';
import { hydrateSources } from '@/lib/catalog/sources';
import { hydrateConnections } from '@/lib/cloud/store';
import { createDb, serialized, setDb, type Db, type Executor } from '@/lib/db/client';
import { primeCatalogSyncers } from '@/lib/db/catalog';
import { primeExperimentSyncers } from '@/lib/db/experiments';
import { applyMigrations, type BundledMigration } from '@/lib/db/migrations';
import { primeStateSyncers, saveState } from '@/lib/db/state';
import { randomProjectIcon } from '@/lib/project-icons';
import { initPersistence, loadPersisted } from '@/store/persist';
import { seedState } from '@/store/seed';
import { activeProject, type AppState, type Project } from '@/store/types';
import { emptyWorkspace, loadWorkspace } from '@/store/workspace';
import { appRoot, dataDir as defaultDataDir } from './paths';

/** An open workbench: the store, the state, and the folder it was opened on. */
export interface Lab {
  /** Drizzle over the workbench's SQLite file. */
  db: Db;
  /** The same connection, for the commands that would rather speak SQL. */
  sqlite: Database;
  /** The app state, with the active workspace's records spread onto it. */
  state: AppState;
  /** The lab folder, when one was found or created. */
  root: string | null;
  /** The project record for that folder. */
  project: Project | null;
  /** Write the workspace slice, the settings, and anything the catalogue stores changed. */
  save(): Promise<void>;
  close(): void;
}

/** The generated migrations, read from `drizzle/` the way the app bundles them at build time. */
function migrationsFromDisk(): BundledMigration[] {
  const folder = join(appRoot(), 'drizzle');
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  return journal.entries.map((entry) => ({
    tag: entry.tag,
    when: entry.when,
    sql: readFileSync(join(folder, `${entry.tag}.sql`), 'utf8'),
  }));
}

/** The executor contract, over `bun:sqlite`. The same one the verification scripts use. */
function executorFor(sqlite: Database): Executor {
  return async (sql, params, method) => {
    const statement = sqlite.query(sql);
    if (method === 'run') {
      statement.run(...(params as never[]));
      return { rows: [] };
    }
    const rows = statement.values(...(params as never[])) as unknown[][];
    // `get` answers with the row itself (or null), as drizzle's proxy expects.
    return { rows: method === 'get' ? (rows[0] ?? null) : rows };
  };
}

/** Open the store, bring the schema up to date, and fill the catalogue stores. */
export async function openStore(dir = defaultDataDir(true)): Promise<{ db: Db; sqlite: Database }> {
  const sqlite = new Database(process.env.OPENLAB_DB ?? join(dir, 'openlab.db'));
  // The Rust connection turns foreign keys on and keeps WAL; a second process may hold the
  // file (the app is open), so a busy writer waits rather than failing.
  sqlite.run('pragma journal_mode = WAL');
  sqlite.run('pragma foreign_keys = ON');
  sqlite.run('pragma busy_timeout = 5000');

  const db = createDb(executorFor(sqlite));
  await serialized(() => applyMigrations(db, migrationsFromDisk()));
  setDb(db);

  await Promise.all([
    hydrateDatabases(),
    hydrateAgents(),
    hydrateTopics(),
    hydrateSources(),
    hydrateConnections(),
    hydrateExperiments(),
    hydrateLiterature(),
  ]);

  // The catalogue stores hydrate by reading; the writers still have no memory of what is
  // stored, so a removal would not reach the database. See `TableSyncer.primeFromDb`.
  await primeCatalogSyncers(db);
  await primeExperimentSyncers(db);

  return { db, sqlite };
}

/** Make a folder active, the way the reducer's `project/open` does. */
function activate(state: AppState, project: Project): void {
  Object.assign(state, {
    activeProjectId: project.id,
    ...loadWorkspace(project.workspace),
    tabs: [],
    route: 'home',
  });
}

/** Register a folder as a project, mirroring the reducer's `project/open`. */
function register(state: AppState, path: string, name?: string): Project {
  const project: Project = {
    id: `p-${crypto.randomUUID().slice(0, 8)}`,
    name: name ?? path.split('/').filter(Boolean).pop() ?? path,
    path,
    icon: randomProjectIcon(),
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    workspace: emptyWorkspace(),
  };
  state.projects = [...state.projects, project];
  return project;
}

/** What to open. */
export interface OpenOptions {
  /** The app data directory; defaults to the desktop app's. */
  dataDir?: string;
  /** The lab folder. `null` opens the store alone, with no workspace. */
  root?: string | null;
  /** The name to register a folder under, when it is not a project yet. */
  name?: string;
}

/**
 * Open the workbench.
 *
 * The store always opens; the workspace opens when a folder was named or found. A folder the
 * workbench has not seen is registered the way the app registers one when it opens it — the
 * record exists from here on and is written when the command saves. Registering matters for
 * correctness as well as convenience: without it the flat state would still hold whatever
 * project was active in the store, and a command would read and write the wrong lab.
 */
export async function openLab(options: OpenOptions = {}): Promise<Lab> {
  const dir = options.dataDir ? resolve(options.dataDir) : defaultDataDir(true);
  const { db, sqlite } = await openStore(dir);

  await initPersistence();
  const state = seedState(loadPersisted());
  // Adopt what is stored as the last-written state, so a removal in this process reaches the
  // database. See `primeStateSyncers`.
  await primeStateSyncers(db, state);

  let root: string | null = options.root ? resolve(options.root) : null;
  let project: Project | null = null;

  if (root) {
    const wanted = root;
    project =
      state.projects.find((candidate) => resolve(candidate.path) === wanted) ??
      register(state, wanted, options.name);
    project.lastOpenedAt = Date.now();
    activate(state, project);
    root = resolve(project.path);
  }

  return {
    db,
    sqlite,
    state,
    root,
    project,
    async save(): Promise<void> {
      await saveState(db, state);
      // The catalogue stores queue their own writes; drain them before the process exits.
      await serialized(async () => undefined);
    },
    close(): void {
      sqlite.close();
    },
  };
}

/** The project a lab is working in, or a readable failure. */
export function requireProject(lab: Lab): Project {
  const project = lab.project ?? activeProject(lab.state);
  if (!project) {
    throw new Error('No lab folder is open. Run `openlab init <dir>` or pass --workspace.');
  }
  return project;
}
