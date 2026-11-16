/**
 * One figure, as a document.
 *
 * `--json` is the whole document — the artboard and every typed element — which is what a
 * renderer would consume. Without it, the caption, kind and element count, which is what a
 * reader wants before opening the figure in the app.
 */

import { Args } from '@oclif/core';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';
import { readFigures } from '../../../lib/workspace';

export default class FigureShow extends LabCommand {
  static description = 'Show one figure: its document as JSON, or a short summary';

  static args = {
    id: Args.string({ required: true, description: 'The figure id, e.g. F-101' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(FigureShow);
    const lab = await this.requireLab();
    const { figures } = readFigures(lab.root as string);
    const figure = figures.find((candidate) => candidate.id === args.id);
    if (!figure) {
      this.fail(`No figure ${args.id}. See \`openlab analyze figures list\`.`);
    }

    this.emit(figure, (document) => {
      const elements = document.doc?.elements ?? [];
      const kinds = elements.reduce<Record<string, number>>((counts, element) => {
        counts[element.kind] = (counts[element.kind] ?? 0) + 1;
        return counts;
      }, {});
      const lines = [
        `${out.c.bold(document.id)}  ${out.c.grey(document.caption)}`,
        out.keyValues([
          ['kind', document.kind],
          ['format', document.format],
          ['size', document.size],
          ['elements', String(elements.length)],
          ['updated', new Date(document.updatedAt).toISOString()],
        ]),
      ];
      if (Object.keys(kinds).length > 0) {
        lines.push('', out.bullets(Object.entries(kinds).map(([kind, count]) => `${kind} × ${count}`)));
      }
      return lines.join('\n');
    });
  }
}
