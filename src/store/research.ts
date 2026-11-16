/**
 * The research tracker.
 *
 * The shape is the one a planning tool needs — intent, work, and time — named for research
 * rather than for software:
 *
 *   Task     →  Sub-task
 *   Wave     (a bounded stretch of experiment time, like a sprint)
 *   Evidence (what makes a task's claim checkable: a dataset, a figure, a paper, a run)
 *
 * "Task" covers what a lab actually does: an analysis, a bench experiment, a manuscript
 * section, a peer review, a dataset, or plumbing. `kind` is that axis.
 *
 * Everything here is interface data. Nothing in this file calls a network or a model; it is
 * the content the screens render so the surfaces can be judged on their own.
 */

/* ================================================================================================
 * Vocabulary
 * ============================================================================================== */

import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Cpu,
  Eye,
  OctagonAlert,
  FlaskConical,
  FolderCog,
  PenLine,
  Sigma,
  Table2,
  type LucideIcon,
} from 'lucide-react';

/** Where a task sits in its life. Ordered as the board reads, left to right. */
export const WORK_STATUSES = [
  'backlog',
  'planned',
  'active',
  'review',
  'blocked',
  'done',
  'cancelled',
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

/**
 * How a status presents itself.
 *
 * Three things, because a status is read in three places: a dot in a dense row where only
 * colour fits, an icon where there is room for one, and a tinted chip where the status is the
 * subject. Keeping them together is what stops a status looking like three different things
 * depending on where you meet it.
 */
export const STATUS_META: Record<
  WorkStatus,
  { label: string; tone: string; ink: string; icon: LucideIcon; chip: string }
> = {
  backlog: {
    label: 'Backlog',
    tone: 'bg-muted',
    ink: 'text-muted',
    icon: CircleDashed,
    chip: 'bg-muted/15 text-muted',
  },
  planned: {
    label: 'Planned',
    tone: 'bg-warning',
    ink: 'text-warning',
    icon: CalendarClock,
    chip: 'bg-warning/15 text-warning',
  },
  active: {
    label: 'In progress',
    tone: 'bg-accent',
    ink: 'text-accent',
    icon: CircleDot,
    chip: 'bg-accent/15 text-accent',
  },
  review: {
    label: 'In review',
    tone: 'bg-accent-secondary',
    ink: 'text-accent-secondary',
    icon: Eye,
    chip: 'bg-accent-secondary/15 text-accent-secondary',
  },
  blocked: {
    label: 'Blocked',
    tone: 'bg-danger',
    ink: 'text-danger',
    icon: OctagonAlert,
    chip: 'bg-danger/15 text-danger',
  },
  done: {
    label: 'Done',
    tone: 'bg-success',
    ink: 'text-success',
    icon: CircleCheck,
    chip: 'bg-success/15 text-success',
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'bg-muted',
    ink: 'text-muted',
    icon: CircleSlash,
    chip: 'bg-muted/15 text-muted',
  },
};

/** Priority, Linear-style: 0 none through 4 urgent. */
export const PRIORITY_META: Record<number, { label: string; short: string; tone: string }> = {
  0: { label: 'No priority', short: '—', tone: 'text-muted' },
  1: { label: 'Low', short: 'Low', tone: 'text-muted' },
  2: { label: 'Medium', short: 'Med', tone: 'text-foreground' },
  3: { label: 'High', short: 'High', tone: 'text-warning' },
  4: { label: 'Urgent', short: 'Urg', tone: 'text-danger' },
};

/** The kinds of work a research group does. */
export const TASK_KINDS = [
  'analysis',
  'experiment',
  'data',
  'writing',
  'review',
  'compute',
  'admin',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * Icon and tone per kind, so a list is scannable without reading every title.
 *
 * Real icons rather than typographic glyphs: a `⚗` renders at whatever weight and baseline
 * the reader's fallback font happens to have, which is why a column of them never looks
 * like it belongs to the rest of the interface.
 */
export const KIND_META: Record<TaskKind, { label: string; icon: LucideIcon; tone: string }> = {
  analysis: { label: 'Analysis', icon: Sigma, tone: 'text-accent' },
  experiment: { label: 'Experiment', icon: FlaskConical, tone: 'text-success' },
  data: { label: 'Dataset', icon: Table2, tone: 'text-warning' },
  writing: { label: 'Writing', icon: PenLine, tone: 'text-foreground' },
  review: { label: 'Review', icon: Eye, tone: 'text-accent-secondary' },
  compute: { label: 'Compute', icon: Cpu, tone: 'text-muted' },
  admin: { label: 'Admin', icon: FolderCog, tone: 'text-muted' },
};

/* ================================================================================================
 * Records
 * ============================================================================================== */

/** A person in the lab. */
export interface Member {
  id: string;
  name: string;
  initials: string;
  role: string;
  /** Work address, shown under the name so two people with the same first name are told apart. */
  email: string;
  /** Avatar tint. */
  color: string;
}

/** A method or topic tag. */
export interface Label {
  id: string;
  name: string;
  color: string;
  group: 'method' | 'domain' | 'topic';
}

/** A bounded stretch of experiment time. */
export interface Wave {
  id: string;
  /** Sequential number, shown as `W12`. */
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  /** What the wave is for. */
  goal: string;
}

/** Something that makes a task's claim checkable. */
export interface Evidence {
  id: string;
  /** What kind of artefact this is. */
  kind: 'dataset' | 'figure' | 'paper' | 'run' | 'notebook' | 'code' | 'protocol';
  title: string;
  /** Where it lives: a path, a DOI, a job id. */
  ref: string;
  /** Whether a reader can check it right now. */
  verified: boolean;
}

/** A note on a task. */
export interface Comment {
  id: string;
  authorId: string;
  body: string;
  createdAt: number;
  /** Emoji → who reacted. */
  reactions: Record<string, string[]>;
  /** The comment this answers, when it is a reply. Replies sit in the same list. */
  parentId?: string | null;
}

/** A file a task carries. The path points at the workspace; the bytes are not copied. */
export interface TaskAttachment {
  id: string;
  kind: 'dataset' | 'notebook' | 'figure' | 'document' | 'archive';
  name: string;
  path: string;
  bytes: number;
  /** Who put it here. */
  by: string;
  at: number;
}

/** How two tasks relate. */
export interface Relation {
  type: 'blocks' | 'blocked-by' | 'related' | 'duplicates';
  id: string;
}

/** A unit of work. */
export interface Task {
  id: string;
  /** `KIN-142`, stable and short enough to say out loud. */
  key: string;
  title: string;
  description: string;
  kind: TaskKind;
  status: WorkStatus;
  /** 0 none … 4 urgent. */
  priority: number;
  waveId: string | null;
  parentId: string | null;
  assigneeId: string | null;
  labels: string[];
  /** Effort in days. */
  estimate: number | null;
  dueDate: string | null;
  createdAt: number;
  updatedAt: number;
  relations: Relation[];
  evidence: Evidence[];
  comments: Comment[];
  /** Files the task carries, by reference rather than by copy. */
  attachments: TaskAttachment[];
  /** Checklist inside a task. */
  subtasks: { id: string; title: string; done: boolean }[];
}

/** A note: a line of thinking that belongs to no task in particular. */
export interface Note {
  id: string;
  title: string;
  body: string;
  authorId: string;
  updatedAt: number;
}

/** A saved view: filters plus a layout. */
export interface SavedView {
  id: string;
  name: string;
  /** Who it belongs to, or `null` for the lab. */
  ownerId: string | null;
  layout: 'list' | 'board' | 'timeline';
  filters: TaskFilter;
  starred: boolean;
}

/** What a list is narrowed to. Absent keys mean "no constraint". */
export interface TaskFilter {
  status?: WorkStatus[];
  kind?: TaskKind[];
  priority?: number[];
  assigneeId?: string[];
  label?: string[];
  waveId?: string[];
  /** Free text over title and key. */
  text?: string;
  /** `true` shows only what is overdue. */
  overdue?: boolean;
}

/** An entry in the inbox: something that happened and may need a decision. */
export interface InboxEntry {
  id: string;
  kind:
    | 'assigned'
    | 'comment'
    | 'mention'
    | 'review-request'
    | 'status'
    | 'due'
    | 'evidence'
    | 'blocked'
    /** A run that was sent away came back: a systematic review finished. */
    | 'review-done'
    /** A run that was sent away failed. */
    | 'run-failed';
  taskId: string | null;
  actorId: string;
  body: string;
  createdAt: number;
  read: boolean;
}

/* ================================================================================================
 * Seed content
 *
 * A believable lab: a kinase selectivity reanalysis, a docking campaign, and the methods work
 * that supports them.
 * ============================================================================================== */

const day = 86_400_000;
const now = Date.now();

/** Build a timestamp `n` days from today, negative for the past. */
function at(days: number): number {
  return now + days * day;
}

/** Build an ISO date `n` days from today. */
function iso(days: number): string {
  return new Date(at(days)).toISOString().slice(0, 10);
}

/* ================================================================================================
 * Queries
 * ============================================================================================== */

/**
 * A fresh task with the defaults a new row needs.
 *
 * The key continues the highest number already in use, so `TASK-1`, `TASK-2` and so on read
 * as one family rather than colliding with an imported scheme.
 */
export function newTask(tasks: readonly Task[], title = 'Untitled task'): Task {
  const now = Date.now();
  const used = tasks
    .map((task) => Number(/(\d+)\s*$/.exec(task.key)?.[1] ?? NaN))
    .filter((value) => Number.isFinite(value));
  const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
  return {
    id: `t-${crypto.randomUUID().slice(0, 8)}`,
    key: `TASK-${next}`,
    title,
    description: '',
    kind: 'analysis',
    status: 'backlog',
    priority: 2,
    waveId: null,
    parentId: null,
    assigneeId: null,
    labels: [],
    estimate: null,
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    relations: [],
    evidence: [],
    comments: [],
    attachments: [],
    subtasks: [],
  };
}

/** A fresh wave, numbered after the highest already in use. */
export function newWave(waves: readonly Wave[]): Wave {
  const numbers = waves.map((wave) => wave.number).filter((value) => Number.isFinite(value));
  const number = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  const start = new Date();
  const end = new Date(start.getTime() + 13 * 86_400_000);
  return {
    id: `w-${crypto.randomUUID().slice(0, 8)}`,
    number,
    name: 'Untitled wave',
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    goal: '',
  };
}

/** A fresh person, with initials derived from the name and a colour from the palette. */
export function newMember(name = 'New person', role = '', email = ''): Member {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase();
  const palette = ['#1E5DB3', '#0B3C78', '#2FBF8F', '#F2A93B', '#E5534B'];
  const index = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
  return {
    id: `m-${crypto.randomUUID().slice(0, 8)}`,
    name: name.trim() || 'New person',
    initials,
    role,
    email,
    color: palette[index],
  };
}

/** A fresh label. */
export function newLabel(name = 'New label', color = '#1E5DB3', group: Label['group'] = 'topic'): Label {
  return { id: `l-${crypto.randomUUID().slice(0, 8)}`, name, color, group };
}

/** A fresh saved view over the current filter. */
export function newView(
  filters: TaskFilter = {},
  layout: SavedView['layout'] = 'list',
  name = 'New view',
): SavedView {
  return { id: `v-${crypto.randomUUID().slice(0, 8)}`, name, ownerId: null, layout, filters, starred: false };
}

/** The member a task is assigned to. */
export function memberById(members: readonly Member[], id: string | null): Member | undefined {
  return id ? members.find((member) => member.id === id) : undefined;
}

/** The labels a task carries, resolved. */
export function labelsOf(labels: readonly Label[], task: Task): Label[] {
  return task.labels
    .map((id) => labels.find((label) => label.id === id))
    .filter((label): label is Label => Boolean(label));
}

/** Whether a task is past its due date and not finished. */
export function isOverdue(task: Task, today = new Date().toISOString().slice(0, 10)): boolean {
  return Boolean(
    task.dueDate && task.dueDate < today && task.status !== 'done' && task.status !== 'cancelled',
  );
}

/** Apply a filter. Every key narrows; an absent key does not constrain. */
export function filterTasks(tasks: readonly Task[], filter: TaskFilter): Task[] {
  return tasks.filter((task) => {
    if (filter.status?.length && !filter.status.includes(task.status)) return false;
    if (filter.kind?.length && !filter.kind.includes(task.kind)) return false;
    if (filter.priority?.length && !filter.priority.includes(task.priority)) return false;
    if (filter.assigneeId?.length && !(task.assigneeId && filter.assigneeId.includes(task.assigneeId)))
      return false;
    if (filter.waveId?.length && !(task.waveId && filter.waveId.includes(task.waveId))) return false;
    if (filter.label?.length && !filter.label.some((id) => task.labels.includes(id))) return false;
    if (filter.overdue && !isOverdue(task)) return false;
    if (filter.text) {
      const needle = filter.text.toLowerCase();
      if (!task.title.toLowerCase().includes(needle) && !task.key.toLowerCase().includes(needle))
        return false;
    }
    return true;
  });
}

/** How many days a wave has left; negative once it has passed. */
export function waveDaysLeft(wave: Wave, today = new Date().toISOString().slice(0, 10)): number {
  return Math.round((Date.parse(wave.endDate) - Date.parse(today)) / day);
}

/** The wave that contains today, if any. */
export function currentWave(
  waves: readonly Wave[],
  today = new Date().toISOString().slice(0, 10),
): Wave | undefined {
  return waves.find((wave) => wave.startDate <= today && today <= wave.endDate);
}

/** Tasks grouped by status, for the board. */
export function byStatus(tasks: readonly Task[]): Record<WorkStatus, Task[]> {
  const groups = Object.fromEntries(WORK_STATUSES.map((status) => [status, [] as Task[]])) as Record<
    WorkStatus,
    Task[]
  >;
  for (const task of tasks) {
    groups[task.status].push(task);
  }
  return groups;
}

/**
 * An inbox entry, from the event it reports.
 *
 * The inbox is where work that happened without the reader watching comes back: a review that
 * finished while they were elsewhere, a run that failed overnight. Written from the event
 * rather than from a person, so `actorId` is whoever or whatever caused it.
 */
export function newInboxEntry(input: {
  kind: InboxEntry['kind'];
  body: string;
  taskId?: string | null;
  actorId?: string;
}): InboxEntry {
  return {
    id: `i-${crypto.randomUUID().slice(0, 8)}`,
    kind: input.kind,
    taskId: input.taskId ?? null,
    actorId: input.actorId ?? 'system',
    body: input.body,
    createdAt: Date.now(),
    read: false,
  };
}

/* ================================================================================================
 * Intake
 * ============================================================================================== */

/** The two answers a row in the intake queue can take. */
export type IntakeDecision = 'accepted' | 'declined';

/** Where a task goes when a triage decision accepts or declines it. */
export function intakeStatus(decision: IntakeDecision): WorkStatus {
  return decision === 'accepted' ? 'planned' : 'cancelled';
}

/** One row of the intake queue: something waiting for a person to decide. */
export interface IntakeRow {
  id: string;
  /** What kind of event it is, for the glyph; backlog work reads as an assignment. */
  kind: InboxEntry['kind'];
  actorId: string;
  body: string;
  createdAt: number;
  /** The task it is about, when it is about one. */
  task: Task | null;
  /** The inbox entry it came from, when it came from one. */
  entryId: string | null;
}

/**
 * The intake queue.
 *
 * Two things wait for a person: work the tracker took on but nobody owns — which is every
 * task an agent opens, since an agent cannot decide who should do it — and what the inbox
 * has not been read. Derived from the records rather than remembered, so accepting a task
 * removes its row by changing the task.
 */
export function intakeQueue(inbox: readonly InboxEntry[], tasks: readonly Task[]): IntakeRow[] {
  return [
    ...inbox
      .filter((entry) => !entry.read)
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        actorId: entry.actorId,
        body: entry.body,
        createdAt: entry.createdAt,
        task: tasks.find((task) => task.id === entry.taskId) ?? null,
        entryId: entry.id,
      })),
    ...tasks
      .filter((task) => task.status === 'backlog' && task.assigneeId === null)
      .map((task) => ({
        id: `backlog-${task.id}`,
        kind: 'assigned' as const,
        actorId: 'm1',
        body: `${task.key} has sat in the backlog with no owner.`,
        createdAt: task.createdAt,
        task,
        entryId: null,
      })),
  ];
}

/** Counts used by the sidebar badges. */
export function inboxUnread(inbox: readonly InboxEntry[]): number {
  return inbox.filter((entry) => !entry.read).length;
}
