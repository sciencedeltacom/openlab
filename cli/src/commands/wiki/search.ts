/**
 * Searching the wiki by text.
 *
 * Line by line, so a hit can be opened at the line rather than at the page. The walk is the
 * CLI's own `grep_files`, which skips `.git` and the size cap the agent's search skips, and the
 * query is escaped to literal text because a person searching a wiki is not writing a regex.
 */

import { Args, Flags } from '@oclif/core';

import { globFiles, grepFiles } from '../../lib/host/search';
import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** Escape regex metacharacters, so a search for `TASK-1` is not a search for `TASK1` plus. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default class WikiSearch extends LabCommand {
  static description = 'Search the wiki pages by text';

  static args = {
    query: Args.string({ description: 'The text to find', required: true }),
  };

  static flags = {
    caseSensitive: Flags.boolean({ description: 'Match case, which the default ignores' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WikiSearch);
    const lab = await this.requireLab();
    const root = lab.root as string;

    // Only the pages are searched; a wiki has no other files worth a hit.
    const pages = new Set(globFiles('openwiki/**/*.md', root).map((file) => file.relative));
    const found = grepFiles(literal(args.query), root, {
      path: 'openwiki',
      ignoreCase: !flags.caseSensitive,
    });
    const matches = found.matches.filter((match) => pages.has(match.path));

    this.emit(
      { root, query: args.query, truncated: found.truncated, count: matches.length, matches },
      (result) => {
        if (result.matches.length === 0) {
          return out.note(`No wiki page contains “${result.query}”.`);
        }
        return [
          out.table(result.matches, [
            { key: 'path', label: 'page', truncate: true, width: 32 },
            { key: 'line', label: 'line', align: 'right' },
            { key: 'text', label: 'text', truncate: true, width: 60 },
          ]),
          '',
          out.note(`${result.count} matches${result.truncated ? ', truncated at the search cap' : ''}.`),
        ].join('\n');
      },
    );
  }
}
