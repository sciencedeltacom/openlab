/**
 * The app state, in and out of SQLite.
 *
 * {@link loadState} reads every table back into the shape the store already understands: a
 * list of projects, each carrying its workspace, plus the app-level settings. {@link saveState}
 * folds the active workspace onto its project — exactly what the reducer's snapshot step does —
 * and then diffs each collection against what it wrote last time (see `sync.ts`), so a save
 * touches only the entities that actually changed.
 *
 * Rows are read whole and assembled per project; the tables are small enough that counting
 * queries would be the expensive part, not the reading.
 */

import type { AppState, Message, Project, Session, WorkspaceData } from '../../store/types';
import { snapshotWorkspace } from '../../store/workspace';
import type { InboxEntry, Label, Member, Note, SavedView, Task, Wave } from '../../store/research';
import type { Job, Target } from '../../store/compute';
import type { Provider } from '../providers';

import { serialized, withTransaction, type Db } from './client';
import { resetAgentSyncer } from './agents';
import { resetCatalogSyncers } from './catalog';
import { resetExperimentSyncers } from './experiments';
import { resetLiteratureSyncers } from './literature';
import { resetTopicSyncer } from './research';
import * as t from './schema';
import { deleteRows, MapSyncer, TableSyncer, upsertRows } from './sync';

/** The app-level slice that persists between launches. */
export type Persisted = Pick<
  AppState,
  | 'projects'
  | 'activeProjectId'
  | 'modelRef'
  | 'customProviders'
  | 'providerBaseUrls'
  | 'indexRoot'
  | 'route'
  | 'tabs'
  | 'taskLayout'
  | 'taskGroupBy'
  | 'taskSort'
  | 'reasoning'
  | 'mode'
  | 'theme'
  | 'navMode'
  | 'execution'
  | 'guard'
  | 'preferences'
  | 'prompts'
  | 'enabledPacks'
  | 'installedPacks'
  | 'closedMcps'
>;

/** Every settings key, so a loader and a writer cannot disagree about the set. */
const SETTING_KEYS = [
  'activeProjectId',
  'modelRef',
  'providerBaseUrls',
  'route',
  'tabs',
  'taskLayout',
  'taskGroupBy',
  'taskSort',
  'reasoning',
  'mode',
  'theme',
  'navMode',
  'execution',
  'guard',
  'preferences',
  'prompts',
  'enabledPacks',
  'installedPacks',
  'closedMcps',
  'indexRoot',
] as const satisfies readonly (keyof t.SettingValues)[];

/* ================================================================================================
 * Reading
 * ============================================================================================== */

type SessionRow = typeof t.sessions.$inferSelect;
type MessageRow = typeof t.messages.$inferSelect;
type ResultRow = typeof t.results.$inferSelect;
type TaskRow = typeof t.tasks.$inferSelect;
type WaveRow = typeof t.waves.$inferSelect;
type MemberRow = typeof t.members.$inferSelect;
type LabelRow = typeof t.labels.$inferSelect;
type NoteRow = typeof t.notes.$inferSelect;
type ViewRow = typeof t.views.$inferSelect;
type InboxRow = typeof t.inboxEntries.$inferSelect;
type TargetRow = typeof t.targets.$inferSelect;
type JobRow = typeof t.jobs.$inferSelect;
type RecordRow = typeof t.records.$inferSelect;

/** Group rows by the project they belong to. */
function byProject<Row extends { projectId: string }>(rows: Row[]): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const list = grouped.get(row.projectId);
    if (list) {
      list.push(row);
    } else {
      grouped.set(row.projectId, [row]);
    }
  }
  return grouped;
}

/** Strip the workspace bookkeeping back to the domain type. */
function toSession(row: SessionRow) {
  const {
    position: _position,
    agentId,
    experimentId,
    branch,
    pullRequest,
    pinned,
    plan,
    parentId,
    worker,
    finishedAt,
    usage,
    ...session
  } = row;
  return {
    ...session,
    agentId: agentId ?? undefined,
    experimentId: experimentId ?? undefined,
    branch: branch ?? undefined,
    pullRequest: pullRequest ?? undefined,
    pinned: pinned ?? undefined,
    plan: plan ?? undefined,
    parentId: parentId ?? undefined,
    worker: worker ?? undefined,
    finishedAt: finishedAt ?? undefined,
    usage: usage ?? undefined,
  };
}

