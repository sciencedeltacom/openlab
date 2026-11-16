import { Flags } from '@oclif/core';

import { createProvider, parseModelLine, type Protocol } from '@/lib/providers';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

/** The protocols a custom provider can speak. */
const PROTOCOLS: Protocol[] = ['openai', 'anthropic', 'google', 'local'];

export default class ProvidersAdd extends LabCommand {
  static description = 'Add a provider of your own (a gateway, a lab server, a local model)';

  static flags = {
    id: Flags.string({ description: 'The id a model reference names it by', required: true }),
    label: Flags.string({ description: 'What the picker shows' }),
    protocol: Flags.string({
      description: 'How it speaks on the wire',
      options: PROTOCOLS,
      default: 'openai',
    }),
    'base-url': Flags.string({ description: 'Where it lives', required: true }),
    key: Flags.boolean({ description: 'It requires a credential', default: true, allowNo: true }),
    model: Flags.string({
      description: 'A model, as `id | label | context`; repeat for more',
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ProvidersAdd);
    const lab = await this.lab({ root: null });
    if (lab.state.customProviders.some((provider) => provider.id === flags.id)) {
      this.fail(`A custom provider “${flags.id}” is already registered.`);
    }

    const models = (flags.model ?? [])
      .map((line) => parseModelLine(line))
      .filter((model): model is NonNullable<typeof model> => Boolean(model));
    const provider = createProvider({
      id: flags.id,
      label: flags.label ?? flags.id,
      protocol: flags.protocol as Protocol,
      baseUrl: flags['base-url'],
      requiresKey: flags.key,
      models,
    });

    lab.state.customProviders = [...lab.state.customProviders, provider];
    await lab.save();

    this.emit(
      { provider, models: models.length },
      () =>
        `${out.mark.ok} added ${out.c.bold(provider.label)} ${out.c.grey(provider.id)}\n${out.note(
          provider.requiresKey
            ? `Set its key with \`openlab secrets set ${provider.id}\`.`
            : 'No credential needed.',
        )}`,
    );
  }
}
