/**
 * Change a job's record.
 *
 * The app's ledger patches a job in place (`job/patch`), and this is the same patch: a state
 * move, a note kept in the state history, and the artifacts the run read or wrote. Nothing here
 * runs anything — it records what a reader knows, which is why every change leaves an event.
 */

import { Args, Flags } from '@oclif/core';

import type { Artifact, JobState } from '@/store/compute';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** Where a run is in its life, as `JobState` names them. */
const JOB_STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;

/** One artifact from `ref` or `ref=note`. */
function parseArtifact(value: string): Artifact {
  const separator = value.indexOf('=');
  if (separator === -1) {
    return { ref: value.trim() };
  }
  return { ref: value.slice(0, separator).trim(), note: value.slice(separator + 1).trim() || undefined };
}

export default class ComputeJobsUpdate extends LabCommand {
  static description = 'Patch a job: its state, a note in its history, or the artifacts it read and wrote';

  static args = { id: Args.string({ description: 'The job id', required: true }) };

  static flags = {
    state: Flags.string({ description: 'Move the job to this state', options: [...JOB_STATES] }),
    note: Flags.string({ description: 'Leave a note on the job, kept in its state history' }),
    objective: Flags.string({ description: 'Replace the job’s objective line' }),
    error: Flags.string({ description: 'Record why the run failed' }),
    input: Flags.string({
      description: 'Attach an input, as `ref` or `ref=note`; repeat for more',
      multiple: true,
    }),
    output: Flags.string({
      description: 'Attach an output, as `ref` or `ref=note`; repeat for more',
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ComputeJobsUpdate);
    const lab = await this.requireLab();
    const job = lab.state.jobs.find((candidate) => candidate.id === args.id);
    if (!job) {
      this.fail(`No job ${args.id}. See \`openlab compute jobs list\`.`);
    }

    const inputs = (flags.input ?? []).map(parseArtifact);
    const outputs = (flags.output ?? []).map(parseArtifact);
    const changes = [
      flags.state !== undefined,
      flags.note !== undefined,
      flags.objective !== undefined,
      flags.error !== undefined,
      inputs.length > 0,
      outputs.length > 0,
    ].filter(Boolean).length;
    if (changes === 0) {
      this.fail('Nothing to change. Pass --state, --note, --objective, --error, --input or --output.');
    }

    const next = flags.state as JobState | undefined;
    const patch: Partial<typeof job> = {};
    if (next) patch.state = next;
    if (flags.objective !== undefined) patch.objective = flags.objective;
    if (flags.error !== undefined) patch.error = flags.error;
    if (inputs.length > 0) patch.inputs = [...job.inputs, ...inputs];
    if (outputs.length > 0) patch.outputs = [...job.outputs, ...outputs];
    // A state move and a note both belong in the history, so the ledger keeps the order of
    // what was claimed rather than only the latest claim.
    if (next || flags.note !== undefined) {
      patch.history = [
        ...job.history,
        { at: 'just now', state: next ?? job.state, ...(flags.note ? { note: flags.note } : {}) },
      ];
    }

    Object.assign(job, patch);
    await lab.save();

    this.emit(job, (updated) =>
      [
        `${out.mark.ok} Updated ${out.c.bold(updated.id)}`,
        out.keyValues([
          ['state', updated.state],
          ['inputs', String(updated.inputs.length)],
          ['outputs', String(updated.outputs.length)],
          ['events', String(updated.history.length)],
        ]),
      ].join('\n'),
    );
  }
}