function toMessage(row: MessageRow): Message {
  const {
    projectId: _projectId,
    sessionId: _sessionId,
    position: _position,
    tokens,
    agent,
    ...message
  } = row;
  return { ...message, agent: agent ?? undefined, tokens: tokens ?? undefined };
}

/** The transcripts of one project, in stored order. */
function transcriptsOf(rows: MessageRow[]): Record<string, Message[]> {
  const transcripts: Record<string, Message[]> = {};
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    const messages = transcripts[row.sessionId] ?? (transcripts[row.sessionId] = []);
    messages.push(toMessage(row));
  }
  return transcripts;
}

/**
 * Everything a project's workspace owns.
 *
 * `activeSessionId` is on the project row and is filled in by the caller; the rest is keyed by
 * project in each table.
 */
function workspaceOf(projectId: string, rows: ReturnType<typeof collected>): WorkspaceData {
  const sessions = rows.sessions.get(projectId) ?? [];
  return {
    sessions: sessions.map(toSession),
    activeSessionId: null,
    transcripts: transcriptsOf(rows.messages.get(projectId) ?? []),
    results: (rows.results.get(projectId) ?? []).map(
      ({ projectId: _p, position: _pos, ...result }) => result,
    ),
    tasks: (rows.tasks.get(projectId) ?? []).map(({ projectId: _p, position: _pos, ...task }) => ({
      ...task,
      attachments: task.attachments ?? [],
    })),
    waves: (rows.waves.get(projectId) ?? []).map(({ projectId: _p, position: _pos, ...wave }) => wave),
    members: (rows.members.get(projectId) ?? []).map(
      ({ projectId: _p, position: _pos, ...member }) => member,
    ),
    labels: (rows.labels.get(projectId) ?? []).map(({ projectId: _p, position: _pos, ...label }) => label),
    notes: (rows.notes.get(projectId) ?? []).map(({ projectId: _p, position: _pos, ...note }) => note),
    views: (rows.views.get(projectId) ?? []).map(({ projectId: _p, position: _pos, ...view }) => view),
    inbox: (rows.inbox.get(projectId) ?? []).map(({ projectId: _p, position: _pos, ...entry }) => entry),
    targets: (rows.targets.get(projectId) ?? []).map(
      ({ projectId: _p, position: _pos, config, ...target }) => ({ ...target, config: config ?? {} }),
    ),
    jobs: (rows.jobs.get(projectId) ?? []).map(({ projectId: _p, position: _pos, error, ...job }) => ({
      ...job,
      error: error ?? undefined,
    })),
    records: (rows.records.get(projectId) ?? []).map(
      ({ projectId: _p, position: _pos, year, venue, doi, url, abstract, extra, ...record }) => ({
        ...record,
        year: year ?? undefined,
        venue: venue ?? undefined,
        doi: doi ?? undefined,
        url: url ?? undefined,
        abstract: abstract ?? undefined,
        extra: extra ?? undefined,
      }),
    ),
  };
}

/** The per-project groupings, named so {@link workspaceOf} can take them as one argument. */
function collected(loaded: {
  sessions: SessionRow[];
  messages: MessageRow[];
  results: ResultRow[];
  tasks: TaskRow[];
  waves: WaveRow[];
  members: MemberRow[];
  labels: LabelRow[];
  notes: NoteRow[];
  views: ViewRow[];
  inbox: InboxRow[];
  targets: TargetRow[];
  jobs: JobRow[];
  records: RecordRow[];
}) {
  return {
    sessions: byProject(loaded.sessions),
    messages: byProject(loaded.messages),
    results: byProject(loaded.results),
    tasks: byProject(loaded.tasks),
    waves: byProject(loaded.waves),
    members: byProject(loaded.members),
    labels: byProject(loaded.labels),
    notes: byProject(loaded.notes),
    views: byProject(loaded.views),
    inbox: byProject(loaded.inbox),
    targets: byProject(loaded.targets),
    jobs: byProject(loaded.jobs),
    records: byProject(loaded.records),
  };
}

