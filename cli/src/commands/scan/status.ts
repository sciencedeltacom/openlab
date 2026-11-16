import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { dataDir } from '../../lib/paths';

export default class ScanStatus extends LabCommand {
  static description = 'Where the scan index lives, and what is in it';

  async run(): Promise<void> {
    const lab = await this.lab({ root: null });
    const indexRoot = lab.state.indexRoot;
    const dir = join(dataDir(), 'vectors');
    const present = existsSync(dir);
    let tables: string[] = [];
    if (present) {
      try {
        tables = readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory());
      } catch {
        tables = [];
      }
    }

    const value = { indexRoot, vectorsDir: dir, exists: present, tables };
    this.emit(value, (status) =>
      [
        out.keyValues([
          ['index root', status.indexRoot || out.c.grey('not set (the app uses the workspace root)')],
          [
            'vectors',
            status.exists ? status.vectorsDir : out.c.grey(`${status.vectorsDir}: not written yet`),
          ],
          ['index tables', status.tables.length > 0 ? status.tables.join(', ') : out.c.grey('none')],
        ]),
        '',
        out.note(
          'The index is opened by the app; a terminal process reads what is on disk and nothing more.',
        ),
      ].join('\n'),
    );
  }
}
