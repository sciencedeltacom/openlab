/**
 * The storage schema.
 *
 * One SQLite file holds everything the workbench *remembers*: projects and their workspaces
 * (sessions, transcripts, results, tracker, compute ledger, cited records), the app-level
 * settings and providers, and the catalogue surfaces (databases, sources, literature
 * reviews). Files are deliberately not here — a file on disk stays on disk and is referenced
 * by path.
 *
 * Columns are named exactly like the domain fields they carry (camelCase, no `snake_case`
 * translation layer): this is an application-private database whose only readers are the
 * mappers in this directory, and one name per concept beats two that must be kept in sync.
 * Nested structures (blocks, filters, extraction) are JSON columns; everything a query might
 * filter on is a real column.
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { Block, Message, NavMode, Session } from '../../store/types';
import type { InboxEntry, Label, SavedView, Task, TaskFilter } from '../../store/research';
import type { Job, Target } from '../../store/compute';
import type { ScienceRecord } from '../science/connectors';
import type { Provider } from '../providers';
import type { PackId } from '../agent/packs';
import type { Phase } from '../../theme/tokens';
import type {
  Database as CatalogDatabase,
  DatabaseAuthorization,
  DatabaseState,
} from '../../components/databases/data';
import type { Paper, PaperMeta, Review, ReviewContent } from '../../components/literature/data';
import type { CloudConnection, SyncPair } from '../cloud/types';
import type { Experiment, ExperimentDomain } from '../../components/experiments/experiments';
import type { Agent } from '../../components/agents/data';
import type { ResearchTopic } from '../../components/autoresearch/data';
import type { SourceFilters, SourceRecord } from '../catalog/sources';

/* ================================================================================================
 * The app shell
 * ============================================================================================== */

/** A folder on disk and everything its workspace owns hangs off this row. */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  icon: text('icon').notNull(),
  createdAt: integer('createdAt').notNull(),
  lastOpenedAt: integer('lastOpenedAt').notNull(),
  /** The session the workspace opens on. Null until one exists. */
  activeSessionId: text('activeSessionId'),
});

/**
 * App-level settings, one row per key.
 *
 * These are the scalars that do not deserve a table of their own: the chosen model,
 * provider base URLs, the theme, opened packs. The value is JSON, so adding a setting is a
 * one-line change here and nothing to migrate. The column is nullable because a setting can
 * legitimately hold `null`.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }),
});

/** The typed shape of each settings key, so the writer and the reader cannot disagree. */
export interface SettingValues {
  activeProjectId: string | null;
  modelRef: string;
  providerBaseUrls: Record<string, string>;
  route: string;
  tabs: string[];
  taskLayout: 'list' | 'board' | 'timeline';
  taskGroupBy: 'none' | 'status' | 'assignee' | 'priority' | 'study' | 'kind';
  taskSort: 'priority' | 'updated' | 'due' | 'key';
  reasoning: 'off' | 'low' | 'medium' | 'high';
  mode: 'agent' | 'plan' | 'ask';
  theme: 'light' | 'dark';
  navMode: NavMode;
  /** Where a command runs; the pages in Settings write it. */
  execution: import('../execution').ExecutionSettings;
  guard: import('../guard').GuardSettings;
  preferences: import('../settings').Preferences;
  prompts: import('../settings').PromptOverrides;
  enabledPacks: PackId[];
  installedPacks: PackId[];
  closedMcps: import('../agent/mcp').McpServerId[];
  /** Where the PDF scan index lives; empty means the active project's `.openlab`. */
  indexRoot: string;
}

/** Providers the user added. A custom row overrides a built-in of the same id. */
export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  label: text('label').notNull(),
  protocol: text('protocol').$type<Provider['protocol']>().notNull(),
  defaultBaseUrl: text('defaultBaseUrl'),
  requiresKey: integer('requiresKey', { mode: 'boolean' }).notNull(),
  docsUrl: text('docsUrl'),
  summary: text('summary').notNull(),
  fields: text('fields', { mode: 'json' }).$type<Provider['fields']>().notNull(),
  models: text('models', { mode: 'json' }).$type<Provider['models']>().notNull(),
});

/**
 * The agents a workbench can run as.
 *
 * `active` marks the one the next turn runs as — exactly one row carries it, so choosing an
 * agent is a write, not a second table.
 */
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  summary: text('summary').notNull(),
  team: text('team').notNull(),
  instructions: text('instructions').notNull(),
  modelRef: text('modelRef').notNull(),
  packs: text('packs', { mode: 'json' }).$type<Agent['packs']>().notNull(),
  readOnly: integer('readOnly', { mode: 'boolean' }).notNull(),
  builtIn: integer('builtIn', { mode: 'boolean' }).notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
  avatarColor: text('avatarColor'),
});