function toProvider(row: typeof t.providers.$inferSelect): Provider {
  const { position: _position, defaultBaseUrl, docsUrl, ...provider } = row;
  return { ...provider, defaultBaseUrl: defaultBaseUrl ?? undefined, docsUrl: docsUrl ?? undefined };
}

/** Read everything the app persists. */
export async function loadState(db: Db): Promise<Partial<Persisted>> {
  const [
    projectRows,
    settingRows,
    providerRows,
    sessionRows,
    messageRows,
    resultRows,
    taskRows,
    waveRows,
    memberRows,
    labelRows,
    noteRows,
    viewRows,
    inboxRows,
    targetRows,
    jobRows,
    recordRows,
  ] = await Promise.all([
    db.select().from(t.projects).orderBy(t.projects.createdAt),
    db.select().from(t.settings),
    db.select().from(t.providers).orderBy(t.providers.position),
    db.select().from(t.sessions).orderBy(t.sessions.position),
    db.select().from(t.messages).orderBy(t.messages.position),
    db.select().from(t.results).orderBy(t.results.position),
    db.select().from(t.tasks).orderBy(t.tasks.position),
    db.select().from(t.waves).orderBy(t.waves.position),
    db.select().from(t.members).orderBy(t.members.position),
    db.select().from(t.labels).orderBy(t.labels.position),
    db.select().from(t.notes).orderBy(t.notes.position),
    db.select().from(t.views).orderBy(t.views.position),
    db.select().from(t.inboxEntries).orderBy(t.inboxEntries.position),
    db.select().from(t.targets).orderBy(t.targets.position),
    db.select().from(t.jobs).orderBy(t.jobs.position),
    db.select().from(t.records).orderBy(t.records.position),
  ]);

  const rows = collected({
    sessions: sessionRows,
    messages: messageRows,
    results: resultRows,
    tasks: taskRows,
    waves: waveRows,
    members: memberRows,
    labels: labelRows,
    notes: noteRows,
    views: viewRows,
    inbox: inboxRows,
    targets: targetRows,
    jobs: jobRows,
    records: recordRows,
  });

  const projects: Project[] = projectRows.map((row) => {
    const { activeSessionId, ...project } = row;
    return { ...project, workspace: { ...workspaceOf(row.id, rows), activeSessionId } };
  });

  const settings = new Map(settingRows.map((row) => [row.key, row.value]));
  const persisted: Partial<Persisted> = { projects };
  for (const key of SETTING_KEYS) {
    const value = settings.get(key);
    if (value !== undefined) {
      (persisted as Record<string, unknown>)[key] = value;
    }
  }
  if (providerRows.length > 0) {
    persisted.customProviders = providerRows.map(toProvider);
  }
  return persisted;
}

/* ================================================================================================
 * Writing
 * ============================================================================================== */

const projectSyncer = new TableSyncer<Project>(t.projects, (project, position) => ({
  id: project.id,
  name: project.name,
  path: project.path,
  icon: project.icon,
  createdAt: project.createdAt,
  lastOpenedAt: project.lastOpenedAt,
  activeSessionId: project.workspace.activeSessionId,
}));

const sessionSyncer = new TableSyncer<Session>(t.sessions, (session, position, projectId) => ({
  id: session.id,
  projectId,
  position,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  phase: session.phase,
  agentId: session.agentId ?? null,
  experimentId: session.experimentId ?? null,
  branch: session.branch ?? null,
  pullRequest: session.pullRequest ?? null,
  pinned: session.pinned ?? null,
  plan: session.plan ?? null,
  parentId: session.parentId ?? null,
  worker: session.worker ?? null,
  finishedAt: session.finishedAt ?? null,
  usage: session.usage ?? null,
}));

const resultSyncer = new TableSyncer<WorkspaceData['results'][number]>(
  t.results,
  (result, position, projectId) => ({
    id: result.id,
    projectId,
    position,
    name: result.name,
    path: result.path,
    sessionId: result.sessionId,
    createdAt: result.createdAt,
    pinned: result.pinned,
  }),
);

