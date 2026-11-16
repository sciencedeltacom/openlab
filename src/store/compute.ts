/**
 * The compute domain: targets and jobs.
 *
 * A target is a machine a run can be sent to; a job is one run. Both live on the workspace
 * and are persisted, so the agent and the ledger read and write the same records. The types
 * are here rather than beside the views because they are domain, not presentation; the
 * labels and icons stay with the screens.
 */

/** How a target is reached. */
export type TargetKind = 'local' | 'ssh' | 'slurm' | 'hpc' | 'modal' | 'kaggle' | 'aws' | 'gcp' | 'azure';

/** Whether a target can take a job now, needs work first, or cannot run one at all. */
export type Readiness = 'ready' | 'needs-setup' | 'offline';

/** A meter reading of how much of a target's allocation is committed. */
export interface Allocation {
  used: number;
  total: number;
  /** The unit the two numbers are in, e.g. `core-h`. */
  unit: string;
}

/** One machine a job can run on. */
export interface Target {
  id: string;
  name: string;
  kind: TargetKind;
  /** Where it is reached: a hostname, a region, or the session itself. */
  host: string;
  summary: string;
  readiness: Readiness;
  cores: number;
  memoryGb: number;
  gpus: string | null;
  concurrency: number;
  allocation: Allocation | null;
  /** What still stands between this target and a run. Empty when ready. */
  needs: string[];
  cost: string;
  credentials: string[];
  check: { at: string; tone: 'success' | 'warning' | 'danger'; detail: string };
  /** Jobs recently run here, by id. */
  recentJobs: string[];
  /**
   * What the adapter needs to reach it: a host, a region, a queue.
   *
   * Configuration only. Credentials are named in {@link Target.credentials} and their values
   * live in the credential vault, keyed per target.
   */
  config: Record<string, string>;
}

/** Where a run is in its life. */
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** A file a run read or wrote. */
export interface Artifact {
  ref: string;
  note?: string;
}

/** One entry in a job's state history. */
export interface JobEvent {
  at: string;
  state: JobState;
  note?: string;
}

/** One run in the ledger. */
export interface Job {
  id: string;
  name: string;
  state: JobState;
  targetId: string;
  startedMinutesAgo: number | null;
  duration: string;
  progress: number | null;
  cpuHours: number | null;
  gpuHours: number | null;
  cost: string;
  error?: string;
  /** The exact command the run executed. */
  command: string;
  inputs: Artifact[];
  outputs: Artifact[];
  resources: { cores: number; memoryGb: number; gpus?: string; wallClock: string };
  logTail: string[];
  history: JobEvent[];
  /** Task keys this run belongs to, resolved against the tracker. */
  taskKeys: string[];
  objective: string;
}

const id = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

/** A new target from the minimum worth asking for; the rest is sensible defaults. */
export function newTarget(input: {
  name: string;
  kind: TargetKind;
  host: string;
  summary?: string;
  cores?: number;
  memoryGb?: number;
  gpus?: string;
  concurrency?: number;
  readiness?: Readiness;
  config?: Record<string, string>;
}): Target {
  const ready = input.readiness ?? 'needs-setup';
  return {
    id: id('t'),
    name: input.name,
    kind: input.kind,
    host: input.host,
    summary: input.summary ?? 'Added as a target.',
    readiness: ready,
    cores: input.cores ?? 8,
    memoryGb: input.memoryGb ?? 32,
    gpus: input.gpus ?? null,
    concurrency: input.concurrency ?? 1,
    allocation: null,
    needs: ready === 'ready' ? [] : ['A successful connection check'],
    cost: 'unmetered',
    credentials: [],
    check: {
      at: 'never',
      tone: ready === 'ready' ? 'success' : 'warning',
      detail: ready === 'ready' ? 'Declared ready when added.' : 'Not checked yet.',
    },
    recentJobs: [],
    config: input.config ?? {},
  };
}

/** A new job, queued, from the spec worth recording. */
export function newJob(input: {
  name: string;
  command: string;
  targetId: string;
  objective?: string;
  taskKeys?: string[];
  resources?: { cores: number; memoryGb: number; gpus?: string; wallClock: string };
}): Job {
  return {
    id: id('j'),
    name: input.name,
    state: 'queued',
    targetId: input.targetId,
    startedMinutesAgo: null,
    duration: '—',
    progress: null,
    cpuHours: null,
    gpuHours: null,
    cost: '—',
    command: input.command,
    inputs: [],
    outputs: [],
    resources: input.resources ?? { cores: 1, memoryGb: 2, wallClock: '2 h' },
    logTail: [],
    history: [{ at: 'just now', state: 'queued' }],
    taskKeys: input.taskKeys ?? [],
    objective: input.objective ?? 'Queued from the assistant.',
  };
}