/** A research topic the workbench runs against databases and agents. */
export const researchTopics = sqliteTable('researchTopics', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  question: text('question').notNull(),
  databaseIds: text('databaseIds', { mode: 'json' }).$type<string[]>().notNull(),
  agentIds: text('agentIds', { mode: 'json' }).$type<string[]>().notNull(),
  status: text('status').$type<ResearchTopic['status']>().notNull(),
  findings: text('findings').notNull(),
  recordCount: integer('recordCount').notNull(),
  updatedAt: integer('updatedAt').notNull(),
});

/* ================================================================================================
 * A workspace: sessions, transcripts, results
 * ============================================================================================== */

/** A line of enquiry inside a project. */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  createdAt: integer('createdAt').notNull(),
  updatedAt: integer('updatedAt').notNull(),
  phase: text('phase').$type<Phase>().notNull(),
  agentId: text('agentId'),
  experimentId: text('experimentId'),
  branch: text('branch'),
  pullRequest: text('pullRequest', { mode: 'json' }).$type<{
    number: number;
    state: 'open' | 'merged' | 'closed';
  }>(),
  pinned: integer('pinned', { mode: 'boolean' }),
  plan: text('plan', { mode: 'json' }).$type<Session['plan']>(),
  /** Set on a worker's own session: the lead session that delegated it. */
  parentId: text('parentId'),
  worker: text('worker', { mode: 'json' }).$type<Session['worker']>(),
  /** When a delegated turn ended. Absent while it still runs. */
  finishedAt: integer('finishedAt'),
  /** What the session's turns spent, when the engine reported it. */
  usage: text('usage', { mode: 'json' }).$type<Session['usage']>(),
});

/**
 * One message of one session's transcript.
 *
 * Order is an explicit `position` column rather than the timestamp: two messages can share a
 * millisecond, and a transcript must read back exactly as it was written.
 */
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    projectId: text('projectId')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: text('sessionId')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    blocks: text('blocks', { mode: 'json' }).$type<Block[]>().notNull(),
    /** Who wrote an assistant turn, as it was called at the time. */
    agent: text('agent', { mode: 'json' }).$type<Message['agent']>(),
    createdAt: integer('createdAt').notNull(),
    tokens: integer('tokens'),
  },
  (table) => [index('messages_session').on(table.sessionId, table.position)],
);

/** A file the agent produced, kept as a pointer rather than a copy. */
export const results = sqliteTable('results', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  path: text('path').notNull(),
  sessionId: text('sessionId'),
  createdAt: integer('createdAt').notNull(),
  pinned: integer('pinned', { mode: 'boolean' }).notNull(),
});

/* ================================================================================================
 * The research tracker
 * ============================================================================================== */

/** A unit of work. Lists, relations and evidence are JSON: they are read whole or not at all. */
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  key: text('key').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  kind: text('kind').$type<Task['kind']>().notNull(),
  status: text('status').$type<Task['status']>().notNull(),
  priority: integer('priority').notNull(),
  waveId: text('waveId'),
  parentId: text('parentId'),
  assigneeId: text('assigneeId'),
  labels: text('labels', { mode: 'json' }).$type<Task['labels']>().notNull(),
  estimate: integer('estimate'),
  dueDate: text('dueDate'),
  createdAt: integer('createdAt').notNull(),
  updatedAt: integer('updatedAt').notNull(),
  relations: text('relations', { mode: 'json' }).$type<Task['relations']>().notNull(),
  evidence: text('evidence', { mode: 'json' }).$type<Task['evidence']>().notNull(),
  comments: text('comments', { mode: 'json' }).$type<Task['comments']>().notNull(),
  // Nullable at the SQL level so the migration is a plain ADD; the reader defaults it to [].
  attachments: text('attachments', { mode: 'json' }).$type<Task['attachments']>(),
  subtasks: text('subtasks', { mode: 'json' }).$type<Task['subtasks']>().notNull(),
});

/** A bounded stretch of experiment time. */
export const waves = sqliteTable('waves', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  number: integer('number').notNull(),
  name: text('name').notNull(),
  startDate: text('startDate').notNull(),
  endDate: text('endDate').notNull(),
  goal: text('goal').notNull(),
});

/** A person in the lab. */
export const members = sqliteTable('members', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  initials: text('initials').notNull(),
  role: text('role').notNull(),
  email: text('email').notNull(),
  color: text('color').notNull(),
});

/** A method or topic tag. */
export const labels = sqliteTable('labels', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  group: text('group').$type<Label['group']>().notNull(),
});

/** A note attached to a study, a program, or nothing at all. */
export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  authorId: text('authorId').notNull(),
  updatedAt: integer('updatedAt').notNull(),
});

