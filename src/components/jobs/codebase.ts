/**
 * The working directory a run is launched against, as the codebase page reads it.
 *
 * A job runs in a folder it did not create, so the folder outlives any one run: the page
 * shows the folder the run was launched from, one folder at a time, and the run is what
 * changes between visits. The files are the workspace on disk, walked through the same
 * `list_dir` call the Files page uses; the transcript and the log come from the job's own
 * record, written here as the text a terminal renders.
 *
 * File kinds reuse the vocabulary the Files browser already ships, so a `.py` looks the
 * same in both places.
 */

import { JOB_STATE_META, type Job } from '../compute/data';
import { KIND_META } from '../files/meta';
import type { FileKind } from '../files/data';

/* ================================================================================================
 * The folder
 * ============================================================================================== */

/** A file as a folder listing hands it back: a name and a path relative to the root. */
export interface WorkdirFile {
  name: string;
  path: string;
}

/** One folder's contents: the folders inside it, and the files it holds. */
export interface FolderListing {
  folders: string[];
  files: WorkdirFile[];
}

/**
 * The folders and files directly inside one folder.
 *
 * The walk hands back every file with its path relative to the workspace, so one folder's
 * contents are the paths that start with its prefix and stop one segment later. Nothing is
 * listed that was not read, and nothing is read twice.
 */
export function childrenOf(files: readonly WorkdirFile[], folder: string): FolderListing {
  const prefix = folder ? `${folder}/` : '';
  const folders = new Set<string>();
  const here: WorkdirFile[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) here.push(file);
    else folders.add(rest.slice(0, slash));
  }
  return {
    folders: [...folders].sort((a, b) => a.localeCompare(b)),
    files: here.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The folder paths from the root down to a folder, each one a step a breadcrumb links. */
export function crumbsOf(folder: string): string[] {
  if (!folder) return [];
  const parts = folder.split('/');
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/* ================================================================================================
 * File kinds
 * ============================================================================================== */

/** Extensions mapped onto the kind vocabulary the Files browser already uses. */
const EXTENSION_KIND: Record<string, FileKind> = {
  py: 'code',
  sh: 'code',
  sbatch: 'code',
  toml: 'code',
  yaml: 'code',
  yml: 'code',
  json: 'code',
  ini: 'code',
  cfg: 'code',
  md: 'document',
  txt: 'document',
  log: 'document',
  rst: 'document',
  bib: 'document',
  csv: 'dataset',
  tsv: 'dataset',
  parquet: 'dataset',
  h5ad: 'dataset',
  h5: 'dataset',
  fa: 'dataset',
  fasta: 'dataset',
  fq: 'dataset',
  fastq: 'dataset',
  bam: 'dataset',
  bw: 'dataset',
  bed: 'dataset',
  gz: 'archive',
  zip: 'archive',
  tar: 'archive',
  pt: 'model',
  ckpt: 'model',
  joblib: 'model',
  pkl: 'model',
  png: 'figure',
  svg: 'figure',
  pdf: 'figure',
  jpg: 'figure',
  jpeg: 'figure',
  ipynb: 'notebook',
};

/** The kind an extension implies, falling back to a document. */
export function fileKindOf(name: string): FileKind {
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return EXTENSION_KIND[extension] ?? 'document';
}

/** The icon, tone and mark a file wears — the same map the Files browser reads. */
export function fileMeta(name: string) {
  return KIND_META[fileKindOf(name)];
}

/* ================================================================================================
 * The terminal
 * ============================================================================================== */

/** One line of the run's transcript. */
export interface TerminalLine {
  kind: 'command' | 'output' | 'note';
  text: string;
  tone?: 'success' | 'danger' | 'muted';
}

/** The command the run issued, its output, and how it ended. */
export function terminalLinesOf(job: Job): TerminalLine[] {
  const lines: TerminalLine[] = [{ kind: 'command', text: job.command }];
  for (const text of job.logTail) lines.push({ kind: 'output', text });
  if (job.state === 'succeeded') {
    lines.push({ kind: 'note', text: 'Process finished', tone: 'success' });
  } else if (job.state === 'failed') {
    const code = exitCodeOf(job);
    lines.push({
      kind: 'note',
      text: `Process failed${code !== null ? ` with code ${code}` : ''}`,
      tone: 'danger',
    });
  } else if (job.state === 'cancelled') {
    lines.push({ kind: 'note', text: 'Run cancelled by the operator', tone: 'muted' });
  }
  return lines;
}

/**
 * The colours terminal text is written in.
 *
 * The codes name palette slots — blue, green, red, bright black — rather than literal
 * colours, so the terminal theme decides what they look like and the page does not carry a
 * second copy of the palette.
 */
const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  muted: '\u001b[90m',
  accent: '\u001b[34m',
  success: '\u001b[32m',
  danger: '\u001b[31m',
  warning: '\u001b[33m',
} as const;

/** The transcript as terminal text: the command under a prompt, its output, and the ending. */
export function terminalText(job: Job): string[] {
  return terminalLinesOf(job).map((line) => {
    if (line.kind === 'command') return typedLine(line.text);
    if (line.kind === 'output') return `${ANSI.muted}${line.text}${ANSI.reset}`;
    const tone = line.tone === 'success' ? ANSI.success : line.tone === 'danger' ? ANSI.danger : ANSI.muted;
    return `${tone}${line.text}${ANSI.reset}`;
  });
}

/**
 * A command under its prompt.
 *
 * The transcript's own command line is built the same way, so a line typed at the prompt
 * reads as one of the run's rather than as a second kind of line.
 */
export function typedLine(command: string): string {
  return `${ANSI.bold}${ANSI.accent}❯ ${command}${ANSI.reset}`;
}

/** A line the terminal says about itself, in the tone the transcript uses for the same. */
export function mutedLine(text: string): string {
  return `${ANSI.muted}${text}${ANSI.reset}`;
}

/** A line about something that went wrong. */
export function dangerLine(text: string): string {
  return `${ANSI.danger}${text}${ANSI.reset}`;
}

/**
 * Where a `cd` lands, relative to the folder the terminal is in.
 *
 * A shell asks the disk; this walks the path instead, because the boundary is not this
 * function's to settle: whatever it returns is handed to the command layer, which refuses a
 * folder outside the workspace. `..` is left to reach it rather than quietly clamped.
 */
export function joinPath(from: string, to: string): string {
  const absolute = to.startsWith('/');
  const parts = absolute ? [] : from.split('/').filter(Boolean);
  for (const part of to.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0) parts.pop();
      else parts.push('..');
    } else parts.push(part);
  }
  const joined = parts.join('/');
  return absolute || from.startsWith('/') ? `/${joined}` : joined;
}

