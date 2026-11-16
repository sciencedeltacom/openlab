/**
 * Searching file contents.
 *
 * The app's own `grep_files`: anchored to the workspace root, skipping `.git`, `node_modules`
 * and build output, files past the size cap left alone rather than half-searched, and matches
 * capped so a broad pattern cannot print a megabyte. When the cap is hit, the output says so.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { grepFiles } from '../../lib/host/search';
import * as out from '../../lib/output';

export default class SearchGrep extends LabCommand {
  static description = 'Search file contents by regular expression';

  static args = {
    pattern: Args.string({ required: true, description: 'A regular expression' }),
  };

  static flags = {
    path: Flags.string({ description: 'Search under this folder, relative to the lab root' }),
    glob: Flags.string({ description: 'Only files whose name matches this glob' }),
    'ignore-case': Flags.boolean({ char: 'i', description: 'Match without regard to case' }),
    limit: Flags.integer({ description: 'Most matches to return', default: 200 }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SearchGrep);
    const lab = await this.requireLab();
    const root = lab.root as string;

    const result = grepFiles(args.pattern, root, {
      path: flags.path,
      glob: anchor(flags.glob),
      ignoreCase: flags['ignore-case'],
      maxMatches: flags.limit,
    });

    this.emit(
      {
        pattern: result.pattern,
        count: result.matches.length,
        truncated: result.truncated,
        matches: result.matches,
      },
      (value) => {
        if (value.matches.length === 0) {
          return out.note('No matches.');
        }
        const lines = value.matches.map((match) => `${out.c.cyan(match.path)}:${match.line}: ${match.text}`);
        if (value.truncated) {
          lines.push(out.note(`… more than ${flags.limit} matches; narrow the pattern`));
        }
        return lines.join('\n');
      },
    );
  }
}

/**
 * Anchor a user's glob to any depth.
 *
 * The app matches a glob against a file's name, so `*.md` means every Markdown file. The host
 * here matches against the absolute path, where `*.md` matches nothing; a leading double-star
 * segment gives back the meaning the app has. A pattern the user already anchored, or one
 * written from the root, is left alone.
 */
function anchor(glob: string | undefined): string | undefined {
  if (!glob || glob.startsWith('/') || glob.startsWith('**')) {
    return glob;
  }
  return '**/' + glob;
}
