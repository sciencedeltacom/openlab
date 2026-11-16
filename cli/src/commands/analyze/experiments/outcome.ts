/**
 * Record how an experiment ended.
 *
 * `setOutcome` writes the outcome and its summary and settles a running experiment. The lesson is
 * a separate field on the record, so it is patched in after — one call each, the way the store
 * exposes them.
 */

import { Args, Flags } from '@oclif/core';

import { OUTCOMES, type ExperimentOutcome as Outcome } from '@/components/experiments/experiments';
import { experimentById, patchExperiment, setOutcome } from '@/components/experiments/store';

import { LabCommand } from '../../../lib/base';

export default class ExperimentOutcome extends LabCommand {
  static description = 'Record an experiment’s outcome and its lesson';

  static args = {
    id: Args.string({ required: true, description: 'The experiment id' }),
  };

  static flags = {
    outcome: Flags.string({
      required: true,
      options: OUTCOMES,
      description: 'How the experiment ended',
    }),
    summary: Flags.string({ description: 'What the outcome rests on' }),
    lesson: Flags.string({ description: 'What the experiment taught' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExperimentOutcome);
    const lab = await this.lab();

    if (!setOutcome(args.id, flags.outcome as Outcome, flags.summary)) {
      this.fail(`No experiment ${args.id}. See \`openlab analyze experiments list\`.`);
    }
    if (flags.lesson !== undefined) {
      patchExperiment(args.id, { lesson: flags.lesson });
    }
    await lab.save();

    const experiment = experimentById(args.id);
    if (!experiment) {
      this.fail(`No experiment ${args.id}.`);
    }
    this.record(experiment, [
      ['id', experiment.id],
      ['outcome', experiment.outcome],
      ['stage', experiment.stage],
      ['summary', experiment.outcomeSummary],
      ['lesson', experiment.lesson],
    ]);
  }
}