/* ================================================================================================
 * The run's exit code
 * ============================================================================================== */

/** The exit code the run reported, from its history note, or from how it ended. */
export function exitCodeOf(job: Job): number | null {
  for (const event of job.history) {
    const match = event.note?.match(/exit\s+(\d+)/i);
    if (match) return Number(match[1]);
  }
  if (job.state === 'succeeded') return 0;
  if (job.state === 'failed') return 1;
  if (job.state === 'cancelled') return 130;
  return null;
}

/* ================================================================================================
 * The log
 * ============================================================================================== */

/** The levels a logged line can carry. */
export type LogLevel = 'info' | 'warn' | 'error';

/** One timestamped log line. */
export interface LogLine {
  at: string;
  level: LogLevel;
  message: string;
}

/** Read a level off a line; the vocabulary is small on purpose. */
function levelOf(text: string): LogLevel {
  const lower = text.toLowerCase();
  if (/error|valueerror|traceback|exit 1|failed/.test(lower)) return 'error';
  if (/warn|missing|held-out|cancel|throttl/.test(lower)) return 'warn';
  return 'info';
}

/** A deterministic start time for the run, between 07:00 and 19:00. */
function baseSeconds(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) >>> 0;
  }
  return 7 * 3600 + (hash % (12 * 3600));
}

/** A `HH:MM:SS` clock, advanced a few seconds per line. */
function clockAt(seed: string, index: number): string {
  const total = (baseSeconds(seed) + index * 7) % 86_400;
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts.map((part) => String(part).padStart(2, '0')).join(':');
}

/**
 * The run's log.
 *
 * The ledger stores a log tail and a state history, not a full log, so this folds the two
 * — plus the failure reason — into timestamped, levelled lines. The messages are the
 * run's own; only the clock is synthesised.
 */
export function logLinesOf(job: Job): LogLine[] {
  const seen = new Set<string>();
  const lines: { level: LogLevel; message: string }[] = [
    {
      level: 'info',
      message: `run ${job.id}: ${JOB_STATE_META[job.state].label.toLowerCase()} on ${job.targetId}`,
    },
    {
      level: 'info',
      message: `allocated ${job.resources.cores} cores and ${job.resources.memoryGb} GB memory${job.resources.gpus ? `, ${job.resources.gpus}` : ''}`,
    },
  ];
  for (const event of job.history) {
    lines.push({ level: levelOf(`${event.state} ${event.note ?? ''}`), message: event.note ?? event.state });
  }
  for (const text of job.logTail) {
    lines.push({ level: levelOf(text), message: text });
  }
  if (job.error) lines.push({ level: 'error', message: job.error });

  return lines
    .filter((line) => {
      if (seen.has(line.message)) return false;
      seen.add(line.message);
      return true;
    })
    .map((line, index) => ({ at: clockAt(job.id, index), ...line }));
}

/** The log as terminal text: the clock, the level, and the message. */
export function logText(lines: readonly LogLine[]): string[] {
  return lines.map((line) => {
    const tone = line.level === 'error' ? ANSI.danger : line.level === 'warn' ? ANSI.warning : ANSI.muted;
    const label = line.level === 'error' ? 'ERR' : line.level === 'warn' ? 'WRN' : 'INF';
    return `${ANSI.muted}${line.at}${ANSI.reset} ${tone}${label}${ANSI.reset} ${line.message}`;
  });
}
