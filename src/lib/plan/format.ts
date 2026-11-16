/**
 * The plan, as files.
 *
 * A plan that only exists inside one person's app is not a plan a lab can read, review or
 * hand over. So the plan layer — the waves a workspace works in and the tasks it has taken
 * on — is mirrored into the repository under `.openlab/plan/`, where git carries it and a
 * reader can open it without the app.
 *
 * What lives in the file is the *plan*: what the work is, when the stretch runs, who owns
 * each item and where each item stands. What stays in the app is the *record*: comments,
 * attachments, the inbox. A file that carried all of that would be a database with worse
 * diffs, and the point of this one is that a human reads it in a diff.
 *
 * This module is the format and nothing else — no filesystem, no store — so the round trip
 * can be proven without either. Every string it writes is a double-quoted YAML scalar and
 * every list is a flow sequence, which keeps the files valid YAML for other tools while
 * staying trivial to read back exactly as written.
 */

import type { Task, TaskKind, Wave, WorkStatus } from '@/store/research';
import { TASK_KINDS, WORK_STATUSES } from '@/store/research';

/** Where the plan lives inside a workspace. */
export const PLAN_DIR = '.openlab/plan';
export const PLAN_WAVE_DIR = `${PLAN_DIR}/waves`;
export const PLAN_BACKLOG = `${PLAN_DIR}/backlog.md`;
export const PLAN_README = `${PLAN_DIR}/README.md`;

/** The four fields that follow an item's title, in the order they are written. */
const STATUSES = new Set<string>(WORK_STATUSES);
const KINDS = new Set<string>(TASK_KINDS);
const PRIORITY = /^p[0-4]$/;
// The owner field is the last one, so it may hold a name with spaces in it.
const ASSIGNEE = /^@(.+)$/;

/* ================================================================================================
 * Scalars
 * ============================================================================================== */

/**
 * A person, as a file names them.
 *
 * The id is stable and unreadable, the name is readable and moves; a slug of the name is
 * both readable and safe in a line that uses spaces and dots as its own punctuation. A
 * reader sees `@ada-lovelace`, and a rename costs the owner on the next import rather than
 * corrupting the line.
 */
export function memberHandle(member: { id: string; name: string }): string {
  const slug = member.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || member.id;
}

/** A string as a YAML double-quoted scalar. */
function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** Read a double-quoted scalar, unescaping what {@link quoted} escaped. */
function unquote(raw: string): string {
  return raw.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * A front-matter value, read strictly.
 *
 * The shapes this module writes are accepted exactly — a double-quoted string, a number, a
 * flow sequence of quoted strings, or `null` — and so is a bare word, because a person
 * editing the file by hand will write `name: Docking campaign` and refusing that would make
 * the file writable by one reader and not another. A value that opens a quote or a bracket
 * and does not close it is refused rather than half-read: the file is not this module's
 * output and guessing at it is how a parser starts.
 */
export function readScalar(raw: string): string | number | string[] | null | undefined {
  const text = raw.trim();
  if (text === 'null' || text === '~' || text === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) return unquote(text);
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    return inner
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('"') && part.endsWith('"'))
      .map(unquote);
  }
  if (text.startsWith('"') || text.startsWith('[') || text.startsWith('{')) return undefined;
  return text;
}

/** The front matter of a file, as a map of scalars. Empty when there is none. */
export function readFrontMatter(text: string): Record<string, string | number | string[] | null> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return {};
  const fields: Record<string, string | number | string[] | null> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = readScalar(line.slice(separator + 1));
    if (key && value !== undefined) fields[key] = value;
  }
  return fields;
}

/** The body of a file: what follows the front matter, without the blank line under it. */
export function readBody(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\r?\n+/, '');
}

/* ================================================================================================
 * Task lines
 * ============================================================================================== */

/** How an item reads in a plan file: `- [ ] TASK-14 Title — active · analysis · p2 · @ada`. */
export function renderTaskLine(task: Task, handle?: string): string {
  const box = task.status === 'done' ? '[x]' : '[ ]';
  const owner = task.assigneeId ? `@${handle ?? task.assigneeId}` : '@none';
  const fields = [task.status, task.kind, `p${task.priority}`, owner].join(' · ');
  return `- ${box} ${task.key} ${task.title.trim()} — ${fields}`;
}

