/**
 * The cloud providers the app can connect to.
 *
 * One row per provider the Files page offers: what it is, how it authenticates, the fields its
 * connect form asks for, and whether this terminal holds a credential for it. The credential is
 * the CLI's own vault, keyed by the provider's field names — the app's Stronghold snapshot is not
 * readable here.
 */

import type { CloudProvider } from '@/lib/cloud/types';
import { CLOUD_PROVIDERS } from '@/lib/cloud/providers';

import { LabCommand } from '../../lib/base';
import { getSecret } from '../../lib/host/secrets';
import * as out from '../../lib/output';

/** The credential the CLI vault holds for a provider: its id first, then its own field names. */
export function cliCredential(provider: CloudProvider): { field: string; value: string } | null {
  const byProvider = getSecret(provider.id);
  if (byProvider) {
    return { field: provider.id, value: byProvider };
  }
  for (const field of provider.credentialFields) {
    const value = getSecret(field.key);
    if (value) {
      return { field: field.key, value };
    }
  }
  return null;
}

export default class CloudProviders extends LabCommand {
  static description = 'List the cloud providers the app knows, and whether the CLI holds a credential';

  async run(): Promise<void> {
    const rows = CLOUD_PROVIDERS.map((provider) => {
      const credential = cliCredential(provider);
      return {
        id: provider.id,
        label: provider.label,
        auth: provider.auth,
        credential: credential !== null,
        credentialField: credential?.field ?? null,
        configFields: provider.configFields,
        credentialFields: provider.credentialFields,
      };
    });

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'label', label: 'label' },
        { key: 'auth', label: 'auth' },
        {
          key: 'credential',
          label: 'credential',
          format: (row) => (row.credential ? out.mark.ok : out.c.grey('—')),
        },
        {
          key: 'fields',
          label: 'fields',
          format: (row) =>
            [
              ...row.configFields.map((field) => field.key),
              ...row.credentialFields.map((field) => `${field.key}*`),
            ].join(', ') || out.c.grey('—'),
        },
      ],
      'No cloud providers.',
    );
  }
}
