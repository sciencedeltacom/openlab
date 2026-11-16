/**
 * Slash commands.
 *
 * A command is a named entry point into a procedure: what you type in the composer, and what
 * the agent is actually asked to do. It is deliberately not a second prompt language — a
 * command is a body with `$1` placeholders, so the expansion is the prompt, and the transcript
 * shows what ran rather than what was typed.
 *
 * Three sources, one list: the built-ins that ship with openlab and map onto tools the runtime
 * already has, the commands this project keeps in `.openlab/commands/*.md`, and the ones a
 * user writes here. The composer reads the same registry the settings page writes, which is
 * what makes "create a command" mean something.
 */

import { useSyncExternalStore } from 'react';

import { invokeCommand, isDesktop } from '@/lib/ipc';

/** Where a project keeps its commands. */
export const COMMAND_DIR = '.openlab/commands';

export type CommandSource = 'builtin' | 'user' | 'project';

/** One command. */
export interface SlashCommand {
  id: string;
  /** The word typed after the slash, without it: `prep`. */
  name: string;
  description: string;
  /** Shown beside the name in the composer, e.g. `<pdb-id> [ph]`. */
  argumentHint?: string;
  /** Tool ids the command may use. Empty means the session's own surface. */
  allowedTools?: string[];
  /** The body, with `$1` / `${2:-7.4}` placeholders. */
  body: string;
  source: CommandSource;
}

/** What happens when a placeholder has no value and no default. */
export type MissingBehaviour = 'ask' | 'literal' | 'fail';

/**
 * The commands openlab ships.
 *
 * Each one names a tool the runtime already has, so a built-in cannot describe a capability
 * that is not there. They are the recurring moves: run a procedure, run a test, start a
 * review, open a task, read something properly.
 */
export const BUILTIN_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'builtin:skill',
    name: 'skill',
    description: 'Load a procedure from the library and follow it.',
    argumentHint: '<skill-id>',
    body: 'Load the procedure $1 with the skill tool, then follow it exactly. Read its inputs before starting, and when you finish, attach what it produced to the task it belongs to.',
    source: 'builtin',
  },
  {
    id: 'builtin:stats',
    name: 'stats',
    description: 'Run a statistical procedure and report it with its command.',
    argumentHint: '<procedure> [data]',
    body: 'Run the $1 procedure with the statistics tool on ${2:-the data in this workspace}, and report the result together with the command that produced it.',
    source: 'builtin',
  },
  {
    id: 'builtin:review',
    name: 'review',
    description: 'Start a systematic review against the saved sources.',
    argumentHint: '<question>',
    body: 'Start a systematic review for: $1. Screen the saved sources, extract the fields that answer it, and write the report.',
    source: 'builtin',
  },
  {
    id: 'builtin:task',
    name: 'task',
    description: 'Open a tracked task, then carry it out.',
    argumentHint: '<title>',
    body: 'Open a task titled “$1” with task_create, then carry it out. Keep it updated as it moves and attach what it produced.',
    source: 'builtin',
  },
  {
    id: 'builtin:read',
    name: 'read',
    description: 'Read something properly and explain what it does.',
    argumentHint: '<path or question>',
    body: 'Read $1 and explain what it does, in the order a reader needs it: what it is for, what it assumes, and what would break it.',
    source: 'builtin',
  },
];

/* ================================================================================================
 * The store
 * ============================================================================================== */

const KEY = 'openlab.commands.v1';
const BEHAVIOUR_KEY = 'openlab.commands.missing';

function read(): SlashCommand[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; commands?: SlashCommand[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.commands)) return [];
    return parsed.commands.filter(
      (command) => typeof command?.name === 'string' && typeof command?.body === 'string',
    );
  } catch {
    return [];
  }
}

let commands: SlashCommand[] = read();
let behaviour: MissingBehaviour = (() => {
  try {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(BEHAVIOUR_KEY);
    return saved === 'literal' || saved === 'fail' ? saved : 'ask';
  } catch {
    return 'ask';
  }
})();

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    // A project's commands are the folder's; only the ones written here are remembered.
    const kept = commands.filter((command) => command.source !== 'project');
    localStorage.setItem(KEY, JSON.stringify({ version: 1, commands: kept }));
  } catch {
    // Storage full or disabled: the session keeps working, the next launch starts empty.
  }
}

/** Every command a user wrote here. */
export function useCommands(): SlashCommand[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => commands,
  );
}

/** The behaviour in force when a placeholder has no value. */
export function useMissingBehaviour(): MissingBehaviour {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => behaviour,
  );
}

/** Set what a missing placeholder does. */
export function setMissingBehaviour(next: MissingBehaviour): void {
  behaviour = next;
  try {
    localStorage.setItem(BEHAVIOUR_KEY, next);
  } catch {
    // Storage disabled: the choice lasts the session.
  }
  emit();
}

/** Every command: the built-ins, then the project's and the user's, by name. */
export function allCommands(): SlashCommand[] {
  return [...BUILTIN_COMMANDS, ...commands].sort((a, b) => a.name.localeCompare(b.name));
}

/** One command by the word typed after the slash. A project command shadows a built-in. */
export function findCommand(name: string): SlashCommand | undefined {
  const wanted = name.toLowerCase();
  return (
    commands.find((command) => command.name.toLowerCase() === wanted) ??
    BUILTIN_COMMANDS.find((command) => command.name === wanted)
  );
}

