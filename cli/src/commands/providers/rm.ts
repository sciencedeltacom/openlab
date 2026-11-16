import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class ProvidersRm extends LabCommand {
  static description = 'Remove a provider you added';

  static args = { id: Args.string({ description: 'The provider id', required: true }) };

  static flags = { yes: Flags.boolean({ char: 'y', description: 'Confirm the removal' }) };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ProvidersRm);
    const lab = await this.lab({ root: null });
    const provider = lab.state.customProviders.find((candidate) => candidate.id === args.id);
    if (!provider) {
      this.fail(`No custom provider “${args.id}”. A built-in cannot be removed, only overridden.`);
    }
    if (!flags.yes) {
      this.fail(`This removes ${provider.label} from the registry. Pass --yes.`);
    }

    lab.state.customProviders = lab.state.customProviders.filter((candidate) => candidate.id !== args.id);
    await lab.save();

    this.emit({ id: args.id, removed: true }, () => `${out.mark.ok} removed ${out.c.grey(provider.label)}`);
  }
}
