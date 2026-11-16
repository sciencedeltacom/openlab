/**
 * Make a figure.
 *
 * The shape comes from the app's own `createFigure`/`startDocument`, so a new figure of a kind
 * opens with the elements that kind starts from. The folder is written with `writeFigures`, the
 * same writer the app's mirror uses, so the app opens what the CLI wrote and a colleague's git
 * gets the document, not a screenshot.
 */

import { Flags } from '@oclif/core';

import { FIGURE_DIR, createFigure } from '@/components/figures/store';
import { FIGURE_KINDS, figureSlug, type FigureKind } from '@/components/figures/types';

import { LabCommand } from '../../../lib/base';
import { readFigures, writeFigures } from '../../../lib/workspace';

/** The plot kinds, which name a figure of the `Plot` kind. */
const PLOT_KINDS = ['bar', 'line', 'area', 'scatter', 'pie'];

/** The figure kind `--kind` names: a figure kind in any case, or a plot kind that is one. */
function resolveKind(raw: string): FigureKind | null {
  const named = FIGURE_KINDS.find((kind) => kind.toLowerCase() === raw.toLowerCase());
  return named ?? (PLOT_KINDS.includes(raw.toLowerCase()) ? 'Plot' : null);
}

export default class FigureNew extends LabCommand {
  static description = 'Write a new figure document into .openlab/figures';

  static flags = {
    kind: Flags.string({
      required: true,
      description: `The figure kind (${FIGURE_KINDS.join(', ')}), or a plot kind (${PLOT_KINDS.join(', ')})`,
    }),
    caption: Flags.string({ required: true, description: 'The caption the figure carries' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FigureNew);
    const lab = await this.requireLab();
    const root = lab.root as string;

    const kind = resolveKind(flags.kind);
    if (!kind) {
      this.fail(`Unknown kind “${flags.kind}”. Try one of: ${[...FIGURE_KINDS, ...PLOT_KINDS].join(', ')}.`);
    }

    const { figures } = readFigures(root);
    const figure = createFigure({ caption: flags.caption, kind });
    writeFigures(root, [...figures, figure]);

    this.record(figure, [
      ['id', figure.id],
      ['kind', figure.kind],
      ['caption', figure.caption],
      ['document', `${FIGURE_DIR}/${figureSlug(figure)}.json`],
      ['elements', String(figure.doc.elements.length)],
    ]);
  }
}
