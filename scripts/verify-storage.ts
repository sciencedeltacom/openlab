/**
 * Checks the SQLite storage layer.
 *
 * Run with: `bun scripts/verify-storage.ts`
 *
 * The app stores everything through drizzle's SQLite proxy driver: inside the webview every
 * statement travels to Rust and rusqlite, and here they run against `bun:sqlite` through the
 * same {@link Executor} contract, so the shipped path and the tested path are the same code.
 *
 * What is pinned here: the generated migrations apply (once), every schema table exists, the
 * app state survives a save/load round-trip with its ordering and JSON columns intact, a save
 * only writes what changed and deletes what disappeared, removing a project takes its rows
 * with it, the catalogue stores round-trip, and the boot that closes interrupted blocks runs.
 */

import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, getTableName } from 'drizzle-orm';

import { createDb, serialized, setDb, type Db, type Executor } from '../src/lib/db/client';
import { applyMigrations, splitStatements, type BundledMigration } from '../src/lib/db/migrations';
import {
  loadDatabases,
  loadSources,
  resetCatalogSyncers,
  saveDatabases,
  saveSources,
} from '../src/lib/db/catalog';
import { loadLiterature, saveLiterature } from '../src/lib/db/literature';
import { loadAgents, resetAgentSyncer, saveAgents } from '../src/lib/db/agents';
import { loadTopics, resetTopicSyncer, saveTopics } from '../src/lib/db/research';
import { clearState, loadState, resetStateSyncers, saveState } from '../src/lib/db/state';
import { schema as storageSchema } from '../src/lib/db/schema';
import { DEFAULT_EXECUTION } from '../src/lib/execution';
import { DEFAULT_GUARD } from '../src/lib/guard';
import { DEFAULT_PROMPTS } from '../src/lib/settings';
import { DATABASES, findOperation } from '../src/components/databases/data';
import { findDatabase, hydrateDatabases } from '../src/components/databases/store';
import { findArgs, sourceUrl } from '../src/lib/catalog/sources';
import type { Agent } from '../src/components/agents/data';
import type { ResearchTopic } from '../src/components/autoresearch/data';
import { initPersistence, loadPersisted } from '../src/store/persist';
import { emptyWorkspace, loadWorkspace } from '../src/store/workspace';
import { seedState } from '../src/store/seed';
import { newLabel, newMember, newTask, newWave } from '../src/store/research';
import type { AppState, Message, Project, WorkspaceData } from '../src/store/types';
import type { Job, Target } from '../src/store/compute';
import type { InboxEntry, Note, SavedView, Task } from '../src/store/research';
import type { ScienceRecord } from '../src/lib/science/connectors';
import type { Provider } from '../src/lib/providers';
import type { Database as CatalogDatabase } from '../src/components/databases/data';
import type { Source } from '../src/lib/catalog/sources';
import type { Paper, Review, ReviewContent } from '../src/components/literature/data';

let failures = 0;

/** Assert equality and report the difference rather than throwing. */
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
}

/** Assert a truthy value; used where the message, not the shape, is the point. */
function checkTruthy(label: string, value: unknown) {
  if (value) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected a truthy value\n     actual   ${JSON.stringify(value)}`);
}

/** The first path at which two values differ, for a readable failure on big fixtures. */
function firstDifference(actual: unknown, expected: unknown, path = '$'): string | null {
  if (Object.is(actual, expected)) {
    return null;
  }
  const actualArray = Array.isArray(actual);
  const expectedArray = Array.isArray(expected);
  if (actualArray !== expectedArray) {
    return `${path}: ${actualArray ? 'array' : JSON.stringify(actual)} vs ${expectedArray ? 'array' : JSON.stringify(expected)}`;
  }
  if (actualArray && expectedArray) {
    if (actual.length !== expected.length) {
      return `${path}: lengths ${actual.length} vs ${expected.length}`;
    }
    for (let index = 0; index < actual.length; index += 1) {
      const difference = firstDifference(actual[index], expected[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (typeof actual === 'object' && typeof expected === 'object' && actual && expected) {
    // Key order is not a difference: the fixtures and the rows do not agree on it, and
    // nothing in the app depends on it.
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const key of keys) {
      const difference = firstDifference(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (difference) return difference;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`;
}

