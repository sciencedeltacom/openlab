import { Args } from '@oclif/core';

import { mergeProviders } from '@/lib/providers';

import { LabCommand } from '../../lib/base';
import { catalogProviders, envFor } from '../../lib/catalog';
import { providerKey } from '../../lib/host/secrets';
import * as out from '../../lib/output';

export default class ProvidersShow extends LabCommand {
  static description = 'Show one provider in full';

  static args = { id: Args.string({ description: 'The provider id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ProvidersShow);
    const lab = await this.lab({ root: null });
    const provider = mergeProviders([...catalogProviders(), ...lab.state.customProviders]).find(
      (candidate) => candidate.id === args.id,
    );
    if (!provider) {
      this.fail(`No provider “${args.id}”. \`openlab providers list\` shows the ids.`);
    }
    const names = envFor(provider.id);
    const baseUrl = lab.state.providerBaseUrls[provider.id] ?? provider.defaultBaseUrl ?? '';
    const models = provider.models;

    this.emit(
      { provider, baseUrl, keyEnv: names, hasKey: Boolean(providerKey(provider.id, names)), models },
      (value) =>
        [
          out.keyValues([
            ['provider', `${out.c.bold(provider.label)} ${out.c.grey(provider.id)}`],
            ['protocol', provider.protocol],
            ['base url', baseUrl || out.c.red('not set')],
            [
              'key',
              provider.requiresKey
                ? value.hasKey
                  ? out.c.green('present')
                  : out.c.red('missing')
                : out.c.grey('not needed'),
            ],
            ['key env', names.join(', ') || '—'],
            ['docs', provider.docsUrl ?? '—'],
            ['models', String(models.length)],
          ]),
          '',
          out.note(provider.summary),
          ...(models.length > 0
            ? [
                '',
                out.heading('Models'),
                out.bullets(
                  models
                    .slice(0, 20)
                    .map(
                      (model) =>
                        `${model.id} ${out.c.grey(`${model.contextWindow ? `${model.contextWindow} ctx` : ''}${model.supportsTools ? ' · tools' : ''}${model.supportsReasoning ? ' · reasoning' : ''}`)}`,
                    ),
                ),
                ...(models.length > 20 ? [out.note(`… ${models.length - 20} more`)] : []),
              ]
            : []),
        ].join('\n'),
    );
  }
}