/** A saved tracker view: filters plus a layout. */
export const views = sqliteTable('views', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  ownerId: text('ownerId'),
  layout: text('layout').$type<SavedView['layout']>().notNull(),
  filters: text('filters', { mode: 'json' }).$type<TaskFilter>().notNull(),
  starred: integer('starred', { mode: 'boolean' }).notNull(),
});

/** An entry in the inbox. */
export const inboxEntries = sqliteTable('inboxEntries', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  kind: text('kind').$type<InboxEntry['kind']>().notNull(),
  taskId: text('taskId'),
  actorId: text('actorId').notNull(),
  body: text('body').notNull(),
  createdAt: integer('createdAt').notNull(),
  read: integer('read', { mode: 'boolean' }).notNull(),
});

/* ================================================================================================
 * The compute domain
 * ============================================================================================== */

/** One machine a job can run on. */
export const targets = sqliteTable('targets', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<Target['kind']>().notNull(),
  host: text('host').notNull(),
  summary: text('summary').notNull(),
  readiness: text('readiness').$type<Target['readiness']>().notNull(),
  cores: integer('cores').notNull(),
  memoryGb: integer('memoryGb').notNull(),
  gpus: text('gpus'),
  concurrency: integer('concurrency').notNull(),
  allocation: text('allocation', { mode: 'json' }).$type<Target['allocation']>(),
  needs: text('needs', { mode: 'json' }).$type<Target['needs']>().notNull(),
  cost: text('cost').notNull(),
  credentials: text('credentials', { mode: 'json' }).$type<Target['credentials']>().notNull(),
  check: text('check', { mode: 'json' }).$type<Target['check']>().notNull(),
  recentJobs: text('recentJobs', { mode: 'json' }).$type<Target['recentJobs']>().notNull(),
  /** How the adapter reaches it. Nullable so targets added before it existed still load. */
  config: text('config', { mode: 'json' }).$type<Target['config']>(),
});

/** One run in the ledger. */
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  state: text('state').$type<Job['state']>().notNull(),
  targetId: text('targetId').notNull(),
  startedMinutesAgo: integer('startedMinutesAgo'),
  duration: text('duration').notNull(),
  progress: integer('progress'),
  cpuHours: integer('cpuHours'),
  gpuHours: integer('gpuHours'),
  cost: text('cost').notNull(),
  error: text('error'),
  command: text('command').notNull(),
  inputs: text('inputs', { mode: 'json' }).$type<Job['inputs']>().notNull(),
  outputs: text('outputs', { mode: 'json' }).$type<Job['outputs']>().notNull(),
  resources: text('resources', { mode: 'json' }).$type<Job['resources']>().notNull(),
  logTail: text('logTail', { mode: 'json' }).$type<Job['logTail']>().notNull(),
  history: text('history', { mode: 'json' }).$type<Job['history']>().notNull(),
  taskKeys: text('taskKeys', { mode: 'json' }).$type<Job['taskKeys']>().notNull(),
  objective: text('objective').notNull(),
});

/* ================================================================================================
 * Records the agent cited
 * ============================================================================================== */

/** A literature or molecular record the agent cited, kept so `record:<id>` reopens it. */
export const records = sqliteTable('records', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  source: text('source').notNull(),
  kind: text('kind').$type<ScienceRecord['kind']>().notNull(),
  title: text('title').notNull(),
  authors: text('authors', { mode: 'json' }).$type<ScienceRecord['authors']>().notNull(),
  year: integer('year'),
  venue: text('venue'),
  doi: text('doi'),
  url: text('url'),
  abstract: text('abstract'),
  extra: text('extra', { mode: 'json' }).$type<ScienceRecord['extra']>(),
});

/* ================================================================================================
 * The catalogue surfaces
 * ============================================================================================== */

/** A public database the workbench can query. */
export const databases = sqliteTable('databases', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  family: text('family').notNull(),
  mark: text('mark').notNull(),
  purpose: text('purpose').notNull(),
  recordCount: text('recordCount').notNull(),
  access: text('access').notNull(),
  state: text('state').$type<DatabaseState>().notNull(),
  authorization: text('authorization').$type<DatabaseAuthorization>().notNull(),
  endpoint: text('endpoint').notNull(),
  operations: text('operations', { mode: 'json' }).$type<CatalogDatabase['operations']>().notNull(),
  defaultHeaders: text('defaultHeaders', { mode: 'json' })
    .$type<CatalogDatabase['defaultHeaders']>()
    .notNull(),
  holds: text('holds').notNull(),
  updateCadence: text('updateCadence').notNull(),
  licence: text('licence').notNull(),
  docsUrl: text('docsUrl').notNull(),
  sample: text('sample', { mode: 'json' }).$type<CatalogDatabase['sample']>().notNull(),
});

/** A saved question against a database. */
export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  databaseId: text('databaseId').notNull(),
  filters: text('filters', { mode: 'json' }).$type<SourceFilters>().notNull(),
  preview: text('preview', { mode: 'json' }).$type<SourceRecord[]>().notNull(),
  createdAt: integer('createdAt').notNull(),
});

