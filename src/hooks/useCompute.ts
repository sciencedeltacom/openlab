/**
 * The compute records, with the store's own verbs.
 *
 * Targets and jobs are workspace state now, so the views that edit them speak to the store
 * rather than to a local copy. The shape is the same as `useLocalEdits`, so a list does not
 * care that its records became durable.
 */

import { useCallback, useMemo, useState } from 'react';

import { notify } from '@/lib/toast';
import { useApp } from '@/store/app';
import { activeProject } from '@/store/types';
import type { Job, Target } from '@/store/compute';
import { checkTarget, logLines, runJobOnTarget, type TargetCheck } from '@/lib/compute/run';
import { newInboxEntry } from '@/store/research';
import { formatDuration } from '@/lib/format';
import type { LocalEdits } from '@/hooks/useLocalEdits';

/** The target list, backed by the store. */
export function useTargets(): LocalEdits<Target> {
  const { state, dispatch } = useApp();
  return useMemo(
    () => ({
      items: state.targets,
      add: (item, label) => {
        dispatch({ type: 'target/create', target: item });
        notify(`Added “${label ?? item.name}”`, { tone: 'success' });
      },
      patch: (key, changes, message) => {
        dispatch({ type: 'target/patch', id: key, patch: changes });
        notify(message ?? 'Updated target', { tone: 'success' });
      },
      rename: (key, name, label) => {
        dispatch({ type: 'target/patch', id: key, patch: { name } });
        notify(`Renamed ${label ?? 'target'} to “${name}”`, { tone: 'success' });
      },
      remove: (key, label) => {
        dispatch({ type: 'target/remove', id: key });
        notify(`Removed ${label ?? 'target'}`, { tone: 'success' });
      },
    }),
    [state.targets, dispatch],
  );
}

/** The job ledger, backed by the store. */
export function useJobs(): LocalEdits<Job> {
  const { state, dispatch } = useApp();
  return useMemo(
    () => ({
      items: state.jobs,
      add: (item, label) => {
        dispatch({ type: 'job/create', job: item });
        notify(`Queued “${label ?? item.name}”`, { tone: 'success' });
      },
      patch: (key, changes, message) => {
        dispatch({ type: 'job/patch', id: key, patch: changes });
        notify(message ?? 'Updated job', { tone: 'success' });
      },
      rename: (key, name, label) => {
        dispatch({ type: 'job/patch', id: key, patch: { name } });
        notify(`Renamed ${label ?? 'job'} to “${name}”`, { tone: 'success' });
      },
      remove: (key, label) => {
        dispatch({ type: 'job/remove', id: key });
        notify(`Removed ${label ?? 'job'}`, { tone: 'success' });
      },
    }),
    [state.jobs, dispatch],
  );
}

/** The first line of output that says something. */
function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && line !== '(no output)')
      ?.slice(0, 160) ?? 'no output'
  );
}

/**
 * Checking a target, from any screen that shows one.
 *
 * The check runs the adapter's probe for real and writes what came back into the record, so
 * the card, the page and the list all read the same last-known state. A target with no
 * workspace, or one whose probe failed, records that failure rather than a silence.
 */
export function useTargetCheck(): {
  check: (target: Target) => Promise<TargetCheck | null>;
  busyId: string | null;
} {
  const { state, dispatch } = useApp();
  const [busyId, setBusyId] = useState<string | null>(null);

  const check = useCallback(
    async (target: Target): Promise<TargetCheck | null> => {
      const root = activeProject(state)?.path;
      setBusyId(target.id);
      try {
        if (!root) {
          const detail = 'Open a workspace before checking a target.';
          dispatch({
            type: 'target/patch',
            id: target.id,
            patch: {
              readiness: 'needs-setup',
              needs: [detail],
              check: { at: 'just now', tone: 'warning', detail },
            },
          });
          notify(detail, { tone: 'warning' });
          return null;
        }
        const result = await checkTarget(target, root);
        dispatch({
          type: 'target/patch',
          id: target.id,
          patch: {
            readiness: result.ok ? 'ready' : result.tone === 'warning' ? 'needs-setup' : 'offline',
            needs: result.ok ? [] : [result.detail],
            check: { at: 'just now', tone: result.tone, detail: result.detail },
          },
        });
        notify(result.ok ? `${target.name} answered` : `${target.name}: ${result.detail}`, {
          tone: result.ok ? 'success' : 'danger',
        });
        return result;
      } finally {
        setBusyId(null);
      }
    },
    [state, dispatch],
  );

  return { check, busyId };
}