/** One item read back from a plan file. */
export interface TaskLine {
  key: string;
  title: string;
  status: WorkStatus;
  kind: TaskKind;
  priority: number;
  /** The name written after `@`, or `null` when the item is unowned. */
  assignee: string | null;
}

/**
 * Read an item line, or `undefined` when it is not one.
 *
 * The four trailing fields are taken from the right, so a title may contain the separator
 * without stealing a field — and a line whose trailing fields are not the four this module
 * writes is refused rather than half-understood. A refused line leaves the app's own record
 * alone, which is the only safe direction for a misread to fail in.
 */
export function readTaskLine(line: string): TaskLine | undefined {
  const match = /^\s*[-*]\s*\[([ xX])\]\s+(.+)$/.exec(line);
  if (!match) return undefined;
  const rest = match[2];
  const split = rest.lastIndexOf(' — ');
  if (split <= 0) return undefined;

  const head = rest.slice(0, split).trim();
  const fields = rest
    .slice(split + 3)
    .split('·')
    .map((field) => field.trim());
  if (fields.length !== 4) return undefined;

  const [status, kind, priority, owner] = fields;
  if (!STATUSES.has(status) || !KINDS.has(kind) || !PRIORITY.test(priority)) return undefined;
  const assignee = ASSIGNEE.exec(owner)?.[1];

  const key = /^(\S+)\s+(.*)$/.exec(head);
  if (!key) return undefined;
  const title = key[2].trim();
  if (!title) return undefined;

  return {
    key: key[1],
    title,
    // A ticked box is a finished item whatever the status word says: a reader who ticks a
    // line means done, and that is the edit worth honouring.
    status: match[1].toLowerCase() === 'x' ? 'done' : (status as WorkStatus),
    kind: kind as TaskKind,
    priority: Number(priority.slice(1)),
    assignee: assignee && assignee !== 'none' ? assignee.trim() : null,
  };
}

/** Every item line in a body, with the line number it was on. */
export function readTaskLines(body: string): { line: TaskLine; at: number }[] {
  return body
    .split(/\r?\n/)
    .map((text, index) => ({ line: readTaskLine(text), at: index + 1 }))
    .flatMap((entry) => (entry.line ? [{ line: entry.line, at: entry.at }] : []));
}

/* ================================================================================================
 * Wave files
 * ============================================================================================== */

/** A file-safe name for a wave: `003-docking-campaign`. */
export function waveSlug(wave: Wave): string {
  const name = wave.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/-$/, '');
  return `${String(wave.number).padStart(3, '0')}${name ? `-${name}` : ''}`;
}

/** The path a wave's file is written to. */
export function wavePath(wave: Wave): string {
  return `${PLAN_WAVE_DIR}/${waveSlug(wave)}.md`;
}

/** A wave file's front matter. */
function waveHeader(wave: Wave, at: string): string {
  return [
    '---',
    `id: ${quoted(wave.id)}`,
    `number: ${wave.number}`,
    `name: ${quoted(wave.name)}`,
    `start: ${quoted(wave.startDate)}`,
    `end: ${quoted(wave.endDate)}`,
    `updated: ${quoted(at)}`,
    '---',
  ].join('\n');
}

/** A job, as far as a wave's compute section cares. */
export interface WaveJob {
  id: string;
  name: string;
  state: string;
  cpuHours: number | null;
  gpuHours: number | null;
  /** The tasks the run was made for. */
  taskKeys: readonly string[];
}

/**
 * The jobs that belong to a wave.
 *
 * A job carries the task keys it was run for, so a wave owns the jobs of the tasks it
 * carries — which is how a wave's compute spend is answerable without a second link to keep
 * in step.
 */
export function jobsOfWave(jobs: readonly WaveJob[], tasks: readonly Task[]): WaveJob[] {
  const keys = new Set(tasks.map((task) => task.key));
  return jobs.filter((job) => job.taskKeys.some((key) => keys.has(key)));
}

/** The jobs that name a task in this wave, summarised. */
function computeSection(jobs: readonly WaveJob[]): string[] {
  if (jobs.length === 0) return [];
  return [
    '',
    '## Compute',
    '',
    ...jobs.map((job) => {
      const hours =
        job.gpuHours !== null
          ? `${job.gpuHours} GPU-h`
          : job.cpuHours !== null
            ? `${job.cpuHours} CPU-h`
            : '—';
      return `- ${job.id} · ${job.name} · ${hours} · ${job.state}`;
    }),
  ];
}

