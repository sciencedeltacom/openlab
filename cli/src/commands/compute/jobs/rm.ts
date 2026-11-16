/**
 * Remove a job from the ledger.
 *
 * A ledger keeps cancelled and failed runs on purpose — a run that was stopped is a decision —
 * so removing one is destructive and asks first. The run's log file, if one was written, is
 * left where it is.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../../lib/base';

export default class ComputeJobsRm extends LabCommand {
  static description = 'Remove a job from the ledger';

  static args = { id: Args.string({ description: 'The job id', required: true }) };

  static flags = {
    yes: Flags.boolean({ description: 'Confirm the removal' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ComputeJobsRm);
    const lab = await this.requireLab();
    const job = lab.state.jobs.find((candidate) => candidate.id === args.id);
    if (!job) {
      this.fail(`No job ${args.id}. See \`openlab compute jobs list\`.`);
    }
    if (!flags.yes) {
      this.fail(`Removing “${job.name}” is permanent. Pass --yes to confirm.`);
    }

    lab.state.jobs = lab.state.jobs.filter((candidate) => candidate.id !== job.id);
    await lab.save();
    this.emit({ id: job.id, name: job.name }, () => `Removed ${job.id} “${job.name}”.`);
  }
}
