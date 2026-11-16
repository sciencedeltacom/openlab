/**
 * Staging paths.
 *
 * The same `git add -- <paths>` the app's Git panel issues. `--all` stages the working tree
 * from the lab root down, which is the repository's whole tree when the lab is its root.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { stage } from '../../lib/host/git';
import * as out from '../../lib/output';

export default class GitStage extends LabCommand {
  static description = 'Stage paths, or everything with --all';

  static args = {
    paths: Args.string({ required: false, multiple: true, description: 'The paths to stage' }),
  };

  static flags = {
    all: Flags.boolean({ char: 'a', description: 'Stage every change in the workspace' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GitStage);
    const lab = await this.requireLab();
    const root = lab.root as string;
    const paths = args.paths ?? [];

    if (paths.length === 0 && !flags.all) {
      this.fail('Nothing to stage: name paths, or pass --all.');
    }

    stage(root, flags.all ? ['.'] : paths);
    this.emit({ all: Boolean(flags.all), paths: flags.all ? [] : paths }, (value) =>
      value.all
        ? `${out.mark.ok} staged every change`
        : `${out.mark.ok} staged ${value.paths.length} path${value.paths.length === 1 ? '' : 's'}`,
    );
  }
}