/**
 * Running a job on its target.
 *
 * The job is written to the ledger as running, the adapter's command is sent, and the ledger
 * keeps what came back: the exit code, the log tail and, on a failure, the first line that
 * says why. A scheduler that prints a job id keeps that line; a command that fails keeps its
 * own error text.
 */
export function useJobRunner(): {
  /**
   * Run a job. `known` is the target as the caller already holds it — a target created and
   * submitted in the same press is not in the store's state yet, and a run that could not
   * find its own target would fail for the wrong reason.
   */
  run: (job: Job, known?: Target) => Promise<boolean>;
  busyId: string | null;
} {
  const { state, dispatch } = useApp();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = useCallback(
    async (job: Job, known?: Target): Promise<boolean> => {
      const target = known ?? state.targets.find((candidate) => candidate.id === job.targetId);
      const root = activeProject(state)?.path;
      /**
       * Record a failure, and file it.
       *
       * A run that failed while the reader was elsewhere is exactly what the inbox is for: the
       * row carries the reason and, when the run was made for a task, links to it.
       */
      const fail = (error: string) => {
        dispatch({
          type: 'job/patch',
          id: job.id,
          patch: {
            state: 'failed',
            error,
            logTail: [error],
            history: [...job.history, { at: 'just now', state: 'failed', note: error }],
          },
        });
        const task = state.tasks.find((candidate) => job.taskKeys.includes(candidate.key));
        dispatch({
          type: 'inbox/add',
          entry: newInboxEntry({
            kind: 'run-failed',
            body: `The run “${job.name}” failed${target ? ` on ${target.name}` : ''}: ${error}`,
            taskId: task?.id ?? null,
          }),
        });
        notify(`“${job.name}” failed: ${error}`, { tone: 'danger' });
      };

      if (!target) {
        fail('the job names a target that no longer exists');
        return false;
      }
      if (!root) {
        fail('no workspace is open');
        return false;
      }

      const startedAt = Date.now();
      setBusyId(job.id);
      dispatch({
        type: 'job/patch',
        id: job.id,
        patch: {
          state: 'running',
          startedMinutesAgo: 0,
          history: [...job.history, { at: 'just now', state: 'running', note: target.name }],
        },
      });

      try {
        const result = await runJobOnTarget(target, job, root);
        const lines = [`$ ${result.command}`, ...logLines(result.output)];
        dispatch({
          type: 'job/patch',
          id: job.id,
          patch: {
            state: result.ok ? 'succeeded' : 'failed',
            duration: formatDuration(Date.now() - startedAt),
            error: result.ok ? undefined : firstLine(result.output),
            logTail: lines,
            history: [
              ...job.history,
              { at: 'just now', state: 'running', note: target.name },
              {
                at: 'just now',
                state: result.ok ? 'succeeded' : 'failed',
                note: `exit ${result.exitCode}`,
              },
            ],
          },
        });
        if (result.ok) {
          notify(`“${job.name}” submitted to ${target.name}`, { tone: 'success' });
          return true;
        }
        // A submission that reached the machine and came back non-zero is a failure like any
        // other, so it is filed the same way.
        const reason = firstLine(result.output);
        const task = state.tasks.find((candidate) => job.taskKeys.includes(candidate.key));
        dispatch({
          type: 'inbox/add',
          entry: newInboxEntry({
            kind: 'run-failed',
            body: `The run “${job.name}” failed on ${target.name} (exit ${result.exitCode}): ${reason}`,
            taskId: task?.id ?? null,
          }),
        });
        notify(`“${job.name}” failed on ${target.name}`, { tone: 'danger' });
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [state, dispatch],
  );

  return { run, busyId };
}
