/**
 * Remove an experiment.
 *
 * A removal is not undoable from here, so it asks for `--yes` rather than doing it on a typo.
 */

import { Args, Flags } from '@oclif/core';

import { experimentById, removeExperiment } from '@/components/experiments/store';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

export default class ExperimentRemove extends LabCommand {
  static description = 'Remove an experiment from the ledger';

  static args = {
    id: Args.string({ required: true, description: 'The experiment id' }),
  };

  static flags = {
    yes: Flags.boolean({ char: 'y', description: 'Confirm the removal' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExperimentRemove);
    const lab = await this.lab();

    if (!experimentById(args.id)) {
      this.fail(`No experiment ${args.id}. See \`openlab analyze experiments list\`.`);
    }
    if (!flags.yes) {
      this.fail(`Refusing to remove ${args.id} without --yes.`);
    }

    removeExperiment(args.id);
    await lab.save();

    this.emit({ id: args.id, removed: true }, (value) => `${out.mark.ok} removed ${out.c.bold(value.id)}`);
  }
}