/** Assert deep equality; a mismatch reports the first differing path, not the whole object. */
function checkDeep(label: string, actual: unknown, expected: unknown) {
  const difference = firstDifference(actual, expected);
  if (!difference) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     ${difference}`);
}

/** An in-memory database, reached through the same executor contract as the Tauri one. */
function memoryDb(): { db: Db; sqlite: Database } {
  const sqlite = new Database(':memory:');
  // The Rust connection turns foreign keys on; the in-memory stand-in does the same so a
  // cascade the app relies on is a cascade the test sees.
  sqlite.run('pragma foreign_keys = ON');
  const executor: Executor = async (sql, params, method) => {
    const statement = sqlite.query(sql);
    if (method === 'run') {
      statement.run(...(params as never[]));
      return { rows: [] };
    }
    const rows = statement.values(...(params as never[])) as unknown[][];
    // `get` answers with the row itself (or null), as drizzle's proxy expects.
    return { rows: method === 'get' ? (rows[0] ?? null) : rows };
  };
  return { db: createDb(executor), sqlite };
}

/** The generated migrations, read from disk the way the app bundles them at build time. */
function loadMigrationsFromDisk(): BundledMigration[] {
  const folder = join(import.meta.dir, '..', 'drizzle');
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  return journal.entries.map((entry) => ({
    tag: entry.tag,
    when: entry.when,
    sql: readFileSync(join(folder, `${entry.tag}.sql`), 'utf8'),
  }));
}

/** The tables that exist in the file. */
function tableNames(sqlite: Database): string[] {
  return (sqlite.query("select name from sqlite_master where type = 'table'").values() as [string][]).map(
    ([name]) => name,
  );
}

/** How many rows a table holds. */
function countRows(sqlite: Database, table: string): number {
  const row = sqlite.query(`select count(*) as n from "${table}"`).get() as { n: number };
  return row.n;
}

const now = Date.now();

/** A tiny workspace for the second project, so removing it has something to cascade. */
function sideWorkspace(): WorkspaceData {
  return {
    ...emptyWorkspace(),
    sessions: [
      {
        id: 's-pb',
        projectId: 'p-b',
        title: 'Side thread',
        createdAt: now - 3000,
        updatedAt: now - 3000,
        phase: 'ANALYSIS',
      },
    ],
    transcripts: {
      's-pb': [
        { id: 'm-pb', role: 'user', blocks: [{ kind: 'text', text: 'Side thought' }], createdAt: now - 3000 },
      ],
    },
  };
}

/* ================================================================================================
 * Fixtures
 * ============================================================================================== */

/** A workspace with one of everything, so every mapper is exercised. */
function richWorkspace(): WorkspaceData {
  const member = newMember('Ada Lovelace', 'PI', 'ada@lab.example');
  const label = newLabel('Assay', '#1E5DB3', 'method');
  const wave = newWave([]);
  const task: Task = {
    ...newTask([], 'Dock the panel'),
    waveId: wave.id,
    assigneeId: member.id,
    labels: [label.id],
    priority: 3,
    estimate: 3,
    dueDate: '2026-10-31',
    relations: [{ type: 'blocks', id: 't-other' }],
    evidence: [{ id: 'e-1', kind: 'dataset', title: 'Assay table', ref: 'data/assay.csv', verified: true }],
    comments: [
      {
        id: 'c-1',
        authorId: member.id,
        body: 'Looks good',
        createdAt: now,
        reactions: { '👍': [member.id] },
      },
      {
        id: 'c-2',
        authorId: member.id,
        body: 'Agreed, running it now',
        createdAt: now + 1,
        reactions: {},
        parentId: 'c-1',
      },
    ],
    attachments: [
      {
        id: 'a-1',
        kind: 'dataset',
        name: 'assay.csv',
        path: 'data/assay.csv',
        bytes: 42,
        by: member.id,
        at: now,
      },
    ],
    subtasks: [{ id: 'st-1', title: 'Prepare inputs', done: true }],
  };

  const sessionA = {
    id: 's-a',
    projectId: 'p-a',
    title: 'Baseline run',
    createdAt: now - 1000,
    updatedAt: now - 500,
    phase: 'ANALYSIS' as const,
    plan: {
      goal: 'Reanalyse the assay',
      steps: [
        { id: 'p1', title: 'Load the table', status: 'done' as const },
        { id: 'p2', title: 'Fit the model', status: 'active' as const },
      ],
      updatedAt: now,
    },
  };
  const sessionB = {
    id: 's-b',
    projectId: 'p-a',
    title: 'Write-up',
    createdAt: now,
    updatedAt: now,
    phase: 'WRITING' as const,
    branch: 'main',
    pullRequest: { number: 3, state: 'open' as const },
    pinned: true,
  };

  const messagesA: Message[] = [
    {
      id: 'm-1',
      role: 'user',
      blocks: [{ kind: 'text', text: 'Run the baseline' }],
      createdAt: now,
      tokens: 12,
    },
    {
      id: 'm-2',
      role: 'assistant',
      blocks: [
        { kind: 'thinking', text: 'Weighing the options', startedAt: now, endedAt: now + 5 },
        {
          kind: 'tool',
          name: 'read_file',
          description: 'read_file data/assay.csv',
          status: 'ok',
          startedAt: now,
          endedAt: now + 1,
          output: 'id,value',
          callId: 'call-1',
          input: { path: 'data/assay.csv' },
        },
        { kind: 'diff', filesChanged: 1, added: 2, removed: 1 },
        {
          kind: 'run',
          modelRef: 'anthropic/claude',
          mode: 'agent',
          durationMs: 42,
          tokensIn: 1,
          tokensOut: 2,
        },
      ],
      createdAt: now + 10,
    },
  ];
  const messagesB: Message[] = [
    { id: 'm-3', role: 'user', blocks: [{ kind: 'text', text: 'Draft the methods' }], createdAt: now + 20 },
  ];

  const target: Target = {
    id: 'tg-1',
    name: 'Lab GPU',
    kind: 'ssh',
    host: 'gpu.lab',
    summary: 'A100 box',
    readiness: 'ready',
    cores: 32,
    memoryGb: 128,
    gpus: '2×A100',
    concurrency: 2,
    allocation: { used: 10, total: 100, unit: 'gpu-h' },
    needs: [],
    cost: 'metered',
    credentials: ['ssh-key'],
    check: { at: '2026-10-01T09:00:00Z', tone: 'success', detail: 'Connection check passed' },
    recentJobs: ['j-1'],
    config: { host: 'gpu.lab', user: 'ada', workdir: '~/runs' },
  };
  const job: Job = {
    id: 'j-1',
    name: 'Docking sweep',
    state: 'running',
    targetId: target.id,
    startedMinutesAgo: 12,
    duration: '00:12:00',
    progress: 0.4,
    cpuHours: 3,
    gpuHours: 1,
    cost: '$2.10',
    command: 'python dock.py',
    inputs: [{ ref: 'data/ligands.sdf', note: 'ligands' }],
    outputs: [],
    resources: { cores: 8, memoryGb: 32, gpus: '1', wallClock: '04:00:00' },
    logTail: ['epoch 1'],
    history: [{ at: '2026-10-10T09:00:00Z', state: 'running' }],
    taskKeys: [task.key],
    objective: 'Rank the library',
  };
  const note: Note = {
    id: 'n-1',
    title: 'Sequencing plan',
    body: 'Two lanes, 150 bp.',
    authorId: member.id,
    updatedAt: now,
  };
  const view: SavedView = {
    id: 'v-1',
    name: 'Active this wave',
    ownerId: member.id,
    layout: 'board',
    filters: { status: ['active'], priority: [3, 4] },
    starred: true,
  };
  const inbox: InboxEntry = {
    id: 'i-1',
    kind: 'assigned',
    taskId: task.id,
    actorId: member.id,
    body: 'Assigned you the docking sweep',
    createdAt: now,
    read: false,
  };
  const record: ScienceRecord = {
    id: 'pmid:1',
    source: 'pubmed',
    kind: 'article',
    title: 'CRISPR specificity in chromatin contexts',
    authors: ['Doudna J', 'Zhang F'],
    year: 2021,
    venue: 'Nature',
    doi: '10.1000/example',
    url: 'https://example.org/record',
    abstract: 'A record the agent cited.',
    extra: { citations: 5 },
  };

  return {
    sessions: [sessionB, sessionA],
    activeSessionId: 's-a',
    transcripts: { 's-a': messagesA, 's-b': messagesB },
    results: [
      {
        id: 'r-1',
        name: 'figure1.png',
        path: 'figures/figure1.png',
        sessionId: 's-a',
        createdAt: now,
        pinned: true,
      },
    ],
    tasks: [task],
    waves: [wave],
    members: [member],
    labels: [label],
    notes: [note],
    views: [view],
    inbox: [inbox],
    targets: [target],
    jobs: [job],
    records: [record],
  };
}

const providerFixture: Provider = {
  id: 'lab-gateway',
  label: 'Lab gateway',
  protocol: 'openai',
  defaultBaseUrl: 'https://gateway.lab/v1',
  requiresKey: true,
  docsUrl: 'https://gateway.lab/docs',
  summary: 'The group’s internal model gateway.',
  fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true }],
  models: [{ id: 'lab-8b', label: 'Lab 8B', contextWindow: 128_000, supportsTools: true }],
};

const databaseFixture: CatalogDatabase = {
  id: 'db-1',
  name: 'OpenAlex',
  family: 'Literature',
  mark: 'book',
  purpose: 'Scholarly metadata',
  recordCount: '250M works',
  access: 'Open',
  state: 'connected',
  authorization: 'none',
  endpoint: 'https://api.openalex.org',
  operations: [
    {
      id: 'find',
      label: 'Search works',
      method: 'GET',
      path: '/works',
      parameters: [
        { name: 'query', label: 'Search', kind: 'text', in: 'query', param: 'search' },
        { name: 'limit', label: 'Per page', kind: 'number', in: 'query', param: 'per-page', default: 25 },
      ],
    },
  ],
  defaultHeaders: [{ name: 'Accept', value: 'application/json' }],
  holds: 'Works, authors and venues',
  updateCadence: 'daily',
  licence: 'CC0',
  docsUrl: 'https://docs.openalex.org',
  sample: { kind: 'table', columns: ['id', 'title'], rows: [['W1', 'A work']] },
};

const sourceFixture: Source = {
  id: 'src-1',
  name: 'Chromatin off-target work',
  databaseId: 'db-1',
  filters: { query: 'chromatin off-target', types: ['article', 'preprint'], yearFrom: 2019, limit: 25 },
  preview: [{ id: 'W1', title: 'A work', year: 2021, venue: 'Nature' }],
  createdAt: now,
};

const reviewFixture: Review = {
  id: 'review-1',
  question: 'Does chromatin accessibility improve off-target prediction?',
  short: 'Chromatin off-target',
  state: 'screening',
  total: 42,
  protocol: [{ label: 'Inclusion criteria', value: 'Human cells' }],
  lastTouched: now,
  paperIds: ['kleinstiver-2016'],
  seed: { 'kleinstiver-2016': 'include' },
};

const paperFixture: Paper = {
  id: 'kleinstiver-2016',
  title: 'Engineered CRISPR-Cas9 nucleases',
  authors: ['Kleinstiver B'],
  venue: 'Nature',
  year: 2016,
  doi: '10.1000/paper',
  abstract: 'A specificity benchmark.',
  seed: 'include',
  extraction: {
    population: { value: 'Human cells' },
    intervention: { value: 'SpCas9 variants', quote: { text: '…', citation: '(Kleinstiver 2016)' } },
    design: { value: 'Benchmark' },
    outcomes: { value: 'Off-target counts' },
    health: { value: 'n/a' },
  },
};

const contentFixture: ReviewContent = {
  criteria: [{ id: 'human', label: 'Human cells', question: 'Studies human cells' }],
  report: {
    date: '2026-10-01',
    summary: 'Early screening only.',
    sections: [{ id: 'abstract', heading: 'Abstract', body: 'The signal is modest [[kleinstiver-2016]].' }],
  },
};

const metaFixture = {
  source: 'PubMed',
  citations: 3120,
  score: 5,
  rationale: 'A clean specificity benchmark.',
};

/** The two projects and the app settings a full save starts from. */
function stateFixture(): { state: AppState; expected: Record<string, unknown>; workA: WorkspaceData } {
  const workA = richWorkspace();
  const projectA: Project = {
    id: 'p-a',
    name: 'Lab',
    path: '/tmp/lab',
    icon: 'flask',
    createdAt: now - 5000,
    lastOpenedAt: now,
    workspace: workA,
  };
  const projectB: Project = {
    id: 'p-b',
    name: 'Side quest',
    path: '/tmp/side',
    icon: 'atom',
    createdAt: now - 4000,
    lastOpenedAt: now - 1000,
    workspace: sideWorkspace(),
  };

  const settings = {
    modelRef: 'anthropic/claude-sonnet-4-6',
    customProviders: [providerFixture],
    providerBaseUrls: { 'lab-gateway': 'https://gateway.lab/v1' },
    indexRoot: '/tmp/openlab-index',
    route: 'research/tasks',
    tabs: ['literature-reviews'],
    navMode: 'horizontal' as const,
    execution: DEFAULT_EXECUTION,
    guard: DEFAULT_GUARD,
    preferences: {},
    prompts: DEFAULT_PROMPTS,
    closedMcps: ['delphi'],
    taskLayout: 'board' as const,
    taskGroupBy: 'priority' as const,
    taskSort: 'due' as const,
    reasoning: 'high' as const,
    mode: 'plan' as const,
    theme: 'dark' as const,
    enabledPacks: ['genomics', 'ml'] as AppState['enabledPacks'],
    installedPacks: ['genomics', 'ml'] as AppState['installedPacks'],
  };

  const state: AppState = {
    ...seedState(),
    ...loadWorkspace(workA),
    projects: [projectA, projectB],
    activeProjectId: 'p-a',
    ...settings,
  };

  const expected = {
    projects: [projectA, projectB],
    activeProjectId: 'p-a',
    ...settings,
  };

  return { state, expected, workA };
}

/* ================================================================================================
 * Migrations
 * ============================================================================================== */

console.log('\n— migrations —');
const { db, sqlite } = memoryDb();
{
  const migrations = loadMigrationsFromDisk();
  check('the journal carries the generated migration', migrations.length >= 1, true);
  for (const migration of migrations) {
    check(`${migration.tag} has statements`, splitStatements(migration.sql).length > 0, true);
  }

  await applyMigrations(db, migrations);
  const names = tableNames(sqlite);
  const expectedTables = Object.values(storageSchema).map((table) => getTableName(table));
  checkDeep(
    'every schema table exists',
    expectedTables.filter((name) => !names.includes(name)),
    [],
  );
  check('the bookkeeping table exists', names.includes('__drizzle_migrations'), true);
  // The study/program layer was removed; the migration is what takes it out of an existing
  // database, so its absence is the thing to pin — a stale table would keep old rows alive.
  check(
    'the removed tables are gone',
    ['studies', 'programs'].filter((name) => names.includes(name)),
    [],
  );
  const taskColumns = (
    sqlite.query("select name from pragma_table_info('tasks')").values() as [string][]
  ).map(([name]) => name);
  check(
    'and their columns with them',
    taskColumns.filter((name) => name === 'studyId' || name === 'milestoneId'),
    [],
  );

  await applyMigrations(db, migrations);
  check(
    'applying twice records each migration once',
    countRows(sqlite, '__drizzle_migrations'),
    migrations.length,
  );
}

console.log('\n— a schema this build cannot trust —');
{
  const { db: other, sqlite: otherSqlite } = memoryDb();
  const migrations = loadMigrationsFromDisk();
  await applyMigrations(other, migrations);
  // `SERIAL` is not autoincrement in SQLite, so the bookkeeping rows carry a null id; key the
  // tamper on the ordering column the applier actually reads.
  otherSqlite.run(
    "update __drizzle_migrations set hash = 'tampered' where created_at = (select min(created_at) from __drizzle_migrations)",
  );
  let failure = '';
  try {
    await applyMigrations(other, migrations);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  checkTruthy('a changed migration is refused', failure.includes('does not match'));
  check('and nothing else is applied', countRows(otherSqlite, '__drizzle_migrations'), migrations.length);

  const { db: newer, sqlite: newerSqlite } = memoryDb();
  await applyMigrations(newer, migrations);
  newerSqlite.run("insert into __drizzle_migrations (hash, created_at) values ('x', 9999999999999)");
  let newerFailure = '';
  try {
    await applyMigrations(newer, migrations);
  } catch (error) {
    newerFailure = error instanceof Error ? error.message : String(error);
  }
  checkTruthy('a database from a newer build is refused', newerFailure.includes('newer'));
}

/* ================================================================================================
 * The app state
 * ============================================================================================== */

console.log('\n— the app state —');
const { state, expected, workA } = stateFixture();
{
  await saveState(db, state);
  checkDeep('a full save round-trips', await loadState(db), expected);

  const one = await db
    .select()
    .from(storageSchema.projects)
    .where(eq(storageSchema.projects.id, 'p-a'))
    .get();
  check('the proxy `get` verb returns the row', one?.id, 'p-a');
  const missing = await db
    .select()
    .from(storageSchema.projects)
    .where(eq(storageSchema.projects.id, 'nope'))
    .get();
  check('and `undefined` when there is none', missing, undefined);
}

// A save only touches what changed: rename a task, drop a member, append a message, and
// reverse the task order. References stay stable for everything else.
const extraMessage: Message = {
  id: 'm-4',
  role: 'assistant',
  blocks: [{ kind: 'text', text: 'The baseline is in.' }],
  createdAt: now + 30,
};
const expectedWorkA: WorkspaceData = {
  ...workA,
  tasks: [{ ...workA.tasks[0], title: 'Dock the panel (v2)' }],
  members: [],
  transcripts: { 's-a': [...workA.transcripts['s-a'], extraMessage], 's-b': workA.transcripts['s-b'] },
};
const mutated: AppState = {
  ...state,
  tasks: expectedWorkA.tasks,
  members: expectedWorkA.members,
  transcripts: expectedWorkA.transcripts,
  messages: expectedWorkA.transcripts['s-a'],
};
{
  await saveState(db, mutated);
  const expectedAfter = {
    ...expected,
    projects: [{ ...expected.projects[0], workspace: expectedWorkA }, expected.projects[1]],
  };
  checkDeep('a diffed save updates, deletes and appends', await loadState(db), expectedAfter);
  check('the removed member is gone from the file', countRows(sqlite, 'members'), 0);
}

// Removing a project takes its sessions, messages and everything else with it.
const withoutSideProject: AppState = {
  ...mutated,
  projects: mutated.projects.filter((project) => project.id === 'p-a'),
};
{
  await saveState(db, withoutSideProject);
  check('the removed project is gone', countRows(sqlite, 'projects'), 1);
  check('its sessions cascaded', countRows(sqlite, 'sessions'), 2);
  check('its messages cascaded', countRows(sqlite, 'messages'), 4);
  const sideMessage = sqlite.query("select count(*) as n from messages where id = 'm-pb'").get() as {
    n: number;
  };
  check('and the side project has no rows left', sideMessage.n, 0);
  checkDeep(
    'a load sees one project',
    (await loadState(db)).projects?.map((project) => project.id),
    ['p-a'],
  );

  // No open workspace is a value, not a missing row.
  await saveState(db, { ...withoutSideProject, activeProjectId: null });
  checkDeep(
    'a null setting round-trips',
    (await loadState(db)).activeProjectId,
    null,
  );
}

/* ================================================================================================
 * The catalogue stores
 * ============================================================================================== */

console.log('\n— the catalogue —');
{
  await saveDatabases(db, [databaseFixture]);
  checkDeep('databases round-trip', await loadDatabases(db), [databaseFixture]);
  await saveSources(db, [sourceFixture]);
  checkDeep('sources round-trip', await loadSources(db), [sourceFixture]);

  const literature = {
    reviews: [reviewFixture],
    papers: [paperFixture],
    content: { 'review-1': contentFixture },
    meta: { 'kleinstiver-2016': metaFixture },
  };
  await saveLiterature(db, literature);
  checkDeep('reviews, papers, criteria and meta round-trip', await loadLiterature(db), literature);

  const patched = {
    ...literature,
    reviews: [{ ...reviewFixture, state: 'extracting' as const, lastTouched: now + 1 }],
    content: {
      'review-1': {
        ...contentFixture,
        criteria: [
          ...contentFixture.criteria,
          { id: 'design', label: 'Design', question: 'Reports a design' },
        ],
      },
    },
  };
  await saveLiterature(db, patched);
  checkDeep('a patched review round-trips', await loadLiterature(db), patched);
}

/* ================================================================================================
 * Boot: hydration and the interrupted-block cleanup
 * ============================================================================================== */

console.log('\n— boot —');
{
  // Put an interrupted turn back into the file: an open reasoning trace and a running tool.
  const interrupted: Message = {
    id: 'm-9',
    role: 'assistant',
    blocks: [
      { kind: 'thinking', text: 'Mid-thought', startedAt: now, endedAt: null },
      {
        kind: 'tool',
        name: 'write_file',
        description: 'write_file results.txt',
        status: 'running',
        startedAt: now,
        endedAt: null,
        callId: 'call-9',
      },
    ],
    createdAt: now + 40,
  };
  const withInterrupted: AppState = {
    ...withoutSideProject,
    transcripts: {
      ...withoutSideProject.transcripts,
      's-a': [...withoutSideProject.transcripts['s-a'], interrupted],
    },
    messages: [...withoutSideProject.messages, interrupted],
  };
  await saveState(db, withInterrupted);

  setDb(db);
  await initPersistence();
  const restored = loadPersisted();
  const restoredMessage = restored?.projects?.[0]?.workspace.transcripts['s-a'].find(
    (message) => message.id === 'm-9',
  );
  const [thinking, tool] = restoredMessage?.blocks ?? [];
  check(
    'a restored thinking block is closed',
    thinking?.kind === 'thinking' && thinking.endedAt !== null,
    true,
  );
  check(
    'a restored running tool is marked interrupted',
    tool?.kind === 'tool' && tool.status === 'error' && tool.output === 'Interrupted when openlab closed.',
    true,
  );
}

/* ================================================================================================
 * Clearing
 * ============================================================================================== */

console.log('\n— clearing —');
{
  await clearState(db);
  const cleared = await loadState(db);
  check('clearing empties the projects', cleared.projects, []);
  check('and the settings', cleared.modelRef, undefined);
  checkDeep('and the catalogue', await loadDatabases(db), []);
  checkDeep('and the reviews', (await loadLiterature(db)).reviews, []);

  // The write memories were reset too, so the next save repopulates everything.
  await saveState(db, withoutSideProject);
  checkDeep('a save after a clear rewrites the state', await loadState(db), {
    ...expected,
    projects: [{ ...expected.projects[0], workspace: expectedWorkA }],
  });
}

/* ================================================================================================
 * The one-time import from webview storage
 * ============================================================================================== */

console.log('\n— the legacy import —');
{
  const fresh = memoryDb();
  await applyMigrations(fresh.db, loadMigrationsFromDisk());

  const legacyProject: Project = {
    id: 'p-legacy',
    name: 'Old lab',
    path: '/tmp/old',
    icon: 'flask',
    createdAt: now - 9000,
    lastOpenedAt: now - 9000,
    workspace: emptyWorkspace(),
  };
  const legacy = {
    version: 2,
    projects: [legacyProject],
    activeProjectId: 'p-legacy',
    modelRef: 'anthropic/claude-sonnet-4-6',
    theme: 'light',
    enabledPacks: [],
    installedPacks: [],
  };

  const store = new Map<string, string>([['openlab.state.v2', JSON.stringify(legacy)]]);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });

  try {
    resetStateSyncers();
    setDb(fresh.db);
    await initPersistence();

    const restored = loadPersisted();
    checkDeep('the old theme is restored, not the system default', restored?.theme, 'light');
    checkDeep(
      'and the old workspace',
      restored?.projects?.map((project) => project.id),
      ['p-legacy'],
    );
    checkDeep('the import lands in SQLite', (await loadState(fresh.db)).projects?.length, 1);
    check('the old key is consumed', store.has('openlab.state.v2'), false);
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'localStorage', original);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  }
}

/* ================================================================================================
 * The built-in catalogue
 * ============================================================================================== */

console.log('\n— the built-in catalogue —');
{
  check('six or more databases ship with the app', DATABASES.length >= 6, true);
  check('their ids are unique', DATABASES.length - new Set(DATABASES.map((one) => one.id)).size, 0);
  check(
    'every one is keyless, so the request panel works out of the box',
    DATABASES.every((one) => one.authorization === 'none' && one.state === 'connected'),
    true,
  );
  check(
    'every one declares a find operation',
    DATABASES.every((one) => one.operations.some((operation) => operation.id === 'find')),
    true,
  );
  check(
    'and every operation has a path and parameters',
    DATABASES.every((one) =>
      one.operations.every((operation) => operation.path.length > 0 && operation.parameters.length > 0),
    ),
    true,
  );
  check(
    'a list-returning find can be paged',
    ['openalex', 'pubmed', 'chembl', 'pdb'].filter((id) => {
      const database = DATABASES.find((one) => one.id === id);
      return !findOperation(database ?? DATABASES[0])?.parameters.some(
        (parameter) => parameter.name === 'page' || parameter.name === 'start' || parameter.name === 'offset',
      );
    }),
    [],
  );
  check(
    'every endpoint is https',
    DATABASES.every((one) => one.endpoint.startsWith('https://')),
    true,
  );
  check(
    'every sample has a shape to draw',
    DATABASES.every((one) => one.sample.kind === 'text' || one.sample.columns.length > 0),
    true,
  );

  const seeded = memoryDb();
  await applyMigrations(seeded.db, loadMigrationsFromDisk());
  resetCatalogSyncers();
  setDb(seeded.db);
  await hydrateDatabases();
  await serialized(async () => {});
  checkDeep('an empty database is seeded with the catalogue', await loadDatabases(seeded.db), DATABASES);

  // A row seeded before the operations table existed carries an empty list; hydration must
  // restore the shipped operation so the review can still search it.
  await saveDatabases(
    seeded.db,
    DATABASES.map((one) => (one.id === 'openalex' ? { ...one, operations: [] } : one)),
  );
  resetCatalogSyncers();
  await hydrateDatabases();
  check(
    'a row stored before operations existed is repaired on load',
    findDatabase('openalex')?.operations.some((operation) => operation.id === 'find'),
    true,
  );

  // One set of filters, any database: the operation says where each value goes and what the
  // API calls it, so `query`, `limit` and `page` are the same names everywhere.
  const openalex = DATABASES.find((one) => one.id === 'openalex');
  const filters = { query: 'cancer', types: ['article'], yearFrom: 2019, limit: 25 };
  check(
    'an operation builds the search URL from the filters',
    openalex ? sourceUrl(openalex, filters, 2) : null,
    'https://api.openalex.org/works?select=id%2Ctitle%2Cpublication_year%2Cdoi%2Cprimary_location%2Cauthorships%2Cabstract_inverted_index%2Ccited_by_count%2Copen_access%2Cbest_oa_location&search=cancer&per-page=25&page=2&filter=type%3Aarticle%2Cfrom_publication_date%3A2019-01-01',
  );
  check(
    'and the same filters against PubMed use its own parameters',
    (() => {
      const pubmed = DATABASES.find((one) => one.id === 'pubmed');
      return pubmed ? sourceUrl(pubmed, { query: 'crispr', types: [], limit: 10 }, 3) : null;
    })(),
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=crispr&retmax=10&retstart=20',
  );
  check(
    'a page number becomes an offset where the API wants one',
    (() => {
      const chembl = DATABASES.find((one) => one.id === 'chembl');
      return chembl ? sourceUrl(chembl, { query: 'aspirin', types: [], limit: 20 }, 3) : null;
    })(),
    'https://www.ebi.ac.uk/chembl/api/data/molecule/search?format=json&q=aspirin&limit=20&offset=40',
  );
  check(
    'no built-in URL ends up with two question marks',
    DATABASES.filter((one) => sourceUrl(one, filters).split('?').length > 2).map((one) => one.id),
    [],
  );
  check(
    'the args a source produces are the semantic names',
    Object.keys(findArgs(filters)).sort(),
    ['limit', 'page', 'query', 'types', 'yearFrom', 'yearTo'].sort(),
  );
}

console.log('\n— agents and topics —');
{
  const storeDb = memoryDb();
  await applyMigrations(storeDb.db, loadMigrationsFromDisk());
  resetAgentSyncer();
  resetTopicSyncer();

  const agents: Agent[] = [
    {
      id: 'main',
      name: 'Main',
      summary: '',
      team: '',
      instructions: '',
      modelRef: '',
      packs: [],
      readOnly: false,
      builtIn: true,
    },
    {
      id: 'a1',
      name: 'Scout',
      summary: 'Finds records.',
      team: 'Lit',
      instructions: 'Cite ids.',
      modelRef: 'anthropic/claude',
      packs: [],
      readOnly: true,
      builtIn: false,
    },
  ];
  await saveAgents(storeDb.db, agents, 'a1');
  checkDeep('agents round-trip with the active choice', await loadAgents(storeDb.db), {
    agents,
    activeId: 'a1',
  });
  await saveAgents(storeDb.db, agents, 'main');
  checkDeep('choosing another agent is written', (await loadAgents(storeDb.db)).activeId, 'main');

  const topics: ResearchTopic[] = [
    {
      id: 't1',
      question: 'Does chromatin help?',
      databaseIds: ['openalex'],
      agentIds: ['a1'],
      status: 'done',
      findings: 'Yes [[W1]].',
      recordCount: 3,
      updatedAt: 1,
    },
  ];
  await saveTopics(storeDb.db, topics);
  checkDeep('topics round-trip', await loadTopics(storeDb.db), topics);
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: storage migrates, saves, loads and clears through drizzle on SQLite');
