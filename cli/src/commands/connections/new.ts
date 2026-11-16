/**
 * Link a cloud store.
 *
 * The connection is by reference — provider, label and the non-secret configuration its listing
 * needs — built the way the app’s connect form builds one and added through the same store. The
 * credential is not part of it: it goes to a vault under `cloud-<id>`, which this command says
 * plainly rather than pretending the store is ready to browse.
 */

import { Flags } from '@oclif/core';

import { CLOUD_PROVIDERS, findProvider } from '@/lib/cloud/providers';
import { addConnection } from '@/lib/cloud/store';
import { secretKey } from '@/lib/cloud/client';
import type { CloudConnection } from '@/lib/cloud/types';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** The `key=value` pairs a `--config` list carries. */
function parseConfig(values: readonly string[]): Record<string, string> {
  const config: Record<string, string> = {};
  for (const pair of values) {
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      throw new Error(`--config takes key=value, not “${pair}”`);
    }
    config[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }
  return config;
}

export default class ConnectionsNew extends LabCommand {
  static description = 'Link a cloud store the Files page can browse';

  static flags = {
    provider: Flags.string({
      description: 'The store to connect',
      required: true,
      options: CLOUD_PROVIDERS.map((provider) => provider.id),
    }),
    label: Flags.string({ description: 'How the connection is listed (default: the provider’s name)' }),
    bucket: Flags.string({ description: 'The bucket, for an object store' }),
    config: Flags.string({
      description: 'A configuration value, as key=value; repeat for more',
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConnectionsNew);
    const lab = await this.lab({ root: null });
    const provider = findProvider(flags.provider);
    if (!provider) {
      this.fail(`No provider “${flags.provider}”. See \`openlab connections new --help\`.`);
    }

    let given: Record<string, string> = {};
    try {
      given = parseConfig(flags.config ?? []);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
    const config: Record<string, string> = {
      ...Object.fromEntries(provider.configFields.map((field) => [field.key, field.default ?? ''])),
      ...given,
    };
    if (flags.bucket && provider.configFields.some((field) => field.key === 'bucket')) {
      config.bucket = flags.bucket;
    }

    const missing = provider.configFields.filter((field) => field.required && !config[field.key]?.trim());
    if (missing.length > 0) {
      const fields = missing.map((field) => `--config ${field.key}=…`).join(', ');
      this.fail(`${provider.label} needs ${fields}.`);
    }

    const connection: CloudConnection = {
      id: `cloud-${crypto.randomUUID().slice(0, 8)}`,
      providerId: provider.id,
      label: flags.label?.trim() || provider.label,
      config,
      createdAt: Date.now(),
    };
    addConnection(connection);
    // The store queues its write; draining it here means the next command reads the connection.
    await lab.save();

    this.emit({ ...connection, credential: provider.credentialFields.map((field) => field.key) }, () =>
      [
        `${out.mark.ok} Linked ${out.c.bold(connection.label)}  ${out.c.grey(connection.id)}`,
        out.keyValues([
          ['provider', provider.label],
          [
            'config',
            Object.entries(config)
              .filter(([, value]) => value)
              .map(([key, value]) => `${key}=${value}`)
              .join(' '),
          ],
        ]),
        '',
        provider.accountProvider
          ? out.note(`Browsing needs the app’s signed-in ${provider.accountProvider} account.`)
          : provider.credentialFields.length > 0
            ? out.note(
                `Set its credential with \`openlab tools credentials set ${secretKey(connection.id)}\`; the app keeps its own copy in the credential vault.`,
              )
            : out.note('This store needs no credential.'),
      ].join('\n'),
    );
  }
}
