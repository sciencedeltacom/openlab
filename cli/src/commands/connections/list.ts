/**
 * The cloud stores this workbench is linked to.
 *
 * A connection is by reference: the store is reached with a credential and nothing is written to
 * the workspace until a file is imported. The credential lives in a vault, never on the
 * connection, so this says whether one is present rather than what it is — and whether it is the
 * CLI’s vault, an account the app has signed in, or nothing yet.
 */

import { secretKey } from '@/lib/cloud/client';
import { findProvider } from '@/lib/cloud/providers';
import type { CloudConnection } from '@/lib/cloud/types';
import { services } from '@/lib/container';

import { LabCommand } from '../../lib/base';
import { hasSecret } from '../../lib/host/secrets';

/** The config keys that name where a store is, in the order a reader would look. */
const LOCATION_KEYS = [
  'bucket',
  'repo',
  'recordId',
  'articleId',
  'projectId',
  'folderId',
  'datasetPid',
  'instance',
  'endpoint',
];

/** Where a connection points, from its own configuration. */
function locationOf(connection: CloudConnection): string {
  for (const key of LOCATION_KEYS) {
    if (connection.config[key]) return connection.config[key];
  }
  return Object.values(connection.config).find((value) => value !== '') ?? '';
}

/** Where a connection’s credential stands: the CLI’s vault, a signed-in account, or missing. */
function credentialState(connection: CloudConnection): string {
  const provider = findProvider(connection.providerId);
  if (hasSecret(secretKey(connection.id))) return 'vault';
  if (provider?.accountProvider) return 'account';
  if ((provider?.credentialFields ?? []).some((field) => field.required)) return 'missing';
  return 'not needed';
}

export default class ConnectionsList extends LabCommand {
  static description = 'List the cloud stores this workbench is linked to';

  async run(): Promise<void> {
    await this.parse(ConnectionsList);
    // Opening the workbench hydrates the connections store from the database; without it the
    // list would be this process's empty start rather than what is stored.
    await this.lab({ root: null });
    const connections = services.cloud.store.get();
    const rows = connections.map((connection) => ({
      id: connection.id,
      provider: findProvider(connection.providerId)?.label ?? connection.providerId,
      label: connection.label,
      location: locationOf(connection),
      credential: credentialState(connection),
    }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'provider', label: 'provider', truncate: true, width: 16 },
        { key: 'label', label: 'label', truncate: true, width: 20 },
        { key: 'location', label: 'bucket / repo', truncate: true, width: 34 },
        { key: 'credential', label: 'credential' },
      ],
      'No cloud store is linked yet. `openlab connections new` adds one.',
    );
  }
}
