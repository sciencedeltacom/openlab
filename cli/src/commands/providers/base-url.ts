import { Args, Flags } from '@oclif/core';

import { mergeProviders } from '@/lib/providers';

import { LabCommand } from '../../lib/base';
import { catalogProviders, envFor } from '../../lib/catalog';
import { checkPublicUrl } from '../../lib/host/exec';
import { providerKey } from '../../lib/host/secrets';
import * as out from '../../lib/output';

export default class ProvidersBaseUrl extends LabCommand {
  static description = 'Set the base URL a provider is reached at';

  static args = { id: Args.string({ description: 'The provider id', required: true }) };

  static flags = {
    url: Flags.string({ description: 'The base URL', required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ProvidersBaseUrl);
    const lab = await this.lab({ root: null });
    const provider = mergeProviders([...catalogProviders(), ...lab.state.customProviders]).find(
      (candidate) => candidate.id === args.id,
    );
    if (!provider) {
      this.fail(`No provider “${args.id}”. \`openlab providers list\` shows the ids.`);
    }
    checkPublicUrl(flags.url);
    lab.state.providerBaseUrls = { ...lab.state.providerBaseUrls, [provider.id]: flags.url };
    await lab.save();

    this.emit(
      { id: provider.id, baseUrl: flags.url },
      () => `${out.mark.ok} ${out.c.bold(provider.label)} → ${flags.url}`,
    );
  }
}
