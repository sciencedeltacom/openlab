/**
 * One path, described.
 *
 * The size and time follow a symlink, as `stat` does; `symlink` says whether the name itself
 * is a link, which is what a reader wants to know before trusting the rest. A link out of the
 * workspace, or one that points nowhere, is refused by the same containment check a read is.
 */

import { lstatSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { Args } from '@oclif/core';

import { formatBytes, relativeTime } from '@/lib/format';

import { LabCommand } from '../../lib/base';
import { displayPath, scoped } from '../../lib/host/fs';
import * as out from '../../lib/output';

export default class FilesStat extends LabCommand {
  static description = 'Show a path’s size, type and modified time';

  static args = {
    path: Args.string({ required: true, description: 'The file or folder to describe' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(FilesStat);
    const lab = await this.requireLab();
    const root = lab.root as string;

    // `scoped` proves the path stays inside the workspace. The lexical path is kept so a
    // symlink is reported as a link, rather than as whatever it points at.
    scoped(args.path, root);
    const target = isAbsolute(args.path) ? args.path : resolve(root, args.path);
    const symlink = lstatSync(target).isSymbolicLink();

    const stats = statSync(target);
    const isDir = stats.isDirectory();
    const size = isDir ? 0 : stats.size;
    const modifiedMs = Math.floor(stats.mtimeMs);

    const value = {
      path: displayPath(target, root),
      type: isDir ? 'directory' : 'file',
      size,
      modifiedMs,
      symlink,
    };
    this.record(value, [
      ['path', value.path],
      ['type', value.type],
      ['size', isDir ? out.c.grey('—') : formatBytes(size)],
      ['modified', `${relativeTime(modifiedMs)}  ${out.c.grey(new Date(modifiedMs).toISOString())}`],
      ['symlink', symlink ? out.mark.ok : out.c.grey('no')],
    ]);
  }
}
