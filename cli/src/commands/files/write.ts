/**
 * Writing a file.
 *
 * The contents come from `--content` or standard input. An existing file is kept unless
 * `--force` says otherwise: a write that silently replaced a file someone wrote would be the
 * worst kind of convenience.
 */

import { Args, Flags } from '@oclif/core';

import { formatBytes } from '@/lib/format';

import { LabCommand } from '../../lib/base';
import { pathExists, writeFile } from '../../lib/host/fs';
import * as out from '../../lib/output';

export default class FilesWrite extends LabCommand {
  static description = 'Write a file, from --content or standard input';

  static args = {
    path: Args.string({ required: true, description: 'The file to write' }),
  };

  static flags = {
    content: Flags.string({ char: 'c', description: 'The text to write' }),
    stdin: Flags.boolean({ description: 'Read the contents from standard input' }),
    force: Flags.boolean({ char: 'f', description: 'Overwrite a file that is already there' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FilesWrite);
    const lab = await this.requireLab();
    const root = lab.root as string;

    let content = flags.content;
    if (content === undefined) {
      if (!flags.stdin && process.stdin.isTTY) {
        this.fail('Nothing to write: pass --content <text>, or pipe the contents with --stdin.');
      }
      content = await Bun.stdin.text();
    }

    const existed = pathExists(args.path, root);
    if (existed && !flags.force) {
      this.fail(`${args.path} is already there; pass --force to overwrite it.`);
    }
    writeFile(args.path, content, root);

    const bytes = Buffer.byteLength(content);
    this.emit(
      { path: args.path, bytes, overwritten: existed },
      (value) =>
        `${out.mark.ok} ${existed ? 'overwrote' : 'wrote'} ${out.c.bold(value.path)} ${out.c.grey(`(${formatBytes(value.bytes)})`)}`,
    );
  }
}
