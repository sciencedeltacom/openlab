/**
 * Removing a database from the catalogue.
 *
 * A database the catalogue still ships cannot be brought back from the CLI, and every source
 * that points at it goes stale, so `--yes` is required. Removing one does not delete it from
 * the shipped list — a later hydrate would restore it only if the catalogue were empty — so
 * this is a real removal, not a hide.
 */

import { Args, Flags } from '@oclif/core';

import { findDatabase, removeDatabase } from '@/components/databases/store';

import { LabCommand } from '../../lib/base';

export default class DatabasesRm extends LabCommand {
  static description = 'Remove a database from the catalogue';

  static args = {
    id: Args.string({ description: 'The database id', required: true }),
  };

  static flags = {
    yes: Flags.boolean({ description: 'Confirm the removal', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DatabasesRm);
    const lab = await this.lab();

    const database = findDatabase(args.id);
    if (!database) {
      this.fail(`No database “${args.id}”. See \`openlab databases list\`.`);
    }
    if (!flags.yes) {
      this.fail(`Removing “${database.name}” cannot be undone. Pass --yes to confirm.`);
    }

    removeDatabase(database.id);
    await lab.save();
    this.done(`${database.name} removed.`);
  }
}
