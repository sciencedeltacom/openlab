/**
 * Mentions of the app's own records.
 *
 * A draft can point at a record the workbench holds — `@job:j-1a2b3c4d`, `@target:t-…`,
 * `@experiment:EXP-A1B2`, `@database:openalex` — instead of describing it in prose. Two
 * readers need that: the composer, which offers the records by name so an id is never typed
 * by hand, and the model, which cannot see the store and so is handed the records spelled out.
 *
 * The vocabulary is deliberately small: a mention names one *record*, and a record is a whole
 * object with its own id. A file is not one of these — it is already a path the model can open
 * — and `@record:` is a citation, not a reference, so neither is touched here.
 *
 * Nothing in this file reads a store. The caller hands over the lists it already has, which
 * keeps the module pure and lets the composer, the send path and the checks share it.
 */

import type { Job, Target } from '@/store/compute';
import type { Task, Wave } from '@/store/research';
import type { Experiment } from '@/components/experiments/experiments';
import type { Database } from '@/components/databases/data';

/** The kinds of record a mention can name. */
export type MentionKind = 'job' | 'target' | 'experiment' | 'database' | 'task' | 'wave';

/** A kind, named for the menu. */
export interface MentionKindMeta {
  kind: MentionKind;
  /** The word typed after the `@`. */
  label: string;
  /** What one record of this kind is, for a reader meeting it in the menu. */
  noun: string;
}

/**
 * Every kind, in the order the menu shows them.
 *
 * Only records the workbench actually keeps: each one is a list in the store and a tool the
 * agent can already reach, so a mention cannot point at something nothing can read.
 */
export const MENTION_KINDS: readonly MentionKindMeta[] = [
  { kind: 'job', label: 'job', noun: 'a run in the job ledger' },
  { kind: 'target', label: 'target', noun: 'a machine a run can go to' },
  { kind: 'experiment', label: 'experiment', noun: 'an entry in the experiment ledger' },
  { kind: 'database', label: 'database', noun: 'a catalogue database' },
  { kind: 'task', label: 'task', noun: 'a tracked task' },
  { kind: 'wave', label: 'wave', noun: 'a wave of work' },
];

/** The kind a word names, or undefined when it names none. */
export function mentionKind(word: string): MentionKind | undefined {
  const wanted = word.toLowerCase();
  return MENTION_KINDS.find((meta) => meta.label === wanted)?.kind;
}

/* ================================================================================================
 * The records a draft may name
 * ============================================================================================== */

/** One record a mention can name. */
export interface Reference {
  kind: MentionKind;
  /** The id the tools take and the mention carries. */
  id: string;
  /** What a reader calls it. */
  label: string;
  /** The facts worth having without a second lookup. */
  detail: string;
  /** Other words a hand-typed mention may use instead of the id: names, a task key. */
  aliases: readonly string[];
}

/** The app's own records, as far as a mention is concerned. */
export interface ReferenceInput {
  jobs?: readonly Job[];
  targets?: readonly Target[];
  tasks?: readonly Task[];
  waves?: readonly Wave[];
  experiments?: readonly Experiment[];
  databases?: readonly Database[];
}

