/**
 * Copy the store, safely.
 *
 * A SQLite file is not safe to copy while a connection has it open: a write-ahead log or a
 * half-written page makes the copy a database that opens and then lies. `VACUUM INTO` asks the
 * engine for a consistent snapshot instead, so the copy is a complete, compact database even
 * while the app is running.
 *
 * The copies are timestamped and pruned to a small number, because a backup command that
 * fills the disk is a backup command nobody runs twice.
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { dataDir, shortPath } from '../../lib/paths';

/** Where copies go when no directory is named. */
const BACKUP_DIR = 'backups';

/** How many copies are kept by default. */
const KEEP = 5;

export default class DbBackup extends LabCommand {
  static description = 'Write a consistent copy of the store';

  static flags = {
    dir: Flags.string({
      char: 'd',
      description: `Directory for the copy (default: ${BACKUP_DIR}/ under the data directory)`,
    }),
    keep: Flags.integer({
      description: `Copies to keep in that directory, 1–50 (default: ${KEEP})`,
      min: 1,
      max: 50,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DbBackup);
    const lab = await this.lab({ root: null });
    const dir = flags.dir ? resolve(flags.dir) : join(dataDir(true), BACKUP_DIR);
    mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = join(dir, `openlab-${stamp}.db`);
    // The engine writes the snapshot; the path is data, so it is bound rather than spliced.
    lab.sqlite.run('VACUUM INTO ?', [destination]);

    const size = statSync(destination).size;
    const keep = flags.keep ?? KEEP;
    const removed = DbBackup.prune(dir, keep);

    this.emit({ path: destination, size, kept: keep, removed }, (value) => {
      const facts: [string, string][] = [
        ['copy', `${formatSize(value.size)}  ${out.c.grey(shortPath(value.path))}`],
        ['kept', `${value.kept} copy${value.kept === 1 ? '' : 'ies'} in this directory`],
      ];
      if (value.removed > 0) {
        facts.push(['pruned', `${value.removed} older copy${value.removed === 1 ? '' : 'ies'}`]);
      }
      return [out.heading('Store backup'), out.keyValues(facts)].join('\n');
    });
  }

  /** Remove the oldest copies past `keep`; returns how many were removed. */
  private static prune(dir: string, keep: number): number {
    if (!existsSync(dir)) return 0;
    const copies = readdirSync(dir)
      .filter((name) => name.startsWith('openlab-') && name.endsWith('.db'))
      .sort();
    let removed = 0;
    while (copies.length > keep) {
      const oldest = copies.shift();
      if (!oldest) break;
      try {
        unlinkSync(join(dir, oldest));
        removed += 1;
      } catch {
        // A copy that cannot be removed is not a reason to fail the new one.
      }
    }
    return removed;
  }
}

/** Bytes as a short human string, for the table. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
