/**
 * The diff.
 *
 * `git diff` through the user's own git, capped with the app's own output cap so a broad diff
 * cannot flood the terminal. `--json` reports whether the cap was hit rather than leaving the
 * caller to guess from the text.
 */

import { Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { cap } from '../../lib/host/exec';
import { diff } from '../../lib/host/git';
import * as out from '../../lib/output';

export default class GitDiff extends LabCommand {
  static description = 'Show the diff, capped so it cannot flood the terminal';

  static flags = {
    staged: Flags.boolean({ description: 'Show the index instead of the working tree' }),
    path: Flags.string({ description: 'Limit the diff to this path; repeat for more', multiple: true }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GitDiff);
    const lab = await this.requireLab();
    const root = lab.root as string;
    const paths = flags.path ?? [];

    const raw = diff(root, flags.staged, paths);
    const text = cap(raw);

    this.emit({ staged: Boolean(flags.staged), paths, truncated: text !== raw, diff: text }, (value) =>
      value.diff.trim() === '' ? out.note('No changes.') : value.diff,
    );
  }
}
