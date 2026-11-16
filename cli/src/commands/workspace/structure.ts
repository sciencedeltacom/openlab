import { Flags } from '@oclif/core';

import { starterPages } from '@/lib/knowledge/init';
import { scaffoldFiles } from '@/lib/workspace-project';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { readLabConfig, structure, writeLabFiles } from '../../lib/workspace';

export default class WorkspaceStructure extends LabCommand {
  static description = 'Check the lab’s structure, and write what is missing';

  static flags = {
    fix: Flags.boolean({ description: 'Write the missing folders and files' }),
    wiki: Flags.boolean({ description: 'Include the starter OpenWiki when fixing' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkspaceStructure);
    const lab = await this.requireLab();
    const root = lab.root as string;
    const entries = structure(root);

    if (flags.fix) {
      const name = readLabConfig(root)?.name ?? lab.project?.name ?? 'lab';
      const files = new Map(scaffoldFiles(name));
      if (flags.wiki) {
        for (const [path, contents] of Object.entries(starterPages(name))) {
          files.set(path, contents);
        }
      }
      const { written, skipped } = writeLabFiles(root, files);
      this.emit(
        { root, structure: structure(root), written, skipped },
        () =>
          `${out.mark.ok} wrote ${written.length} file${written.length === 1 ? '' : 's'}; kept ${skipped.length} already there.`,
      );
      return;
    }

    this.list(
      entries.map((entry) => ({ ...entry, present: entry.present ? 'yes' : 'missing' })),
      [
        { key: 'dir', label: 'path' },
        { key: 'description', label: 'what it is for', truncate: true, width: 34 },
        { key: 'present', label: 'here' },
      ],
    );
  }
}
