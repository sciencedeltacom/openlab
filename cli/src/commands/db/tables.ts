/**
 * Every table and how many rows it holds.
 *
 * Read straight from `sqlite_master` through the workbench's own connection, so the list is the
 * schema the app would see, not a copy of it.
 */

import { LabCommand } from '../../lib/base';

export default class DbTables extends LabCommand {
  static description = 'List every table with its row count';

  async run(): Promise<void> {
    const lab = await this.lab({ root: null });
    const names = lab.sqlite
      .query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
      .all() as { name: string }[];

    const rows = names.map(({ name }) => ({
      table: name,
      rows: (
        lab.sqlite.query(`select count(*) as n from "${name.replace(/"/g, '""')}"`).get() as { n: number }
      ).n,
    }));

    this.list(
      rows,
      [
        { key: 'table', label: 'table' },
        { key: 'rows', label: 'rows', align: 'right' },
      ],
      'The store has no tables yet.',
    );
  }
}
