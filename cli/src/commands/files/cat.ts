/**
 * A file's text.
 *
 * `--lines a:b` slices, 1-based and inclusive, the way an editor counts lines. The read goes
 * through the workspace reader, so the 8 MB cap and the containment check are the app's.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { readFile } from '../../lib/host/fs';

export default class FilesCat extends LabCommand {
  static description = 'Print a file’s text';

  static args = {
    path: Args.string({ required: true, description: 'The file to print' }),
  };

  static flags = {
    lines: Flags.string({ char: 'l', description: 'Only these lines, as start:end (1-based, inclusive)' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FilesCat);
    const lab = await this.requireLab();
    const root = lab.root as string;

    const all = readFile(args.path, root).split('\n');
    const { from, to } = this.slice(flags.lines, all.length);
    const text = all.slice(from - 1, to).join('\n');

    this.emit({ path: args.path, from, to, total: all.length, text }, (value) => {
      // Written straight through, so a pipe gets the file's own bytes and no extra newline.
      process.stdout.write(value.text);
      return '';
    });
  }

  /** Turn `a:b` into a clamped, 1-based, inclusive range. */
  private slice(spec: string | undefined, total: number): { from: number; to: number } {
    if (!spec) {
      return { from: 1, to: total };
    }
    const [start, end] = spec.split(':');
    if (start === undefined || end === undefined) {
      this.fail('--lines takes start:end, e.g. 10:20.');
    }
    const from = start.trim() === '' ? 1 : Number(start);
    const to = end.trim() === '' ? total : Number(end);
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      this.fail('--lines takes whole numbers, e.g. 10:20.');
    }
    return { from: Math.max(1, from), to: Math.min(total, to) };
  }
}
