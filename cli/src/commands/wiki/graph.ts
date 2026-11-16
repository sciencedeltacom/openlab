/**
 * The wiki as a graph.
 *
 * The pages are nodes and the links between them are edges, exactly as the explorer draws
 * them: `loadWikiFrom` resolves every relative link and drops the ones that point outside the
 * wiki. An orphan is a page nothing links to — the one kind of page a reader can never arrive
 * at by following the wiki, which is why it is worth naming.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadWikiFrom, type WikiSource } from '@/lib/knowledge/wiki';

import { globFiles } from '../../lib/host/search';
import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class WikiGraph extends LabCommand {
  static description = 'Show the wiki as a graph: its pages, their links and its orphans';

  async run(): Promise<void> {
    const lab = await this.requireLab();
    const root = lab.root as string;

    const source: WikiSource = {
      glob: async (pattern, path) => globFiles(pattern, root, path).map((file) => file.relative),
      read: async (path) => readFileSync(join(root, path), 'utf8'),
    };
    const graph = await loadWikiFrom(source);
    if (!graph) this.fail('This workspace has no OpenWiki: nothing under `openwiki/`.');

    const incoming = new Map<string, number>();
    for (const edge of graph.edges) {
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    }
    const pages = graph.pages.map((page) => ({
      id: page.id,
      title: page.title,
      summary: page.summary,
      links: page.links,
      incoming: incoming.get(page.id) ?? 0,
    }));
    const orphans = pages.filter((page) => page.incoming === 0).map((page) => page.id);

    const value = { root, pages, edges: graph.edges, orphans };

    this.emit(value, (shown) => {
      const lines = [
        `${out.c.bold(String(shown.pages.length))} pages · ${shown.edges.length} links`,
        '',
        out.heading('Pages'),
        ...shown.pages.map(
          (page) =>
            `  ${page.id}${page.incoming === 0 ? ` ${out.c.yellow('(orphan)')}` : ''} ${out.c.grey(page.title)}`,
        ),
      ];
      if (shown.edges.length > 0) {
        lines.push('', out.heading('Links'));
        for (const edge of shown.edges) {
          lines.push(`  ${edge.source} → ${edge.target}`);
        }
      }
      lines.push(
        '',
        out.heading(`Orphans (${shown.orphans.length})`),
        shown.orphans.length > 0
          ? out.bullets(shown.orphans)
          : out.note('  every page is linked from somewhere'),
      );
      return lines.join('\n');
    });
  }
}