/** `A · B`, dropping the parts that are empty. */
function line(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

/** Every record a draft can name, from the lists the caller holds. */
export function referencesFrom(input: ReferenceInput): Reference[] {
  const targetOf = (id: string) => input.targets?.find((candidate) => candidate.id === id);
  const references: Reference[] = [];

  for (const job of input.jobs ?? []) {
    const target = targetOf(job.targetId);
    references.push({
      kind: 'job',
      id: job.id,
      label: job.name,
      detail: line(job.state, target && `on ${target.name}`, job.command && `\`${job.command}\``),
      aliases: [job.name],
    });
  }
  for (const target of input.targets ?? []) {
    references.push({
      kind: 'target',
      id: target.id,
      label: target.name,
      detail: line(target.readiness, target.kind, target.host, target.gpus),
      aliases: [target.name, target.host],
    });
  }
  for (const experiment of input.experiments ?? []) {
    references.push({
      kind: 'experiment',
      id: experiment.id,
      label: experiment.objective,
      detail: line(experiment.outcome, experiment.stage, experiment.designKind),
      aliases: [experiment.objective],
    });
  }
  for (const database of input.databases ?? []) {
    references.push({
      kind: 'database',
      id: database.id,
      label: database.name,
      detail: line(database.family, database.access, database.holds),
      aliases: [database.name],
    });
  }
  for (const task of input.tasks ?? []) {
    references.push({
      kind: 'task',
      id: task.id,
      label: task.title,
      detail: line(task.key, task.status),
      aliases: [task.key, task.title],
    });
  }
  for (const wave of input.waves ?? []) {
    references.push({
      kind: 'wave',
      id: wave.id,
      label: `W${wave.number} · ${wave.name}`,
      detail: line(wave.startDate, wave.endDate && `→ ${wave.endDate}`),
      aliases: [`W${wave.number}`, wave.name],
    });
  }
  return references;
}

/** A name as it is typed without its spaces: `Train baseline` becomes `train-baseline`. */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The record a mention names: by id first, then by a name or key.
 *
 * Ids are what a pick inserts, but someone who knows a task's key — `TASK-12` — or a job's
 * name will type that instead, so both are looked up. A name loses its spaces in the token,
 * so `train-baseline` finds `Train baseline`.
 */
export function findReference(
  kind: MentionKind,
  value: string,
  references: readonly Reference[],
): Reference | undefined {
  const wanted = value.trim().toLowerCase();
  if (!wanted) {
    return undefined;
  }
  const of = references.filter((reference) => reference.kind === kind);
  const matches = (reference: Reference, test: (alias: string) => boolean) =>
    reference.id.toLowerCase() === wanted || reference.aliases.some((alias) => test(alias));
  return (
    of.find((reference) => matches(reference, (alias) => alias.toLowerCase() === wanted)) ??
    of.find((reference) => matches(reference, (alias) => slug(alias) === wanted))
  );
}

/* ================================================================================================
 * Mentions in a message
 * ============================================================================================== */

/** A `@kind:value` token found in a draft. */
export interface ParsedMention {
  kind: MentionKind;
  /** What followed the colon. */
  value: string;
  /** The token as it was typed. */
  raw: string;
}

/** `@kind:value` — one unbroken token. A colon-only kind is left for the composer to finish. */
const MENTION = /@([a-z]+):([^\s@]+)/gi;

/** Every record mention in a message. A token of an unknown kind is not one. */
export function parseMentions(text: string): ParsedMention[] {
  const found: ParsedMention[] = [];
  MENTION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION.exec(text)) !== null) {
    const kind = mentionKind(match[1]!);
    if (!kind) {
      continue;
    }
    // A mention often ends a sentence or sits in parentheses; that punctuation is not the value.
    const value = match[2]!.replace(/[.,;:!?)]+$/, '');
    if (value && value !== ':') {
      found.push({ kind, value, raw: match[0]!.replace(/[.,;:!?)]+$/, '') });
    }
  }
  return found;
}

/** The line above the records, so the model knows what the list it is reading is. */
const HEADING = 'Records mentioned in this message:';

/**
 * What the mentions in a message name, one line each — or an empty string when there are none.
 *
 * The model cannot see the store, so each mention is spelled out with the id its tools take
 * and the facts that identify it. A mention naming nothing is stated as such rather than
 * dropped: a model that is told the record is missing asks, and one that is not told guesses.
 */
export function referenceBlock(text: string, references: readonly Reference[]): string {
  const mentions = parseMentions(text);
  if (mentions.length === 0) {
    return '';
  }
  const lines = mentions.map((mention) => {
    const found = findReference(mention.kind, mention.value, references);
    if (!found) {
      return `- ${mention.raw}: no such ${mention.kind} names that here.`;
    }
    const facts = found.detail ? ` (${found.detail})` : '';
    return `- ${mention.raw} = “${found.label}”, the ${found.kind} ${found.id}${facts}`;
  });
  return [HEADING, ...lines].join('\n');
}

/**
 * The message to send: what the user wrote, then what their mentions name.
 *
 * Nothing is appended when nothing was mentioned, so an ordinary message is unchanged. The
 * block is part of the message rather than hidden beside it, the way a slash command's
 * expansion is: the transcript then holds what the model actually read.
 */
export function withReferences(text: string, references: readonly Reference[]): string {
  const block = referenceBlock(text, references);
  return block ? `${text}\n\n${block}` : text;
}
