/**
 * The domain seam.
 *
 * Files, processes and the network reach the agent through the tool host, which the Rust
 * side implements. The app's own records — tracker tasks, compute targets, the job ledger —
 * live in the store, so they reach the agent through this: a small read/write port the
 * store implements, kept apart from the filesystem host because it is a different kind of
 * thing.
 */

import type { Job, Target } from '@/store/compute';
import type { SessionPlan } from '@/store/types';
import type { Task, Wave } from '@/store/research';
import type { ScienceRecord } from '@/lib/science/connectors';
import type {
  Experiment,
  ExperimentDomain,
  ExperimentOutcome,
  Trial,
} from '@/components/experiments/experiments';

/** Read and write the app's records for a tool call. */
export interface DomainHost {
  /** The workspace's current records. */
  tasks(): readonly Task[];
  waves(): readonly Wave[];
  targets(): readonly Target[];
  jobs(): readonly Job[];
  /** Sources already cited in this workspace. */
  records(): readonly ScienceRecord[];
  /** The experiments in the ledger, and the domains defined for them. */
  experiments(): readonly Experiment[];
  domains(): readonly ExperimentDomain[];
  /** Persist a new record. */
  addTask(task: Task): void;
  patchTask(id: string, patch: Partial<Task>): void;
  addWave(wave: Wave): void;
  patchWave(id: string, patch: Partial<Wave>): void;
  addTarget(target: Target): void;
  addJob(job: Job): void;
  /** Keep the sources a search returned, so a `record:<id>` citation can open them. */
  addRecords(records: readonly ScienceRecord[]): void;
  /** Create an experiment and return it; the ledger assigns its id. */
  createExperiment(input: Partial<Experiment>): Experiment;
  /** Associate an experiment with the session that made it. */
  linkExperiment?(sessionId: string, experimentId: string): void;
  /** Append a trial to an experiment. Returns false when the id is unknown. */
  logTrial(id: string, trial: Trial): boolean;
  /** Record an outcome. Returns false when the id is unknown. */
  setOutcome(id: string, outcome: ExperimentOutcome, summary?: string): boolean;
  /** The session's plan, when the agent has written one. */
  sessionPlan?(): SessionPlan | undefined;
  /** Replace the session's plan; the panel above the composer reads it. */
  setSessionPlan?(plan: SessionPlan): void;
  /** The session's title, when it has one worth keeping. */
  sessionTitle?(): string | undefined;
  /** Name the session, so the tab and the session list stop saying “Untitled session”. */
  setSessionTitle?(title: string): void;
  /** Open a separate session for a different job and start `prompt` in it; returns its id. */
  splitSession?(title: string, prompt: string): string | undefined;
  /** Define a domain. */
  createDomain(domain: ExperimentDomain): void;
  /**
   * Start a systematic review in the background.
   *
   * Returns the review id, or `null` when there is nothing to review against. The run
   * continues on its own and lands in the Reviews surface.
   */
  startReview?(inputs: { question: string; sources?: string[]; maxRecords?: number }): string | null;
}
