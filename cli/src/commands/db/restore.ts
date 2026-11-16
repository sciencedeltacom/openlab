/**
 * Put a copy back.
 *
 * Replacing the store is the one destructive thing the CLI can do to the workbench itself, so
 * it takes the same shape as every other removal: `--yes` is the confirmation, because a
 * mistyped path cannot be undone from here.
 *
 * Three rules make it safe to run:
 *
 *  - The copy is checked **before** anything is replaced: it must open, pass an integrity
 *    check, and carry the schema the app expects.
 *  - The store that is about to be replaced is copied first, with `VACUUM INTO`, so a wrong
 *    restore still has a way back.
 *  - The write-ahead sidecars are removed with the file. A stale `-wal` beside a new database
 *    is how a restore appears to work and then loses rows on the next open.
 */

import { copyFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { Database } from 'bun:sqlite';

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { databasePath, shortPath } from '../../lib/paths';

/** What a candidate copy must carry: the table the migration runner writes. */
const REQUIRED_TABLE = '__drizzle_migrations';

export default class DbRestore extends LabCommand {
  static description = 'Replace the store with a copy from `openlab db backup` (close the app first)';

  static args = {
    file: Args.string({ description: 'The copy to restore', required: true }),
  };

  static flags = {
    yes: Flags.boolean({ description: 'Confirm the replacement; without it the command refuses' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DbRestore);
    const source = args.file;

    if (!existsSync(source)) {
      this.fail(`No copy at ${source}.`);
    }
    const check = inspect(source);
    if (!check.ok) {
      this.fail(`${source} is not a usable copy: ${check.reason}`);
    }
    const target = databasePath();
    if (!flags.yes) {
      this.fail(`Restoring replaces the store at ${shortPath(target)}. Pass --yes to confirm.`);
    }

    const lab = await this.lab({ root: null });
    const safety = existsSync(target) ? target.replace(/\.db$/, `.before-restore-${Date.now()}.db`) : null;

    if (safety) {
      // A consistent copy of what is about to be replaced, while the connection is still open.
      lab.sqlite.run('VACUUM INTO ?', [safety]);
    }
    lab.close();

    for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
      if (existsSync(sidecar)) {
        try {
          unlinkSync(sidecar);
        } catch {
          // A sidecar that cannot be removed is reported by the check below, not guessed at.
        }
      }
    }
    copyFileSync(source, target);

    const after = inspect(target);
    if (!after.ok) {
      this.fail(`The store was replaced but does not check out: ${after.reason}`);
    }

    this.emit({ restored: target, from: source, size: statSync(target).size, safety }, (value) => {
      const facts: [string, string][] = [
        ['from', out.c.grey(shortPath(value.from))],
        ['store', shortPath(value.restored)],
        ['size', `${(value.size / 1024).toFixed(0)} KB`],
      ];
      if (value.safety) facts.push(['previous', out.c.grey(shortPath(value.safety))]);
      return [out.heading('Store restored'), out.keyValues(facts)].join('\n');
    });
  }
}

/** Open a candidate read-only and say whether the app could work with it. */
function inspect(path: string): { ok: true } | { ok: false; reason: string } {
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true });
    const rows = db.query('PRAGMA integrity_check').all() as Record<string, unknown>[];
    const verdict = String(Object.values(rows[0] ?? {})[0] ?? '').toLowerCase();
    if (verdict !== 'ok') {
      return { ok: false, reason: `integrity check said "${verdict || 'nothing'}"` };
    }
    const table = db
      .query("select name from sqlite_master where type = 'table' and name = ?")
      .get(REQUIRED_TABLE);
    if (!table) {
      return { ok: false, reason: `the ${REQUIRED_TABLE} table is missing` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
}
