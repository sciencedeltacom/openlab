/**
 * Unstaging paths.
 *
 * `git restore --staged -- <paths>`, the same call the Git panel makes: the index entry goes
 * back to HEAD, and the working tree is left as it was.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { unstage } from '../../lib/host/git';
import * as out from '../../lib/output';

export default class GitUnstage extends LabCommand {
  static description = 'Unstage paths, or everything with --all';

  static args = {
    paths: Args.string({ required: false, multiple: true, description: 'The paths to unstage' }),
  };

  static flags = {
    all: Flags.boolean({ char: 'a', description: 'Unstage every staged change' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GitUnstage);
    const lab = await this.requireLab();
    const root = lab.root as string;
    const paths = args.paths ?? [];

    if (paths.length === 0 && !flags.all) {
      this.fail('Nothing to unstage: name paths, or pass --all.');
    }

    unstage(root, flags.all ? ['.'] : paths);
    this.emit({ all: Boolean(flags.all), paths: flags.all ? [] : paths }, (value) =>
      value.all
        ? `${out.mark.ok} unstaged every change`
        : `${out.mark.ok} unstaged ${value.paths.length} path${value.paths.length === 1 ? '' : 's'}`,
    );
  }
}
