/**
 * Removing a file or folder.
 *
 * Recursive, so `--yes` is required: the command is the same one that would take a directory
 * and everything under it. A path that is already gone is reported, not failed — absent is the
 * state the caller asked for.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { pathExists, removeFile } from '../../lib/host/fs';
import * as out from '../../lib/output';

export default class FilesRm extends LabCommand {
  static description = 'Remove a file or folder, and everything under it';

  static args = {
    path: Args.string({ required: true, description: 'The file or folder to remove' }),
  };

  static flags = {
    yes: Flags.boolean({ char: 'y', description: 'Confirm the removal' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FilesRm);
    const lab = await this.requireLab();
    const root = lab.root as string;

    if (!flags.yes) {
      this.fail(`refusing to remove ${args.path} without --yes.`);
    }

    const existed = pathExists(args.path, root);
    if (existed) {
      removeFile(args.path, root);
    }

    this.emit({ path: args.path, removed: existed }, (value) =>
      value.removed
        ? `${out.mark.ok} removed ${out.c.bold(value.path)}`
        : `${out.mark.skip} ${value.path} was not there`,
    );
  }
}
