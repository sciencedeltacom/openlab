/**
 * Adding a database to the catalogue.
 *
 * A database is a connection with named operations. The minimum is an id, a label and a
 * summary; `--endpoint` and `--find <path>` make it searchable from the start, so a source can
 * point at it without opening the app. It is written as a row like any other, and the app can
 * edit it afterwards.
 */

import { Flags } from '@oclif/core';

import { addDatabase, findDatabase } from '@/components/databases/store';
import type { Database } from '@/components/databases/data';

import { LabCommand } from '../../lib/base';

export default class DatabasesNew extends LabCommand {
  static description = 'Add a database to the catalogue';

  static flags = {
    id: Flags.string({ description: 'The database id', required: true }),
    label: Flags.string({ description: 'The database name', required: true }),
    summary: Flags.string({ description: 'What the database holds, in one sentence' }),
    endpoint: Flags.string({ description: 'The base URL, e.g. https://api.example.org' }),
    find: Flags.string({ description: 'The path of a `find` operation, e.g. /search' }),
    docs: Flags.string({ description: 'A documentation URL' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DatabasesNew);
    const lab = await this.lab();

    const id = flags.id.trim();
    if (findDatabase(id)) {
      this.fail(`A database “${id}” is already in the catalogue. Remove it first, or pick another id.`);
    }
    const summary = flags.summary?.trim() ?? '';

    const database: Database = {
      id,
      name: flags.label.trim(),
      family: 'Custom',
      mark: 'file',
      purpose: summary,
      recordCount: '—',
      access: 'Open',
      state: 'connected',
      authorization: 'none',
      endpoint: flags.endpoint?.trim() ?? '',
      operations: flags.find
        ? [
            {
              id: 'find',
              label: 'Search',
              method: 'GET',
              path: flags.find.trim(),
              parameters: [
                { name: 'query', label: 'Search', kind: 'text', in: 'query', required: true },
                { name: 'limit', label: 'Results', kind: 'number', in: 'query', default: 25 },
              ],
            },
          ]
        : [],
      defaultHeaders: [{ name: 'Accept', value: 'application/json' }],
      holds: summary,
      updateCadence: '',
      licence: '',
      docsUrl: flags.docs?.trim() ?? '',
      sample: { kind: 'text', text: '(no sample)' },
    };

    addDatabase(database);
    await lab.save();

    this.record(database, [
      ['database', database.id],
      ['name', database.name],
      ['endpoint', database.endpoint || '—'],
      ['operations', database.operations.map((operation) => operation.id).join(', ') || 'none yet'],
    ]);
  }
}
