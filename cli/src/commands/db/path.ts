/**
 * Where the store is.
 *
 * The database and the data directory it lives in, read from the same path the app derives, so
 * this answers "is the CLI looking at the same file the app is?". A `-wal` sidecar means a
 * connection is open somewhere — usually the desktop app — so a write here may have to wait.
 */

import { existsSync, statSync } from 'node:fs';

import { formatBytes } from '@/lib/format';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { dataDir, databasePath, shortPath } from '../../lib/paths';

export default class DbPath extends LabCommand {
  static description = 'Show where the workbench’s store is';

  async run(): Promise<void> {
    const database = databasePath();
    const dir = dataDir();
    const exists = existsSync(database);
    const size = exists ? statSync(database).size : 0;
    const open = existsSync(`${database}-wal`) || existsSync(`${database}-shm`);

    const value = { database, exists, size, dataDir: dir, open };
    this.record(value, [
      ['database', shortPath(database)],
      ['size', exists ? formatBytes(size) : out.c.grey('not created yet')],
      ['data dir', shortPath(dir)],
      [
        'in use',
        open ? out.c.yellow('possibly open (a WAL file is present)') : out.c.grey('no other connection seen'),
      ],
    ]);
  }
}
