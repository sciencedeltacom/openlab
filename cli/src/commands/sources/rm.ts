/**
 * Removing a source from the workspace catalogue.
 *
 * A source is the question a review searches with, so removing one is the only way to stop a
 * review from asking it. `--yes` is required: a source can be the only record of how a search
 * was framed, and there is no undo.
 */

import { Args, Flags } from '@oclif/core';

import { findSource, removeSource } from '@/lib/catalog/sources';

import { LabCommand } from '../../lib/base';

export default class SourcesRm extends LabCommand {
  static description = 'Remove a source from the workspace catalogue';

  static args = {
    id: Args.string({ description: 'The source id', required: true }),
  };

  static flags = {
    yes: Flags.boolean({ description: 'Confirm the removal', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SourcesRm);
    const lab = await this.lab();

    const source = findSource(args.id);
    if (!source) {
      this.fail(`No source “${args.id}”. See \`openlab sources list\`.`);
    }
    if (!flags.yes) {
      this.fail(`Removing “${source.name}” cannot be undone. Pass --yes to confirm.`);
    }

    removeSource(source.id);
    await lab.save();
    this.done(`${source.name} removed.`);
  }
}
