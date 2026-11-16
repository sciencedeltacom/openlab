/**
 * Unlink a cloud store.
 *
 * The app clears the connection’s credential and then removes it, and this does the same for
 * the half it can reach: the CLI’s vault entry is deleted and the connection is removed through
 * the catalogue’s own writer. The desktop app’s Stronghold copy is the app’s own and is not
 * touched here.
 */

import { Args, Flags } from '@oclif/core';

import { secretKey } from '@/lib/cloud/client';
import { loadConnections, saveConnections } from '@/lib/db/catalog';

import { LabCommand } from '../../lib/base';
import { deleteSecret } from '../../lib/host/secrets';
import * as out from '../../lib/output';

export default class ConnectionsRm extends LabCommand {
  static description = 'Unlink a cloud store';

  static args = { id: Args.string({ description: 'The connection id', required: true }) };

  static flags = {
    yes: Flags.boolean({ description: 'Confirm the removal' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConnectionsRm);
    const lab = await this.lab({ root: null });
    const connections = await loadConnections(lab.db);
    const connection = connections.find((candidate) => candidate.id === args.id);
    if (!connection) {
      this.fail(`No connection ${args.id}. See \`openlab connections list\`.`);
    }
    if (!flags.yes) {
      this.fail(`Unlinking “${connection.label}” is permanent. Pass --yes to confirm.`);
    }

    const cleared = deleteSecret(secretKey(connection.id));
    await saveConnections(
      lab.db,
      connections.filter((candidate) => candidate.id !== connection.id),
    );
    await lab.save();

    this.emit(
      { id: connection.id, removed: true, credentialCleared: cleared },
      () =>
        `${out.mark.ok} Unlinked ${out.c.bold(connection.label)}${cleared ? ' and cleared its CLI credential' : ''}.`,
    );
  }
}
