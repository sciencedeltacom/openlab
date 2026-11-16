/**
 * The figures in the workspace, as a table.
 *
 * Figures are files under `.openlab/figures/`, so this reads the folder rather than the store —
 * the same documents the app's gallery reads, in the order it reads them (newest edit first).
 */

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';
import { readFigures } from '../../../lib/workspace';

/** Epoch ms as `YYYY-MM-DD HH:MM`. */
function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

export default class FigureList extends LabCommand {
  static description = 'List the figures in .openlab/figures';

  async run(): Promise<void> {
    const lab = await this.requireLab();
    const { figures, problems } = readFigures(lab.root as string);
    const rows = [...figures]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((figure) => ({
        id: figure.id,
        kind: figure.kind,
        caption: figure.caption,
        elements: figure.doc?.elements?.length ?? 0,
        updated: stamp(figure.updatedAt),
      }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'kind', label: 'kind' },
        { key: 'caption', label: 'caption', truncate: true, width: 56 },
        { key: 'elements', label: 'elements', align: 'right' },
        { key: 'updated', label: 'updated' },
      ],
      'No figures yet. `openlab analyze figures new` makes one.',
    );
    if (!this.json && problems.length > 0) {
      this.log(out.note(`${problems.length} file(s) in .openlab/figures could not be read.`));
    }
  }
}
