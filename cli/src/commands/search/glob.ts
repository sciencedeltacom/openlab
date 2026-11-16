/**
 * Finding files by name.
 *
 * The app's own `glob_files`: anchored to the workspace root, skipping `.git`, `node_modules`
 * and build output, newest first. Paths come back relative to the root, which is what a person
 * (or a script) wants to act on.
 */

import { Args, Flags } from '@oclif/core';

import { formatBytes, relativeTime } from '@/lib/format';

import { LabCommand } from '../../lib/base';
import { globFiles } from '../../lib/host/search';

export default class SearchGlob extends LabCommand {
  static description = 'Find files by glob pattern, newest first';

  static args = {
    pattern: Args.string({ required: true, description: 'A glob, e.g. "**/*.md"' }),
  };

  static flags = {
    path: Flags.string({ description: 'Search under this folder, relative to the lab root' }),
    limit: Flags.integer({ description: 'Most matches to return', default: 200 }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SearchGlob);
    const lab = await this.requireLab();
    const root = lab.root as string;

    const rows = globFiles(args.pattern, root, flags.path)
      .slice(0, flags.limit)
      .map((match) => ({ path: match.relative, size: match.size, modifiedMs: match.modifiedMs }));

    this.list(
      rows,
      [
        { key: 'path', label: 'path' },
        { key: 'size', label: 'size', align: 'right', format: (row) => formatBytes(row.size) },
        { key: 'modified', label: 'modified', format: (row) => relativeTime(row.modifiedMs) },
      ],
      'No files match.',
    );
  }
}
