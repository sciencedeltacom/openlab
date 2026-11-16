/**
 * One connection, in full.
 *
 * What it is, where it points, and the credential it needs. The credential is never on the
 * connection — it lives in a vault — so this names the fields the store asks for and says where
 * a value would be found, without reading one out.
 */

import { Args } from '@oclif/core';

import { secretKey } from '@/lib/cloud/client';
import { findProvider } from '@/lib/cloud/providers';
import { findConnection } from '@/lib/cloud/store';
import type { CloudConnection } from '@/lib/cloud/types';
import { relativeTime } from '@/lib/format';

import { LabCommand } from '../../lib/base';
import { hasSecret } from '../../lib/host/secrets';
import * as out from '../../lib/output';

/** Where a connection’s credential stands: the CLI’s vault, a signed-in account, or missing. */
function credentialState(connection: CloudConnection): string {
  const provider = findProvider(connection.providerId);
  if (hasSecret(secretKey(connection.id))) return 'vault';
  if (provider?.accountProvider) return 'account';
  if ((provider?.credentialFields ?? []).some((field) => field.required)) return 'missing';
  return 'not needed';
}

export default class ConnectionsShow extends LabCommand {
  static description = 'Show one connection: its provider, configuration and credential';

  static args = { id: Args.string({ description: 'The connection id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ConnectionsShow);
    // The connection is read from the hydrated store, so the workbench has to be open first.
    await this.lab({ root: null });
    const connection = findConnection(args.id);
    if (!connection) {
      this.fail(`No connection ${args.id}. See \`openlab connections list\`.`);
    }
    const provider = findProvider(connection.providerId);
    const config = (provider?.configFields ?? []).map((field) => ({
      key: field.key,
      label: field.label,
      value: connection.config[field.key] ?? '',
      required: Boolean(field.required),
    }));
    const credentials = (provider?.credentialFields ?? []).map((field) => field.key);
    const state = credentialState(connection);
    const value = {
      ...connection,
      provider: provider ?? null,
      config,
      credentials,
      credentialState: state,
    };

    this.emit(value, () => {
      const lines = [
        out.keyValues([
          ['connection', `${out.c.bold(connection.label)}  ${out.c.grey(connection.id)}`],
          ['provider', provider ? `${provider.label}  ${out.c.grey(provider.group)}` : connection.providerId],
          ['auth', provider?.auth ?? 'unknown'],
          ['added', relativeTime(connection.createdAt)],
          ['credential', state],
          ['docs', provider?.docsUrl],
        ]),
        '',
        out.heading('Configuration'),
        ...(config.length > 0
          ? config.map(
              (field) =>
                `  ${field.label}  ${field.value || out.c.grey(field.required ? 'required, not set' : 'not set')}`,
            )
          : [out.note('  nothing to configure')]),
        '',
        out.heading('Credential'),
        ...(provider?.accountProvider
          ? [
              out.note(
                `  an account the app has signed in (${provider.accountProvider}); the CLI holds no value`,
              ),
            ]
          : credentials.length > 0
            ? credentials.map(
                (key) =>
                  `  ${key}  ${out.c.grey(`set it with \`openlab tools credentials set ${secretKey(connection.id)}\``)}`,
              )
            : [out.note('  none needed')]),
      ];
      return lines.join('\n');
    });
  }
}
