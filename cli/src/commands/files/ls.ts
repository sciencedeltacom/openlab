/**
 * A folder in the workspace.
 *
 * The listing is the app's own `list_dir`: directories first, then by name, and a symlink's
 * own size rather than the size of what it points at. Dotfiles stay hidden unless `--all`,
 * the way every other listing behaves.
 */

import { Args, Flags } from '@oclif/core';

import { formatBytes, relativeTime } from '@/lib/format';

import { LabCommand } from '../../lib/base';
import { listDir, type DirEntry } from '../../lib/host/fs';
import * as out from '../../lib/output';

/** One row, as the table and the JSON both read it. */
interface Row {
  name: string;
  type: 'dir' | 'file' | 'symlink';
  size: number;
  modifiedMs: number | null;
}

/** One entry as a row. */
function row(entry: DirEntry): Row {
  return {
    name: entry.name,
    type: entry.isSymlink ? 'symlink' : entry.isDir ? 'dir' : 'file',
    size: entry.isDir ? 0 : entry.size,
    modifiedMs: entry.modifiedMs,
  };
}

export default class FilesLs extends LabCommand {
  static description = 'List a folder in the workspace';

  static args = {
    path: Args.string({ description: 'The folder to list (default: the lab root)' }),
  };

  static flags = {
    all: Flags.boolean({ char: 'a', description: 'Include dotfiles' }),
    long: Flags.boolean({ char: 'l', description: 'Show size and modified time' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FilesLs);
    const lab = await this.requireLab();
    const root = lab.root as string;
    const path = args.path ?? '.';

    const rows = listDir(path, root)
      .filter((entry) => flags.all || !entry.name.startsWith('.'))
      .map((entry) => row(entry));

    const columns: out.Column<Row>[] = [
      {
        key: 'name',
        label: 'name',
        format: (value) => (value.type === 'dir' ? out.c.bold(`${value.name}/`) : value.name),
      },
    ];
    if (flags.long) {
      columns.push({
        key: 'size',
        label: 'size',
        align: 'right',
        format: (value) => (value.type === 'dir' ? out.c.grey('—') : formatBytes(value.size)),
      });
      columns.push({
        key: 'modified',
        label: 'modified',
        format: (value) => (value.modifiedMs === null ? out.c.grey('—') : relativeTime(value.modifiedMs)),
      });
    }

    if (!this.json) {
      this.log(out.heading(path));
    }
    this.list(rows, columns, 'Empty.');
  }
}
