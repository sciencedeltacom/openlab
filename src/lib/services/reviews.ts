/**
 * Reviews that run in the background, as a service.
 *
 * A review is several model calls and a retrieval — long enough that the reader should not sit
 * on the create page for it. This service owns the runs: starting one returns immediately, the
 * work continues while the reader goes anywhere else, and the finished review lands in the
 * literature store as if the page had stayed open.
 *
 * The runs used to be module-level `let`s; they are fields now, so the container owns them and
 * the log a run keeps is bounded here rather than in the module graph.
 *
 * Runs are in memory, not persisted: a review interrupted by a quit is not a fact worth
 * keeping, and the review itself is written only once it is whole.
 */

import { addReviewRecords, beginReview, failReview, finishReview } from '@/components/literature/store';
import type { Review } from '@/components/literature/data';
import type { AppState } from '@/store/types';
import { resolveSources, runReview, type ReviewInputs } from '@/lib/literature/pipeline';
import { root } from '@/lib/container';
import { ExternalStore } from './external';

/** What a run is doing right now, for the list that shows it. */
export interface ReviewRunState {
  id: string;
  question: string;
  status: 'running' | 'done' | 'error';
  /** The phase the run last announced. */
  progress: string;
  error: string | null;
  /** What the run has actually done, oldest first — retrievals, model calls, failures. */
  log: string[];
  startedAt: number;
  finishedAt: number | null;
}

/** The run function; injectable so the runner can be tested without a model. */
export type ReviewRunner = typeof runReview;

/** A run that has settled, as it is reported. */
export interface SettledRun {
  id: string;
  question: string;
  status: 'done' | 'error';
  error: string | null;
  /** How many records the run screened, when it got that far. */
  records: number;
}

/**
 * Where a settled run is reported.
 *
 * A review runs while the reader is somewhere else, so the app has to be told when one comes
 * back — that is what the inbox is for. The service does not know about the inbox, and a
 * service with no listener stays silent rather than reaching into a store.
 */
export type ReviewReporter = (run: SettledRun) => void;

/** How many log lines one run keeps before the oldest fall off. */
const LOG_LINES = 200;

/** How many runs the list holds; older finished runs fall off the end. */
const RUNS_KEPT = 50;

export class ReviewRunsService {
  readonly store = new ExternalStore<ReviewRunState[]>([]);
  private readonly settled = new Map<string, Promise<void>>();

  /**
   * Where a settled run is reported.
   *
   * The app sets this at boot. A service with no listener stays silent rather than reaching
   * into a store, and a test can read what a run reported without one.
   */
  report: ReviewReporter = () => {};

  private patch(id: string, next: Partial<ReviewRunState>): void {
    this.store.update((runs) => runs.map((run) => (run.id === id ? { ...run, ...next } : run)));
  }

  /**
   * Add one line to a run's log.
   *
   * The log is what makes a background run legible: which source answered, which model call was
   * made, what came back and where it went wrong. It is echoed to the console too, so the same
   * record is in the terminal when a run is debugged from the outside.
   */
  private appendLog(id: string, message: string): void {
    const line = `${new Date().toISOString().slice(11, 19)}  ${message}`;
    console.info(`[review ${id}] ${message}`);
    this.store.update((runs) =>
      runs.map((run) => (run.id === id ? { ...run, log: [...run.log, line].slice(-LOG_LINES) } : run)),
    );
  }

  /** One run by id, or undefined. */
  find(id: string): ReviewRunState | undefined {
    return this.store.get().find((run) => run.id === id);
  }

  /** Drop a finished run from the list. */
  dismiss(id: string): void {
    this.store.update((runs) => runs.filter((run) => run.id !== id));
  }

  /** Wait for a run to settle; resolves immediately when it already has. */
  settledFor(id: string): Promise<void> {
    return this.settled.get(id) ?? Promise.resolve();
  }

  /**
   * Start a review and return at once.
   *
   * The review is on the board immediately, so it can be opened while it works; the run fills in
   * its records and then its report. `done` settles when the run has finished, whether it
   * succeeded or failed — the create page ignores it, the verification script awaits it.
   */
  start(
    state: AppState,
    inputs: ReviewInputs,
    runner: ReviewRunner = runReview,
  ): { id: string; done: Promise<void> } {
    const id = `review-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`;
    beginReview(placeholderReview(id, inputs));
    const started: ReviewRunState = {
      id,
      question: inputs.question.trim(),
      status: 'running',
      progress: 'Starting…',
      error: null,
      log: [],
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.store.update((runs) => [started, ...runs].slice(0, RUNS_KEPT));

    const done = (async () => {
      // One scope per run: the run's scratch is created here and released in `finally`, so a
      // finished run leaves nothing behind in the container.
      const scope = root.createScope();
      try {
        const buffer = scope.get('runBuffer');
        const result = await runner(state, inputs, id, (progress) => this.patch(id, { progress }), {
          onRetrieved: (papers) => addReviewRecords(id, papers),
          onLog: (message) => this.appendLog(id, message),
          seen: buffer,
        });
        finishReview(result.review, result.papers, result.content, result.meta);
        this.patch(id, { status: 'done', progress: 'Complete', finishedAt: Date.now() });
        this.report({
          id,
          question: inputs.question.trim(),
          status: 'done',
          error: null,
          // What the review says it screened, which is the number a reader expects.
          records: result.review.total,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failReview(id, message);
        this.patch(id, { status: 'error', error: message, finishedAt: Date.now() });
        this.report({
          id,
          question: inputs.question.trim(),
          status: 'error',
          error: message,
          records: 0,
        });
      } finally {
        this.settled.delete(id);
        await scope.dispose();
      }
    })();

    this.settled.set(id, done);
    return { id, done };
  }
}

/**
 * The review a run starts as, before it has retrieved anything.
 *
 * It exists from the first moment so the run can be opened and watched; the records and the
 * report are written over it as the run goes.
 */
function placeholderReview(id: string, inputs: ReviewInputs): Review {
  const sources = resolveSources(inputs.sources).map((source) => source.name);
  return {
    id,
    question: inputs.question.trim(),
    short: inputs.question.trim().slice(0, 48),
    state: 'screening',
    total: 0,
    protocol: [
      { label: 'Inclusion criteria', value: inputs.inclusion.trim() || 'Not stated yet' },
      { label: 'Exclusion criteria', value: inputs.exclusion.trim() || 'Not stated yet' },
      { label: 'Date range', value: inputs.dateRange.trim() || 'Any' },
      { label: 'Sources', value: sources.join(' · ') || 'Not chosen yet' },
      { label: 'Record limit', value: String(inputs.maxRecords) },
      { label: 'Depth', value: inputs.depth },
    ],
    lastTouched: Date.now(),
    paperIds: [],
    seed: {},
  };
}
