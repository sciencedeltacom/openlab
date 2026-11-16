/**
 * Export a figure's source into `results/`.
 *
 * A figure's SVG and PNG are drawn by the app, in the browser, from this document — there is no
 * renderer in the terminal, so this copies the editable source and says so rather than pretending
 * to render. `--readme` brings the folder's own explanation along, for a reader who receives only
 * the results folder.
 */

import { dirname } from 'node:path';

import { Args, Flags } from '@oclif/core';

import { FIGURE_README } from '@/components/figures/store';
import { figureSlug } from '@/components/figures/types';

import { LabCommand } from '../../../lib/base';
import { readFile, writeFile } from '../../../lib/host/fs';
import * as out from '../../../lib/output';
import { readFigures } from '../../../lib/workspace';

export default class FigureExport extends LabCommand {
  static description =
    'Export a figure’s editable source document into results/ (render SVG/PNG in the openlab app)';

  static examples = ['<%= config.bin %> analyze figures export F-101 --out results/figure-1.json --readme'];

  static args = {
    id: Args.string({ required: true, description: 'The figure id' }),
  };

  static flags = {
    out: Flags.string({
      description: 'Where to write the document, inside the workspace (default: results/<slug>.json)',
    }),
    readme: Flags.boolean({ description: 'Also copy the figures folder README beside the document' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FigureExport);
    const lab = await this.requireLab();
    const root = lab.root as string;

    const { figures } = readFigures(root);
    const figure = figures.find((candidate) => candidate.id === args.id);
    if (!figure) {
      this.fail(`No figure ${args.id}. See \`openlab analyze figures list\`.`);
    }

    const outPath = flags.out ?? `results/${figureSlug(figure)}.json`;
    const contents = `${JSON.stringify(figure, null, 2)}\n`;
    writeFile(outPath, contents, root);

    let readmePath: string | null = null;
    if (flags.readme) {
      readmePath = `${dirname(outPath)}/figures-README.md`;
      writeFile(readmePath, readFile(FIGURE_README, root), root);
    }

    const value = {
      id: figure.id,
      document: outPath,
      readme: readmePath,
      bytes: Buffer.byteLength(contents),
    };
    this.emit(value, (written) =>
      [
        `${out.mark.ok} exported ${out.c.bold(written.id)} → ${out.c.bold(this.short(`${root}/${written.document}`))}`,
        out.keyValues([
          ['bytes', String(written.bytes)],
          ['readme', written.readme],
        ]),
        '',
        out.note('This is the editable source document. Render SVG or PNG in the openlab app.'),
      ].join('\n'),
    );
  }
}
