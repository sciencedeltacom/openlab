/**
 * Where a command runs.
 *
 * The settings live in the app state (and therefore in SQLite), but every caller that starts
 * a process — the agent's `run_command`, the composer's shell, a code block — only needs the
 * resolved object. These are the shapes Rust reads: `ExecutionConfig` in
 * `src-tauri/src/commands/execution.rs`, same field names.
 */

import { invokeCommand } from './ipc';

/** Same three modes as the Rust enum. */
export type ExecutionMode = 'host' | 'sandbox' | 'container';

/** Which sandbox implementation to ask for. `auto` means "whatever this machine has". */
export type SandboxEngine = 'auto' | 'bubblewrap' | 'seatbelt';

/** Which OCI runtime to ask for. `auto` prefers rootless Podman, then Docker. */
export type ContainerEngine = 'auto' | 'docker' | 'podman';

/** When an image may be pulled. */
export type PullPolicy = 'missing' | 'always' | 'never';

/** One sandbox setting set. */
export interface SandboxSettings {
  /** Reach the network from inside the sandbox. Off unless the work needs it. */
  network: boolean;
  /** Extra host paths mounted read-only. */
  readPaths: string[];
  /** Extra host paths mounted writable. */
  writePaths: string[];
  /** Variables set inside the sandbox (the rest of the shell environment is cleared). */
  env: Record<string, string>;
  /** Keep `/tmp` between commands instead of a private tmpfs. */
  keepTmp: boolean;
}

/** One container setting set. */
export interface ContainerSettings {
  engine: ContainerEngine;
  /** The image commands run in. Required. */
  image: string;
  network: boolean;
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
  readOnlyRoot: boolean;
  pull: PullPolicy;
  /** Extra binds, `host:container[:ro]`. */
  mounts: string[];
  env: Record<string, string>;
}

/** Everything a command needs to know about its environment. */
export interface ExecutionSettings {
  mode: ExecutionMode;
  sandbox: SandboxSettings;
  container: ContainerSettings;
}

/**
 * The default: sandboxed, because that is the setting a new reader should not have to find.
 *
 * Windows has no sandbox in this build, and failing every command on first use is a worse
 * first run than starting unisolated and offering the switch. The page says so as well.
 */
const WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

export const DEFAULT_EXECUTION: ExecutionSettings = {
  mode: WINDOWS ? 'host' : 'sandbox',
  sandbox: {
    network: false,
    readPaths: [],
    writePaths: [],
    env: {},
    keepTmp: false,
  },
  container: {
    engine: 'auto',
    image: 'python:3.12-slim',
    network: false,
    memoryMb: 4096,
    cpus: 2,
    pidsLimit: 512,
    readOnlyRoot: true,
    pull: 'missing',
    mounts: [],
    env: {},
  },
};

/** What this machine can actually run. */
export interface EngineAvailability {
  available: boolean;
  engine: string | null;
  engines: string[];
}

export interface ExecutionStatus {
  platform: 'linux' | 'macos' | 'windows';
  sandbox: EngineAvailability;
  container: EngineAvailability;
}

const MODES: ExecutionMode[] = ['host', 'sandbox', 'container'];
const SANDBOX_ENGINES: SandboxEngine[] = ['auto', 'bubblewrap', 'seatbelt'];
const CONTAINER_ENGINES: ContainerEngine[] = ['auto', 'docker', 'podman'];
const PULL_POLICIES: PullPolicy[] = ['missing', 'always', 'never'];

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function record(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function number(value: unknown, fallback: number, min: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;
}

/**
 * Turn whatever was stored into the current shape.
 *
 * A settings blob written by an older build is missing keys; a hand-edited database can hold
 * anything. Merging field by field keeps a bad value from disabling the page, while the
 * defaults stay the ones the code declares.
 */
export function normalizeExecution(value: unknown): ExecutionSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_EXECUTION;
  const stored = value as Partial<ExecutionSettings>;
  const sandbox = (stored.sandbox ?? {}) as Partial<SandboxSettings>;
  const container = (stored.container ?? {}) as Partial<ContainerSettings>;
  return {
    mode: oneOf(MODES, stored.mode, DEFAULT_EXECUTION.mode),
    sandbox: {
      network: sandbox.network === true,
      readPaths: strings(sandbox.readPaths),
      writePaths: strings(sandbox.writePaths),
      env: record(sandbox.env),
      keepTmp: sandbox.keepTmp === true,
    },
    container: {
      engine: oneOf(CONTAINER_ENGINES, container.engine, DEFAULT_EXECUTION.container.engine),
      image: typeof container.image === 'string' ? container.image : DEFAULT_EXECUTION.container.image,
      network: container.network === true,
      memoryMb: number(container.memoryMb, DEFAULT_EXECUTION.container.memoryMb, 128),
      cpus: number(container.cpus, DEFAULT_EXECUTION.container.cpus, 0.1),
      pidsLimit: number(container.pidsLimit, DEFAULT_EXECUTION.container.pidsLimit, 1),
      readOnlyRoot: container.readOnlyRoot !== false,
      pull: oneOf(PULL_POLICIES, container.pull, DEFAULT_EXECUTION.container.pull),
      mounts: strings(container.mounts),
      env: record(container.env),
    },
  };
}

/** What the machine offers, or `null` outside the desktop shell. */
export async function loadExecutionStatus(): Promise<ExecutionStatus | null> {
  const result = await invokeCommand<ExecutionStatus>('execution_status', {});
  return result.ok ? result.value : null;
}

/** Only the fields the Rust builder reads, so a caller cannot grow the payload by accident. */
export function executionPayload(settings: ExecutionSettings): ExecutionSettings {
  return normalizeExecution(settings);
}

/** A one-line description for the shell result and the run records. */
export function describeExecution(settings: ExecutionSettings): string {
  if (settings.mode === 'host') return 'this machine';
  if (settings.mode === 'sandbox') {
    const engine = settings.sandbox.network ? 'network on' : 'network off';
    return `sandbox (${engine})`;
  }
  return `container ${settings.container.image} (${settings.container.network ? 'network on' : 'network off'})`;
}
