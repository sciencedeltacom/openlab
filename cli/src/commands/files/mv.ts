/**
 * Moving or renaming a file.
 *
 * Both ends are resolved inside the workspace, so a rename can neither reach out of it nor
 * pull a file into it. Landing on a name that is taken is refused rather than overwriting it:
 * the reader asked for a new name, not for the loss of whatever was there.
 */

import { Args } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { pathExists, renameFile } from '../../lib/host/fs';
import * as out from '../../lib/output';

export default class FilesMv extends LabCommand {
  static description = 'Move or rename a file inside the workspace';

  static args = {
    from: Args.string({ required: true, description: 'The file or folder to move' }),
    to: Args.string({ required: true, description: 'Where it goes' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(FilesMv);
    const lab = await this.requireLab();
    const root = lab.root as string;

    if (pathExists(args.to, root)) {
      this.fail(`${args.to} is already there; refusing to overwrite it.`);
    }

    renameFile(args.from, args.to, root);
    this.emit(
      { from: args.from, to: args.to },
      (value) => `${out.mark.ok} ${value.from} → ${out.c.bold(value.to)}`,
    );
  }
}
