/**
 * The catalogue databases: the public services a source can search.
 *
 * Each row is a connection with named operations, so the count is how many requests it
 * understands — usually a `find` and a `fetch`. The catalogue is app-level: it describes the
 * world outside a lab, and a source points into it by id.
 */

import { allDatabases } from '@/components/databases/store';

import { LabCommand } from '../../lib/base';

export default class DatabasesList extends LabCommand {
  static description = 'List the catalogue databases and their operations';

  async run(): Promise<void> {
    await this.lab();

    this.list(
      allDatabases(),
      [
        { key: 'id', label: 'id' },
        { key: 'name', label: 'name' },
        { key: 'family', label: 'family' },
        {
          key: 'operations',
          label: 'ops',
          align: 'right',
          format: (database) => String(database.operations.length),
        },
        { key: 'state', label: 'state' },
        { key: 'access', label: 'access' },
      ],
      'No databases. `openlab databases new` adds one.',
    );
  }
}
