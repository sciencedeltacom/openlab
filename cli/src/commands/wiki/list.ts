/**
 * The pages under `openwiki/`.
 *
 * The wiki the agent reads, listed as the files it is: every markdown page, by its path
 * relative to the workspace. `glob_files` is the CLI's own glob, anchored to the folder, so
 * the same rules the agent's search uses decide what is a page.
 */

import { globFiles } from '../../lib/host/search';
import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class WikiList extends LabCommand {
  static description = 'List every page under openwiki/';

  async run(): Promise<void> {
    const lab = await this.requireLab();
    const root = lab.root as string;
    const pages = globFiles('openwiki/**/*.md', root)
      .map((file) => ({ path: file.relative, bytes: file.size }))
      .sort((a, b) => a.path.localeCompare(b.path));

    this.emit({ root, count: pages.length, pages }, (listed) => {
      if (listed.pages.length === 0) {
        return out.note('No pages under openwiki/. Run `openlab init` to lay down a starter wiki.');
      }
      return [
        out.table(listed.pages, [
          { key: 'path', label: 'page' },
          { key: 'bytes', label: 'bytes', align: 'right' },
        ]),
        '',
        out.note(`${listed.count} pages under openwiki/.`),
      ].join('\n');
    });
  }
}