const taskSyncer = new TableSyncer<Task>(t.tasks, (task, position, projectId) => ({
  id: task.id,
  projectId,
  position,
  key: task.key,
  title: task.title,
  description: task.description,
  kind: task.kind,
  status: task.status,
  priority: task.priority,
  waveId: task.waveId,
  parentId: task.parentId,
  assigneeId: task.assigneeId,
  labels: task.labels,
  estimate: task.estimate,
  dueDate: task.dueDate,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  relations: task.relations,
  evidence: task.evidence,
  comments: task.comments,
  attachments: task.attachments,
  subtasks: task.subtasks,
}));

const waveSyncer = new TableSyncer<Wave>(t.waves, (wave, position, projectId) => ({
  id: wave.id,
  projectId,
  position,
  number: wave.number,
  name: wave.name,
  startDate: wave.startDate,
  endDate: wave.endDate,
  goal: wave.goal,
}));

const memberSyncer = new TableSyncer<Member>(t.members, (member, position, projectId) => ({
  id: member.id,
  projectId,
  position,
  name: member.name,
  initials: member.initials,
  role: member.role,
  email: member.email,
  color: member.color,
}));

const labelSyncer = new TableSyncer<Label>(t.labels, (label, position, projectId) => ({
  id: label.id,
  projectId,
  position,
  name: label.name,
  color: label.color,
  group: label.group,
}));

const noteSyncer = new TableSyncer<Note>(t.notes, (note, position, projectId) => ({
  id: note.id,
  projectId,
  position,
  title: note.title,
  body: note.body,
  authorId: note.authorId,
  updatedAt: note.updatedAt,
}));

const viewSyncer = new TableSyncer<SavedView>(t.views, (view, position, projectId) => ({
  id: view.id,
  projectId,
  position,
  name: view.name,
  ownerId: view.ownerId,
  layout: view.layout,
  filters: view.filters,
  starred: view.starred,
}));

const inboxSyncer = new TableSyncer<InboxEntry>(t.inboxEntries, (entry, position, projectId) => ({
  id: entry.id,
  projectId,
  position,
  kind: entry.kind,
  taskId: entry.taskId,
  actorId: entry.actorId,
  body: entry.body,
  createdAt: entry.createdAt,
  read: entry.read,
}));

const targetSyncer = new TableSyncer<Target>(t.targets, (target, position, projectId) => ({
  id: target.id,
  projectId,
  position,
  name: target.name,
  kind: target.kind,
  host: target.host,
  summary: target.summary,
  readiness: target.readiness,
  cores: target.cores,
  memoryGb: target.memoryGb,
  gpus: target.gpus,
  concurrency: target.concurrency,
  allocation: target.allocation,
  needs: target.needs,
  cost: target.cost,
  credentials: target.credentials,
  check: target.check,
  recentJobs: target.recentJobs,
  config: target.config,
}));

const jobSyncer = new TableSyncer<Job>(t.jobs, (job, position, projectId) => ({
  id: job.id,
  projectId,
  position,
  name: job.name,
  state: job.state,
  targetId: job.targetId,
  startedMinutesAgo: job.startedMinutesAgo,
  duration: job.duration,
  progress: job.progress,
  cpuHours: job.cpuHours,
  gpuHours: job.gpuHours,
  cost: job.cost,
  error: job.error ?? null,
  command: job.command,
  inputs: job.inputs,
  outputs: job.outputs,
  resources: job.resources,
  logTail: job.logTail,
  history: job.history,
  taskKeys: job.taskKeys,
  objective: job.objective,
}));

const recordSyncer = new TableSyncer<WorkspaceData['records'][number]>(
  t.records,
  (record, position, projectId) => ({
    id: record.id,
    projectId,
    position,
    source: record.source,
    kind: record.kind,
    title: record.title,
    authors: record.authors,
    year: record.year ?? null,
    venue: record.venue ?? null,
    doi: record.doi ?? null,
    url: record.url ?? null,
    abstract: record.abstract ?? null,
    extra: record.extra ?? null,
  }),
);