/** Write a command, replacing one with the same name. */
export function saveCommand(command: Omit<SlashCommand, 'id' | 'source'> & { id?: string }): SlashCommand {
  const saved: SlashCommand = {
    id: command.id ?? `cmd-${crypto.randomUUID().slice(0, 8)}`,
    name: command.name.trim().replace(/^\/+/, '').toLowerCase(),
    description: command.description.trim(),
    argumentHint: command.argumentHint?.trim() || undefined,
    allowedTools: command.allowedTools && command.allowedTools.length > 0 ? command.allowedTools : undefined,
    body: command.body,
    source: 'user',
  };
  commands = [
    saved,
    ...commands.filter((candidate) => candidate.id !== saved.id && candidate.name !== saved.name),
  ];
  persist();
  emit();
  return saved;
}

/** Take a command out. A project one comes back on the next reload. */
export function removeCommand(id: string): void {
  commands = commands.filter((command) => command.id !== id);
  persist();
  emit();
}

/** Forget every command written here. */
export function clearCommands(): void {
  commands = commands.filter((command) => command.source === 'project');
  persist();
  emit();
}

/**
 * Read the project's own commands.
 *
 * A file is `name.md` with frontmatter: `description`, `argument-hint`, `allowed-tools`. The
 * body is everything after it. A file that does not parse is reported rather than skipped, so
 * a typo in a command is visible where it was written.
 */
export async function loadProjectCommands(root: string): Promise<{ loaded: number; errors: string[] }> {
  if (!isDesktop() || !root) return { loaded: 0, errors: [] };

  const files = await invokeCommand<string[]>('glob_files', { pattern: `${COMMAND_DIR}/*.md`, root });
  if (!files.ok) return { loaded: 0, errors: [files.error.message] };

  commands = commands.filter((command) => command.source !== 'project');
  const errors: string[] = [];
  let loaded = 0;

  for (const path of files.value) {
    const raw = await invokeCommand<string>('read_file', { path, root });
    if (!raw.ok) {
      errors.push(`${path}: ${raw.error.message}`);
      continue;
    }
    const name = (path.split('/').pop() ?? '').replace(/\.md$/, '');
    const parsed = parseCommandFile(name, raw.value);
    if (!parsed) {
      errors.push(`${path}: the frontmatter is not closed.`);
      continue;
    }
    commands = [...commands, parsed];
    loaded += 1;
  }

  emit();
  return { loaded, errors };
}

/** Parse a command file: frontmatter, then the body. */
export function parseCommandFile(name: string, text: string): SlashCommand | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.trimStart());
  if (!match) {
    return null;
  }
  const [, frontmatter, body] = match;
  const field = (key: string): string | undefined => {
    const line = frontmatter!.split('\n').find((candidate) => candidate.trim().startsWith(`${key}:`));
    return line?.slice(line.indexOf(':') + 1).trim() || undefined;
  };
  return {
    id: `project:${name}`,
    name,
    description: field('description') ?? '',
    argumentHint: field('argument-hint'),
    allowedTools: field('allowed-tools')
      ?.split(',')
      .map((tool) => tool.trim())
      .filter(Boolean),
    body: body!.trim(),
    source: 'project',
  };
}

/* ================================================================================================
 * Expansion
 * ============================================================================================== */

/** Split what follows a command into arguments. Quotes keep a phrase together. */
export function parseArgs(text: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return args;
}

/** A draft that is a command invocation. */
export function commandFromDraft(draft: string): { command: SlashCommand; args: string[] } | null {
  const trimmed = draft.trim();
  if (!trimmed.startsWith('/')) return null;
  const [word, ...rest] = trimmed.slice(1).split(/\s+/);
  const command = word ? findCommand(word) : undefined;
  if (!command) return null;
  return { command, args: parseArgs(rest.join(' ')) };
}

/** The result of turning a command and its arguments into a prompt. */
export interface Expansion {
  prompt: string;
  /** Placeholders that had no value and no default. */
  missing: string[];
}

/**
 * Expand a command's body.
 *
 * `$1` is the first argument, `${2:-7.4}` supplies a default. What happens to a placeholder
 * with neither is the one policy this file holds: ask, keep it literal, or refuse.
 */
export function expandCommand(
  command: SlashCommand,
  args: readonly string[],
  missing: MissingBehaviour = behaviour,
): Expansion {
  const unresolved: string[] = [];
  const prompt = command.body.replace(
    /\$\{(\d+)(?::-([^}]*))?\}|\$(\d+)/g,
    (_whole, braced, fallback, bare) => {
      const index = Number(braced ?? bare) - 1;
      const value = args[index];
      if (value !== undefined && value !== '') return value;
      if (fallback !== undefined) return fallback;
      unresolved.push(`$${index + 1}`);
      return `$${index + 1}`;
    },
  );

  if (unresolved.length === 0 || missing === 'literal') {
    return { prompt, missing: unresolved };
  }
  if (missing === 'fail') {
    return { prompt, missing: unresolved };
  }
  // `ask`: the expansion says what is still missing, so the turn comes back with a question
  // instead of a run against a placeholder.
  return {
    prompt: `${prompt}\n\n(Ask me for ${unresolved.join(', ')} before you start.)`,
    missing: unresolved,
  };
}

/**
 * Expand whatever is in the composer.
 *
 * Returns null when the draft is not a command, so the caller sends it unchanged. This is the
 * one place a slash is interpreted: the composer's menu and the settings page both read the
 * registry above, and nothing else knows what a command is.
 */
export function expandDraft(draft: string): Expansion | null {
  const invocation = commandFromDraft(draft);
  if (!invocation) return null;
  return expandCommand(invocation.command, invocation.args);
}
