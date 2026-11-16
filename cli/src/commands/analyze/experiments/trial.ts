/**
 * Log one trial of an experiment.
 *
 * `logTrial` appends the run and marks the experiment running. The run label, the condition and
 * the free-text result mirror the agent's `experiment_log_trial`; `--metric name=value` is the
 * structured measurement the app's domain fields read, and the first pair also names the trial's
 * metric and result so a bare log still reads.
 */

import { Args, Flags } from '@oclif/core';

import type { Trial, TrialMetric, TrialStatus } from '@/components/experiments/experiments';
import { logTrial } from '@/components/experiments/store';

import { LabCommand } from '../../../lib/base';

const TRIAL_STATUSES: TrialStatus[] = ['planned', 'running', 'done', 'failed', 'excluded'];

/** `name=value`, the way `--metric` is written. */
function parseMetric(raw: string): TrialMetric {
  const eq = raw.indexOf('=');
  if (eq <= 0) {
    throw new Error(`--metric expects name=value, not “${raw}”`);
  }
  return { name: raw.slice(0, eq).trim(), value: raw.slice(eq + 1).trim() };
}

/** An ISO date or epoch-ms, as epoch ms. */
function instant(raw: string): number {
  const parsed = /^\d+$/.test(raw.trim()) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`“${raw}” is not a date or an epoch in milliseconds`);
  }
  return parsed;
}

/** A seed that looks like a number is kept as one, so the domain's number field reads it. */
function seedValue(raw: string): number | string {
  const parsed = Number(raw);
  return raw.trim() !== '' && Number.isFinite(parsed) ? parsed : raw;
}

export default class ExperimentTrial extends LabCommand {
  static description = 'Log a trial on an experiment';

  static args = {
    id: Args.string({ required: true, description: 'The experiment id' }),
  };

  static flags = {
    run: Flags.string({ description: 'The run label, e.g. T3 (default: T<n>)' }),
    condition: Flags.string({ description: 'What was varied in this run' }),
    metric: Flags.string({ description: 'A measurement, name=value; repeat for more', multiple: true }),
    result: Flags.string({ description: 'What came back, as free text' }),
    status: Flags.string({ description: 'How the run went', options: TRIAL_STATUSES }),
    note: Flags.string({ description: 'A note on the run' }),
    seed: Flags.string({ description: 'The random seed for this run' }),
    started: Flags.string({ description: 'When it started, as an ISO date or epoch ms' }),
    ended: Flags.string({ description: 'When it ended, as an ISO date or epoch ms' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExperimentTrial);
    const lab = await this.lab();

    let metrics: TrialMetric[];
    let startedAt: number | undefined;
    let endedAt: number | undefined;
    try {
      metrics = (flags.metric ?? []).map(parseMetric);
      startedAt = flags.started ? instant(flags.started) : undefined;
      endedAt = flags.ended ? instant(flags.ended) : undefined;
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }

    const trial: Trial = {
      run: flags.run ?? `T${Date.now() % 1000}`,
      condition: flags.condition ?? '',
      metric: metrics[0]?.name ?? '',
      result: flags.result ?? metrics[0]?.value ?? '',
      ...(flags.status ? { status: flags.status as TrialStatus } : {}),
      ...(metrics.length > 0 ? { metrics } : {}),
      ...(flags.seed !== undefined ? { params: { seed: seedValue(flags.seed) } } : {}),
      ...(flags.note ? { note: flags.note } : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(endedAt !== undefined ? { endedAt } : {}),
    };

    if (!logTrial(args.id, trial)) {
      this.fail(`No experiment ${args.id}. See \`openlab analyze experiments list\`.`);
    }
    await lab.save();

    this.record(trial, [
      ['run', trial.run],
      ['condition', trial.condition],
      ['metric', trial.metric],
      ['result', trial.result],
      ['status', trial.status],
      ['metrics', trial.metrics ? String(trial.metrics.length) : undefined],
      ['seed', trial.params ? String(trial.params.seed ?? '') : undefined],
      ['started', trial.startedAt ? new Date(trial.startedAt).toISOString() : undefined],
      ['ended', trial.endedAt ? new Date(trial.endedAt).toISOString() : undefined],
      ['note', trial.note],
    ]);
  }
}