const providerSyncer = new TableSyncer<Provider>(t.providers, (provider, position) => ({
  id: provider.id,
  position,
  label: provider.label,
  protocol: provider.protocol,
  defaultBaseUrl: provider.defaultBaseUrl ?? null,
  requiresKey: provider.requiresKey,
  docsUrl: provider.docsUrl ?? null,
  summary: provider.summary,
  fields: provider.fields,
  models: provider.models,
}));

/** One message row per transcript entry, diffed by reference and index like everything else. */
class MessageSyncer {
  private previous = new Map<string, { message: Message; position: number }>();

  async sync(db: Db, projectId: string, transcripts: Record<string, Message[]>): Promise<void> {
    const changed: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const prefix = `${projectId}\u0000`;
    for (const [sessionId, messages] of Object.entries(transcripts)) {
      messages.forEach((message, position) => {
        const key = `${prefix}${sessionId}\u0000${message.id}`;
        seen.add(key);
        const before = this.previous.get(key);
        if (before?.message !== message || before.position !== position) {
          changed.push({
            id: message.id,
            projectId,
            sessionId,
            position,
            role: message.role,
            blocks: message.blocks,
            agent: message.agent ?? null,
            createdAt: message.createdAt,
            tokens: message.tokens ?? null,
          });
        }
      });
    }
    const removed = [...this.previous.keys()]
      .filter((key) => key.startsWith(prefix) && !seen.has(key))
      .map((key) => key.slice(key.lastIndexOf('\u0000') + 1));

    await upsertRows(db, t.messages, changed);
    await deleteRows(db, t.messages, removed);

    // Keep the other projects' memories; replace this project's.
    const kept = new Map([...this.previous].filter(([key]) => !key.startsWith(prefix)));
    for (const [sessionId, messages] of Object.entries(transcripts)) {
      messages.forEach((message, position) => {
        kept.set(`${prefix}${sessionId}\u0000${message.id}`, { message, position });
      });
    }
    this.previous = kept;
  }

  reset(): void {
    this.previous.clear();
  }

  /** Adopt the transcripts just read as the last-written ones. */
  prime(projectId: string, transcripts: Record<string, Message[]>): void {
    const prefix = `${projectId}\u0000`;
    const kept = new Map([...this.previous].filter(([key]) => !key.startsWith(prefix)));
    for (const [sessionId, messages] of Object.entries(transcripts)) {
      messages.forEach((message, position) => {
        kept.set(`${prefix}${sessionId}\u0000${message.id}`, { message, position });
      });
    }
    this.previous = kept;
  }
}

const messageSyncer = new MessageSyncer();

/** The app settings, one row per key; the diff is on the serialised value. */
const settingsSyncer = new MapSyncer<unknown>(t.settings, 'key', (key, value) => ({ key, value }));

/** Write the whole app state, touching only what changed. */
export async function saveState(db: Db, state: AppState): Promise<void> {
  // Fold the active workspace back onto its project, exactly as the reducer's snapshot step
  // does, so the active project and a stashed one are written the same way.
  const projects = state.projects.map((project) =>
    project.id === state.activeProjectId ? { ...project, workspace: snapshotWorkspace(state) } : project,
  );

  await withTransaction(db, async () => {
    await projectSyncer.sync(db, projects);
    await providerSyncer.sync(db, state.customProviders);
    await settingsSyncer.sync(db, settingsOf(state));

    for (const project of projects) {
      const workspace = project.workspace;
      await sessionSyncer.sync(db, workspace.sessions, project.id);
      await messageSyncer.sync(db, project.id, workspace.transcripts);
      await resultSyncer.sync(db, workspace.results, project.id);
      await taskSyncer.sync(db, workspace.tasks, project.id);
      await waveSyncer.sync(db, workspace.waves, project.id);
      await memberSyncer.sync(db, workspace.members, project.id);
      await labelSyncer.sync(db, workspace.labels, project.id);
      await noteSyncer.sync(db, workspace.notes, project.id);
      await viewSyncer.sync(db, workspace.views, project.id);
      await inboxSyncer.sync(db, workspace.inbox, project.id);
      await targetSyncer.sync(db, workspace.targets, project.id);
      await jobSyncer.sync(db, workspace.jobs, project.id);
      await recordSyncer.sync(db, workspace.records, project.id);
    }
  });
}