/** One wave, as a file. `tasks` is every task the wave carries, in the order to list them. */
export function renderWaveFile(input: {
  wave: Wave;
  tasks: readonly Task[];
  jobs?: readonly WaveJob[];
  /** The handle for a member id, so an owner reads as a name rather than a uuid. */
  handleOf?: (id: string) => string | undefined;
  at: string;
}): string {
  const { wave, tasks, at } = input;
  const lines = [
    waveHeader(wave, at),
    '',
    `# W${wave.number} · ${wave.name}`,
    '',
    wave.goal.trim() || 'No goal recorded.',
    '',
    '## Tasks',
    '',
    ...(tasks.length > 0
      ? tasks.map((task) => renderTaskLine(task, input.handleOf?.(task.assigneeId ?? '')))
      : ['No tasks in this wave yet.']),
    ...computeSection(input.jobs ?? []),
    '',
  ];
  return lines.join('\n');
}

/** The tasks that are in no wave. */
export function renderBacklogFile(input: {
  tasks: readonly Task[];
  handleOf?: (id: string) => string | undefined;
  at: string;
}): string {
  return [
    '---',
    `updated: ${quoted(input.at)}`,
    '---',
    '',
    '# Backlog',
    '',
    'Work taken on but not in a wave yet. A wave file under `waves/` lists the work inside it.',
    '',
    ...(input.tasks.length > 0
      ? input.tasks.map((task) => renderTaskLine(task, input.handleOf?.(task.assigneeId ?? '')))
      : ['Nothing in the backlog.']),
    '',
  ].join('\n');
}

/** The folder's own explanation, written once so a reader arriving by git is not lost. */
export function renderPlanReadme(at: string): string {
  return [
    '# Plan',
    '',
    'The workspace plan, written by openlab and read by git.',
    '',
    `- \`waves/\` holds one file per wave: the stretch of time, what it is for, the tasks inside and what it cost.`,
    '- `backlog.md`: work taken on but not in a wave yet.',
    '',
    'An item reads `- [ ] TASK-14 Title — status · kind · pN · @owner`. Ticking a box means done.',
    '',
    'openlab owns this folder: it rewrites these files whenever the plan changes, and reads',
    'them back when a workspace opens. Edit them: a change to a goal, a date, an owner, a',
    'status or a ticked box is picked up on the next open. But the app is where the record',
    'of the work (notes, attachments) lives.',
    '',
    `_Last written ${at}._`,
    '',
  ].join('\n');
}

/* ================================================================================================
 * Reading a plan back
 * ============================================================================================== */

/** A wave as a file describes it, before it is matched against the store. */
export interface PlannedWave {
  /** The id the file carries, or `null` when it was written by hand. */
  id: string | null;
  number: number;
  name: string;
  start: string;
  end: string;
  goal: string;
  path: string;
  items: TaskLine[];
}

/** A wave file read back. */
export function readWaveFile(path: string, text: string): PlannedWave | undefined {
  const fields = readFrontMatter(text);
  const number = typeof fields.number === 'number' ? fields.number : undefined;
  if (number === undefined || !Number.isFinite(number)) return undefined;

  const body = readBody(text);
  // The preamble is everything before the first section: the heading and the goal.
  const [preamble = '', ...sections] = body.split(/^##\s+/m);
  const goal = preamble
    .split(/\r?\n/)
    .filter((line) => !/^#\s/.test(line.trim()))
    .join('\n')
    .trim();

  const tasksSection = sections.find((section) => /^Tasks\b/.test(section)) ?? '';

  return {
    id: typeof fields.id === 'string' && fields.id ? fields.id : null,
    number: Math.max(1, Math.round(number)),
    // Empty when the file does not name it, so a merge can tell "unnamed" from "named
    // differently" and leave the app's own name alone.
    name: typeof fields.name === 'string' ? fields.name.trim() : '',
    start: typeof fields.start === 'string' ? fields.start : '',
    end: typeof fields.end === 'string' ? fields.end : '',
    goal,
    path,
    items: readTaskLines(tasksSection).map((entry) => entry.line),
  };
}

/** The backlog file read back. */
export function readBacklogFile(text: string): TaskLine[] {
  return readTaskLines(readBody(text)).map((entry) => entry.line);
}
