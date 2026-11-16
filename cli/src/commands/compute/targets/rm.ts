/**
 * Remove a target.
 *
 * The target's jobs stay in the ledger — a run that happened is a fact, and its row already
 * shows the target id it names. Removing a machine is destructive, so it asks first.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../../lib/base';

export default class ComputeTargetsRm extends LabCommand {
  static description = 'Remove a compute target';

  static args = { id: Args.string({ description: 'The target id or name', required: true }) };

  static flags = {
    yes: Flags.boolean({ description: 'Confirm the removal' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ComputeTargetsRm);
    const lab = await this.requireLab();
    const target = lab.state.targets.find(
      (candidate) => candidate.id === args.id || candidate.name.toLowerCase() === args.id.toLowerCase(),
    );
    if (!target) {
      this.fail(`No target “${args.id}”. See \`openlab compute targets list\`.`);
    }
    if (!flags.yes) {
      this.fail(`Removing “${target.name}” is permanent. Pass --yes to confirm.`);
    }

    lab.state.targets = lab.state.targets.filter((candidate) => candidate.id !== target.id);
    await lab.save();
    this.emit({ id: target.id, name: target.name }, () => `Removed ${target.id} “${target.name}”.`);
  }
}
