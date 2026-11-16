/**
 * Making a folder a lab.
 *
 * The same three writes the app's "Create a workspace" flow makes: the standard structure, a
 * starter OpenWiki, and the `.labconfig` manifest. The folder is then registered as a project,
 * so the app opens it with everything the CLI put there. Nothing is overwritten — a folder
 * that already has a file keeps it.
 */

import { mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { Args, Flags } from '@oclif/core';

import { starterPages } from '@/lib/knowledge/init';
import { PROTOCOL_PRESETS } from '@/lib/workspace-config';
import { PROJECT_FOLDERS, PROJECT_FILES, scaffoldFiles } from '@/lib/workspace-project';

import { LabCommand } from '../lib/base';
import { init as gitInit } from '../lib/host/git';
import * as out from '../lib/output';
import { shortPath } from '../lib/paths';
import { defaultLabConfig, writeLabConfig, writeLabFiles } from '../lib/workspace';

export default class Init extends LabCommand {
  static description = 'Create a lab in a folder: its structure, its wiki and its manifest';

  static args = {
    dir: Args.string({ description: 'The folder to make a lab (default: the working directory)' }),
  };

  static flags = {
    name: Flags.string({ char: 'n', description: 'The lab’s name (default: the folder name)' }),
    structure: Flags.boolean({ description: 'Lay out the standard folders', default: true, allowNo: true }),
    wiki: Flags.boolean({ description: 'Write the starter OpenWiki', default: true, allowNo: true }),
    git: Flags.boolean({ description: 'Initialise a git repository' }),
    protocol: Flags.string({
      description: 'A protocol to work under; repeat for more',
      multiple: true,
      options: PROTOCOL_PRESETS.map((protocol) => protocol.id),
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);
    const root = resolve(args.dir ?? process.cwd());
    const name = flags.name?.trim() || basename(root) || 'lab';

    mkdirSync(root, { recursive: true });

    // Every file a fresh lab is made of, then the ones that are already there are left alone.
    const files = new Map<string, string>();
    if (flags.structure) {
      for (const [path, contents] of scaffoldFiles(name)) {
        files.set(path, contents);
      }
    }
    if (flags.wiki) {
      for (const [path, contents] of Object.entries(starterPages(name))) {
        files.set(path, contents);
      }
    }
    const { written, skipped } = writeLabFiles(root, files);

    const protocols =
      flags.protocol && flags.protocol.length > 0
        ? PROTOCOL_PRESETS.filter((protocol) => flags.protocol?.includes(protocol.id))
        : [...PROTOCOL_PRESETS].slice(0, 3);
    const config = defaultLabConfig(name, {
      protocols: protocols.map((protocol) => ({ ...protocol })),
      settings: { structure: flags.structure, wiki: flags.wiki, defaultModel: '' },
    });
    writeLabConfig(root, config);

    const git = flags.git ? gitInit(root) : false;

    // Register the folder, so the app opens it as a project with everything above in place.
    const lab = await this.lab({ root, name });
    await lab.save();

    this.emit(
      { root, name, written, skipped, git: flags.git ? git : null, protocols: protocols.map((p) => p.id) },
      () =>
        [
          `${out.mark.ok} ${out.c.bold(name)} is a lab`,
          out.keyValues([
            ['folder', shortPath(root)],
            ['manifest', '.labconfig'],
            [
              'structure',
              flags.structure
                ? `${PROJECT_FOLDERS.length + PROJECT_FILES.length} entries, ${written.length} written`
                : out.c.grey('skipped'),
            ],
            [
              'wiki',
              flags.wiki
                ? `${written.filter((p) => p.startsWith('openwiki/')).length} pages`
                : out.c.grey('skipped'),
            ],
            ['kept', skipped.length > 0 ? skipped.join(', ') : out.c.grey('nothing to keep')],
            ['protocols', protocols.map((protocol) => protocol.name).join(', ')],
            ['git', flags.git ? (git ? 'initialised' : 'already a repository') : out.c.grey('not requested')],
          ]),
          '',
          out.note(`Next: \`openlab status\`, or \`openlab chat\` for a turn in ${shortPath(root)}.`),
        ].join('\n'),
    );
  }
}
