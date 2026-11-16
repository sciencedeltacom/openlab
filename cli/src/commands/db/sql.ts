/**
 * One SQL statement against the store.
 *
 * The store's transport is one statement at a time — that is how Drizzle's proxy drives it — so
 * a string holding two is refused rather than half-run. `--read` returns the rows a statement
 * produces; without it the statement executes and the number of changed rows is reported.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class DbSql extends LabCommand {
  static description = 'Run one SQL statement against the store';

  static args = {
    sql: Args.string({ required: true, description: 'One SQL statement' }),
  };

  static flags = {
    read: Flags.boolean({ char: 'r', description: 'Print the rows the statement returns' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DbSql);
    if (countStatements(args.sql) > 1) {
      this.fail('one statement at a time: the store’s transport runs a single statement.');
    }
    const lab = await this.lab({ root: null });

    if (flags.read) {
      const rows = lab.sqlite.query(args.sql).all() as Record<string, unknown>[];
      if (this.json) {
        this.log(out.json(rows));
        return;
      }
      if (rows.length === 0) {
        this.log(out.note('No rows.'));
        return;
      }
      this.log(
        out.table(
          rows,
          Object.keys(rows[0]).map((key) => ({ key, label: key })),
        ),
      );
      return;
    }

    const result = lab.sqlite.query(args.sql).run();
    this.emit(
      { sql: args.sql, changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) },
      (value) => `${out.mark.ok} ${value.changes} row${value.changes === 1 ? '' : 's'} changed`,
    );
  }
}

/** How many statements a string holds, ignoring semicolons inside quotes and a trailing one. */
function countStatements(sql: string): number {
  const text = sql.trim();
  let quoted: string | null = null;
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === quoted) quoted = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quoted = char;
      continue;
    }
    if (
      char === ';' &&
      text
        .slice(index + 1)
        .replace(/;+/g, '')
        .trim() !== ''
    ) {
      count += 1;
    }
  }
  return count;
}
