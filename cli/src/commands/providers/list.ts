/**
 * The providers in play.
 *
 * A provider is data — where it lives, how it authenticates, which protocol it speaks — so
 * this is about the registry and the credentials, not about a vendor. The key column asks the
 * environment and the CLI's own vault, the same pair the model factory reads.
 */

import { Flags } from '@oclif/core';

import { mergeProviders, PROVIDERS } from '@/lib/providers';

import { LabCommand } from '../../lib/base';
import { catalogProviders, envFor } from '../../lib/catalog';
import { providerKey } from '../../lib/host/secrets';

export default class ProvidersList extends LabCommand {
  static description = 'List the model providers and whether a key is present';

  static flags = {
    builtin: Flags.boolean({ description: 'Only the providers openlab ships with' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ProvidersList);
    const lab = await this.lab({ root: null });
    const custom = lab.state.customProviders;
    const all = mergeProviders([...catalogProviders(), ...custom]);
    const rows = all
      .filter((provider) => !flags.builtin || PROVIDERS.some((builtin) => builtin.id === provider.id))
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
        protocol: provider.protocol,
        baseUrl: lab.state.providerBaseUrls[provider.id] ?? provider.defaultBaseUrl ?? '',
        key: !provider.requiresKey
          ? 'not needed'
          : providerKey(provider.id, envFor(provider.id))
            ? 'present'
            : 'missing',
        models: provider.models.length,
        origin: custom.some((entry) => entry.id === provider.id) ? 'custom' : '',
      }));

    this.list(rows, [
      { key: 'id', label: 'id' },
      { key: 'label', label: 'provider', truncate: true, width: 28 },
      { key: 'protocol', label: 'protocol' },
      { key: 'key', label: 'key' },
      { key: 'models', label: 'models', align: 'right' },
      { key: 'origin', label: '' },
    ]);
  }
}
