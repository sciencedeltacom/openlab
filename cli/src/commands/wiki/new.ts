/**
 * A new wiki page.
 *
 * The page is written where the explorer and the agent both read it: under `openwiki/`, with
 * the front matter `loadWikiFrom` parses into a title and a summary. It refuses to overwrite a
 * page that is already there — a wiki is the one folder where a careless write loses somebody's
 * work — and the path is proved to stay inside the workspace by the same write the agent uses.
 */

import { Args, Flags } from '@oclif/core';

import { pathExists, writeFile } from '../../lib/host/fs';
import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** `notes/panel.md`, `openwiki/notes/panel` and `panel` all name `openwiki/notes/panel.md`. */
function pagePath(ref: string): string {
  let name = ref.trim().replace(/^\.\//, '').replace(/^\/+/, '');
  if (name.startsWith('openwiki/')) name = name.slice('openwiki/'.length);
  if (!/\.md$/i.test(name)) name = `${name}.md`;
  return `openwiki/${name}`;
}

/** A title from the page's own name, for a page nobody named. */
function titleFrom(path: string): string {
  const name = (path.split('/').pop() ?? path).replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Untitled';
}

export default class WikiNew extends LabCommand {
  static description = 'Write a new wiki page, refusing to overwrite one that exists';

  static args = {
    page: Args.string({
      description: 'The page to write, e.g. notes/panel or openwiki/panel.md',
      required: true,
    }),
  };

  static flags = {
    title: Flags.string({ char: 't', description: 'The page’s title (default: its file name)' }),
    summary: Flags.string({ char: 's', description: 'A one-line summary, for the graph and search' }),
    body: Flags.string({ char: 'b', description: 'The page’s markdown body' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WikiNew);
    const lab = await this.requireLab();
    const root = lab.root as string;

    const path = pagePath(args.page);
    if (path === 'openwiki/.md') this.fail('Name the page, e.g. `openwiki/notes/panel`.');
    if (pathExists(path, root)) {
      this.fail(`${path} is already there. openlab never overwrites a page; edit it directly instead.`);
    }

    const title = flags.title ?? titleFrom(path);
    const front = ['---', `title: ${title}`];
    if (flags.summary) front.push(`summary: ${flags.summary}`);
    front.push('---');
    const contents = [...front, '', `# ${title}`, '', (flags.body ?? '').trim(), ''].join('\n');

    writeFile(path, contents, root);

    this.emit({ path, title, summary: flags.summary ?? null, bytes: contents.length }, (written) =>
      [
        `${out.mark.ok} Wrote ${out.c.bold(written.path)}`,
        out.keyValues([
          ['title', written.title],
          ['summary', written.summary ?? out.c.grey('none')],
        ]),
        '',
        out.note('Add a link from an existing page, or the new page will read as an orphan.'),
      ].join('\n'),
    );
  }
}