/**
 * Adopt what the database already holds as the last-written state.
 *
 * A process that has just opened the store has written nothing, and every syncer diffs against
 * what it wrote: without this, the first save of a one-shot process would rewrite every row and
 * delete none, so a task the caller removed would stay. Priming by key makes that save delete
 * what disappeared — see `TableSyncer.primeFromDb`.
 *
 * The transcripts are primed with the records themselves rather than by key, because they are
 * the one large table: an untouched transcript is then left alone instead of being rewritten on
 * every save. A turn appends new messages rather than editing old ones, so the reference diff
 * is enough.
 */
export async function primeStateSyncers(db: Db, state: AppState): Promise<void> {
  await projectSyncer.primeFromDb(db);
  await providerSyncer.primeFromDb(db);
  settingsSyncer.prime(settingsOf(state));

  for (const project of state.projects) {
    // The transcripts carry their records: see the note above.
    messageSyncer.prime(project.id, project.workspace.transcripts);
    await sessionSyncer.primeFromDb(db, project.id);
    await resultSyncer.primeFromDb(db, project.id);
    await taskSyncer.primeFromDb(db, project.id);
    await waveSyncer.primeFromDb(db, project.id);
    await memberSyncer.primeFromDb(db, project.id);
    await labelSyncer.primeFromDb(db, project.id);
    await noteSyncer.primeFromDb(db, project.id);
    await viewSyncer.primeFromDb(db, project.id);
    await inboxSyncer.primeFromDb(db, project.id);
    await targetSyncer.primeFromDb(db, project.id);
    await jobSyncer.primeFromDb(db, project.id);
    await recordSyncer.primeFromDb(db, project.id);
  }
}

/** The app-level settings as a keyed record, for the settings syncer. */
function settingsOf(state: AppState): Record<string, unknown> {
  return {
    activeProjectId: state.activeProjectId,
    modelRef: state.modelRef,
    providerBaseUrls: state.providerBaseUrls,
    route: state.route,
    tabs: state.tabs,
    taskLayout: state.taskLayout,
    taskGroupBy: state.taskGroupBy,
    taskSort: state.taskSort,
    reasoning: state.reasoning,
    mode: state.mode,
    theme: state.theme,
    navMode: state.navMode,
    execution: state.execution,
    guard: state.guard,
    preferences: state.preferences,
    prompts: state.prompts,
    enabledPacks: state.enabledPacks,
    installedPacks: state.installedPacks,
    closedMcps: state.closedMcps,
    indexRoot: state.indexRoot,
  };
}

/** Forget every record, keeping the schema and its migration bookkeeping. */
export async function clearState(db: Db): Promise<void> {
  await serialized(async () => {
    await withTransaction(db, async () => {
      // Projects first: every workspace row hangs off one and cascades.
      await db.delete(t.projects);
      await db.delete(t.providers);
      await db.delete(t.agents);
      await db.delete(t.researchTopics);
      await db.delete(t.databases);
      await db.delete(t.sources);
      await db.delete(t.cloudConnections);
      await db.delete(t.experimentDomains);
      await db.delete(t.experiments);
      await db.delete(t.reviews);
      await db.delete(t.papers);
      await db.delete(t.reviewContent);
      await db.delete(t.paperMeta);
      await db.delete(t.settings);
    });
    resetStateSyncers();
    resetAgentSyncer();
    resetCatalogSyncers();
    resetExperimentSyncers();
    resetLiteratureSyncers();
    resetTopicSyncer();
  });
}

/** Drop the write memories, so the next save rewrites everything. */
export function resetStateSyncers(): void {
  for (const syncer of [
    projectSyncer,
    sessionSyncer,
    resultSyncer,
    taskSyncer,
    waveSyncer,
    memberSyncer,
    labelSyncer,
    noteSyncer,
    viewSyncer,
    inboxSyncer,
    targetSyncer,
    jobSyncer,
    recordSyncer,
    providerSyncer,
    settingsSyncer,
  ]) {
    syncer.reset();
  }
  messageSyncer.reset();
}
