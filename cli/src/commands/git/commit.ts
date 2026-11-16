/**
 * Committing.
 *
 * The app's own commit: `--all` stages everything first, then the message, then the short hash
 * of the new commit is printed — the same value the Git panel shows after a commit.
 */

import { Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { commit } from '../../lib/host/git';
import * as out from '../../lib/output';

export default class GitCommit extends LabCommand {
  static description = 'Commit the index and print the short hash';

  static flags = {
    message: Flags.string({ char: 'm', required: true, description: 'The commit message' }),
    all: Flags.boolean({ char: 'a', description: 'Stage every change first' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GitCommit);
    const lab = await this.requireLab();
    const root = lab.root as string;

    const hash = commit(root, flags.message, flags.all);
    this.emit(
      { hash, message: flags.message.trim(), all: Boolean(flags.all) },
      (value) => `${out.mark.ok} ${out.c.bold(value.hash)} ${out.c.grey(value.message)}`,
    );
  }
}