/** A connected cloud store the Files page can browse by reference. */
export const cloudConnections = sqliteTable('cloudConnections', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  providerId: text('providerId').notNull(),
  label: text('label').notNull(),
  config: text('config', { mode: 'json' }).$type<CloudConnection['config']>().notNull(),
  createdAt: integer('createdAt').notNull(),
});

/** A workspace path paired with one in a store, so the two can be kept level. */
export const syncPairs = sqliteTable('syncPairs', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  connectionId: text('connectionId').notNull(),
  label: text('label').notNull(),
  /** `folder` or `file`; absent on the pairs written before a file could be paired. */
  kind: text('kind').$type<SyncPair['kind']>(),
  remotePath: text('remotePath').notNull(),
  remoteName: text('remoteName').notNull(),
  localPath: text('localPath').notNull(),
  createdAt: integer('createdAt').notNull(),
});

/** One systematic review. */
export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  question: text('question').notNull(),
  short: text('short').notNull(),
  state: text('state').$type<Review['state']>().notNull(),
  total: integer('total').notNull(),
  protocol: text('protocol', { mode: 'json' }).$type<Review['protocol']>().notNull(),
  lastTouched: integer('lastTouched').notNull(),
  paperIds: text('paperIds', { mode: 'json' }).$type<Review['paperIds']>().notNull(),
  seed: text('seed', { mode: 'json' }).$type<Review['seed']>().notNull(),
});

/** One record under screening. */
export const papers = sqliteTable('papers', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  authors: text('authors', { mode: 'json' }).$type<Paper['authors']>().notNull(),
  venue: text('venue').notNull(),
  year: integer('year').notNull(),
  doi: text('doi'),
  abstract: text('abstract').notNull(),
  seed: text('seed').$type<Paper['seed']>(),
  extraction: text('extraction', { mode: 'json' }).$type<Paper['extraction']>().notNull(),
});

/** A review's criteria and report. */
export const reviewContent = sqliteTable('reviewContent', {
  reviewId: text('reviewId').primaryKey(),
  content: text('content', { mode: 'json' }).$type<ReviewContent>().notNull(),
});

/** What the search layer knows about a record. */
export const paperMeta = sqliteTable('paperMeta', {
  paperId: text('paperId').primaryKey(),
  meta: text('meta', { mode: 'json' }).$type<PaperMeta>().notNull(),
});

/** A domain a user defined: its own design, trial and metric fields. */
export const experimentDomains = sqliteTable('experimentDomains', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  summary: text('summary').notNull(),
  mark: text('mark').notNull(),
  fields: text('fields', { mode: 'json' }).$type<ExperimentDomain['fields']>().notNull(),
  builtIn: integer('builtIn', { mode: 'boolean' }).notNull(),
});

/** One experiment: a pre-registered question, its trials, its evidence and its lesson. */
export const experiments = sqliteTable('experiments', {
  id: text('id').primaryKey(),
  position: integer('position').notNull(),
  domainId: text('domainId'),
  objective: text('objective').notNull(),
  hypothesis: text('hypothesis').notNull(),
  design: text('design').notNull(),
  designKind: text('designKind').notNull(),
  stage: text('stage').$type<Experiment['stage']>().notNull(),
  criterion: text('criterion', { mode: 'json' }).$type<Experiment['criterion']>(),
  preregistration: text('preregistration', { mode: 'json' }).$type<Experiment['preregistration']>(),
  checks: text('checks', { mode: 'json' }).$type<Experiment['checks']>().notNull(),
  designSpec: text('designSpec', { mode: 'json' }).$type<Experiment['designSpec']>().notNull(),
  outcome: text('outcome').$type<Experiment['outcome']>().notNull(),
  outcomeSummary: text('outcomeSummary').notNull(),
  lesson: text('lesson').notNull(),
  trials: text('trials', { mode: 'json' }).$type<Experiment['trials']>().notNull(),
  evidence: text('evidence', { mode: 'json' }).$type<Experiment['evidence']>().notNull(),
  links: text('links', { mode: 'json' }).$type<Experiment['links']>().notNull(),
  createdAt: integer('createdAt').notNull(),
  updatedAt: integer('updatedAt').notNull(),
});

/** Every table, for the migration runner's bookkeeping and the tests. */
export const schema = {
  projects,
  settings,
  providers,
  agents,
  researchTopics,
  sessions,
  messages,
  results,
  tasks,
  waves,
  members,
  labels,
  notes,
  views,
  inboxEntries,
  targets,
  jobs,
  records,
  databases,
  sources,
  cloudConnections,
  syncPairs,
  experimentDomains,
  experiments,
  reviews,
  papers,
  reviewContent,
  paperMeta,
};
