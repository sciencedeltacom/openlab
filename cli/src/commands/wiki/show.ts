/**
 * One wiki page.
 *
 * The page as the graph reads it: its title, its summary, the pages it links to and its body
 * with the front matter stripped. The ref may be a path, a title or a bare name — the same
 * `findWikiPage` the agent's knowledge tool uses, so both resolve a page the same way.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Args } from '@oclif/core';

import { findWikiPage, loadWikiFrom, type WikiSource } from '@/lib/knowledge/wiki';

import { globFiles } from '../../lib/host/search';
import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class WikiShow extends LabCommand {
  static description = 'Show one wiki page’s text';

  static args = {
    page: Args.string({ description: 'The page’s path, title or name', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(WikiShow);
    const lab = await this.requireLab();
    const root = lab.root as string;

    // The explorer reads pages through the app's Rust commands; the CLI reads the same files
    // through its own glob and filesystem, and the parsing is `loadWikiFrom` either way.
    const source: WikiSource = {
      glob: async (pattern, path) => globFiles(pattern, root, path).map((file) => file.relative),
      read: async (path) => readFileSync(join(root, path), 'utf8'),
    };
    const graph = await loadWikiFrom(source);
    if (!graph) this.fail('This workspace has no OpenWiki: nothing under `openwiki/`.');

    const page = findWikiPage(graph, args.page);
    if (!page) {
      this.fail(`No wiki page matches “${args.page}”. Run \`openlab wiki list\` to see the pages.`);
    }

    this.emit(page, (shown) => {
      const head = [out.c.bold(`${shown.id} · ${shown.title}`)];
      if (shown.summary) head.push(out.note(shown.summary));
      if (shown.links.length > 0) head.push(out.note(`links: ${shown.links.join(', ')}`));
      return [...head, '', shown.content].join('\n');
    });
  }
}
