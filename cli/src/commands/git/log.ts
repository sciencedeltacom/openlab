/**
 * Recent commits.
 *
 * `git log` through the user's own git, one line per commit: short hash, date, author, subject.
 */

import { Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { log } from '../../lib/host/git';

export default class GitLog extends LabCommand {
  static description = 'Show recent commits';

  static flags = {
    limit: Flags.integer({ char: 'n', description: 'How many commits to show', default: 20 }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GitLog);
    const lab = await this.requireLab();
    const root = lab.root as string;

    this.list(
      log(root, flags.limit),
      [
        { key: 'hash', label: 'hash' },
        { key: 'date', label: 'date' },
        { key: 'author', label: 'author' },
        { key: 'subject', label: 'subject', width: 60, truncate: true },
      ],
      'No commits yet.',
    );
  }
}
