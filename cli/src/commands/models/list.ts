import { Flags } from '@oclif/core';

import { allProviders } from '@/store/types';

import { LabCommand } from '../../lib/base';
import { withCatalog } from '../../lib/models';
import * as out from '../../lib/output';

export default class ModelsList extends LabCommand {
  static description = 'List the models a provider offers';

  static flags = {
    provider: Flags.string({ description: 'The provider id (default: the one the workbench is set to)' }),
    tools: Flags.boolean({ description: 'Only models that support tools' }),
    vision: Flags.boolean({ description: 'Only models that take images' }),
    reasoning: Flags.boolean({ description: 'Only models with a reasoning control' }),
    limit: Flags.integer({ description: 'How many to show', default: 50 }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ModelsList);
    const lab = await this.lab({ root: null });
    const state = withCatalog(lab.state);
    const providerId = flags.provider ?? state.modelRef.split('/')[0];
    const provider = allProviders(state).find((candidate) => candidate.id === providerId);
    if (!provider) {
      this.fail(`No provider “${providerId}”. \`openlab providers list\` shows the ids.`);
    }

    const models = provider.models
      .filter((model) => !flags.tools || model.supportsTools)
      .filter((model) => !flags.vision || model.supportsVision)
      .filter((model) => !flags.reasoning || model.supportsReasoning);

    const rows = models.slice(0, flags.limit).map((model) => ({
      ref: `${provider.id}/${model.id}`,
      label: model.label,
      context: model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k` : '—',
      tools: model.supportsTools ? 'yes' : '',
      vision: model.supportsVision ? 'yes' : '',
      reasoning: model.supportsReasoning ? 'yes' : '',
    }));

    this.list(rows, [
      { key: 'ref', label: 'ref', truncate: true, width: 46 },
      { key: 'label', label: 'model', truncate: true, width: 28 },
      { key: 'context', label: 'ctx', align: 'right' },
      { key: 'tools', label: 'tools' },
      { key: 'vision', label: 'vision' },
      { key: 'reasoning', label: 'reasoning' },
    ]);

    if (!this.json && models.length > flags.limit) {
      this.log(
        out.note(
          `… ${models.length - flags.limit} more; raise --limit or narrow with --tools/--vision/--reasoning`,
        ),
      );
    }
  }
}
