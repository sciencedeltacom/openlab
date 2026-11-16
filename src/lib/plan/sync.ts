/**
 * Loading a workspace's plan.
 *
 * The seam between the files and the store: read the plan from disk, decide what it is
 * asking for with {@link planMerge}, and hand the answer to the store. The shell supplies
 * the sink, so this module knows nothing about dispatch and the merge rules stay testable
 * without one.
 *
 * A read that finds nothing still marks the root as read. That is what lets the first export
 * write the plan for a folder that has never had one — and what stops an export racing ahead
 * of the read on a folder that has.
 */

import { isDesktop } from '@/lib/ipc';
import type { ToastTone } from '@/lib/toast';
import type { Task, Wave } from '@/store/research';
import { planWasRead, readPlan, type PlanSource } from './files';
import { mergeIsEmpty, planMerge } from './merge';

/** What the loader is allowed to do to the store. */
export interface PlanSink {
  /** The workspace as it stands, read at the moment of the merge. */
  source(): PlanSource;
  createWave(wave: Wave): void;
  patchWave(id: string, patch: Partial<Wave>): void;
  patchTask(id: string, patch: Partial<Task>): void;
  /** A line about what the files asked for, for the person who just opened the folder. */
  report?(message: string, tone: ToastTone): void;
}

/** What a load did, so a caller can say so. */
export interface PlanLoad {
  created: number;
  edited: number;
  /** Files that changed since openlab wrote them — a colleague's commit, or an edit. */
  foreign: string[];
  unknown: string[];
  problems: string[];
}

/**
 * Read a workspace's plan and apply it.
 *
 * Called once per open, from the shell. Everything it does is a consequence of a file that
 * differs from what openlab last wrote, so a workspace nobody else touched costs one glob
 * and no writes.
 */
export async function loadWorkspacePlan(root: string, sink: PlanSink): Promise<PlanLoad> {
  const empty: PlanLoad = { created: 0, edited: 0, foreign: [], unknown: [], problems: [] };
  if (!isDesktop() || !root) return empty;

  const read = await readPlan(root);
  // From here on the plan may be written: whatever was on disk has been read.
  planWasRead(root);
  if (!read) return empty;

  const source = sink.source();
  const merge = planMerge({
    files: read.waves,
    backlog: read.backlog,
    waves: source.waves,
    tasks: source.tasks,
    members: source.members,
  });

  if (!mergeIsEmpty(merge)) {
    for (const { wave } of merge.created) sink.createWave(wave);
    for (const edit of merge.waves) sink.patchWave(edit.id, edit.patch);
    for (const edit of merge.tasks) sink.patchTask(edit.id, { ...edit.patch, updatedAt: Date.now() });
  }

  const load: PlanLoad = {
    created: merge.created.length,
    edited: merge.waves.length + merge.tasks.length,
    foreign: read.foreign,
    unknown: merge.unknown.map((entry) => entry.key),
    problems: read.problems,
  };

  // Only speak when a file asked for something: opening a folder should be quiet.
  if (load.created > 0 || load.edited > 0) {
    const parts = [
      ...(load.created > 0 ? [`${load.created} new wave${load.created === 1 ? '' : 's'}`] : []),
      ...(load.edited > 0 ? [`${load.edited} change${load.edited === 1 ? '' : 's'}`] : []),
    ];
    sink.report?.(`Plan read from the repository: ${parts.join(', ')}.`, 'success');
  }
  if (load.foreign.length > 0) {
    sink.report?.(
      `${load.foreign.length} plan file${load.foreign.length === 1 ? '' : 's'} changed since openlab last wrote ${
        load.foreign.length === 1 ? 'it' : 'them'
      }.`,
      'default',
    );
  }
  if (load.unknown.length > 0) {
    sink.report?.(
      `The plan names ${load.unknown.join(', ')}, which this workspace does not have.`,
      'warning',
    );
  }
  for (const problem of load.problems) sink.report?.(`Plan file not read: ${problem}`, 'warning');

  return load;
}
