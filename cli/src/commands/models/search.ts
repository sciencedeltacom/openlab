import { Args, Flags } from '@oclif/core';

import { allProviders } from '@/store/types';

import { LabCommand } from '../../lib/base';
import { withCatalog } from '../../lib/models';
import * as out from '../../lib/output';

export default class ModelsSearch extends LabCommand {
  static description = 'Search every provider’s models for a name';

  static args = { term: Args.string({ description: 'What to look for', required: true }) };

  static flags = {
    limit: Flags.integer({ description: 'How many to show', default: 40 }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ModelsSearch);
    const lab = await this.lab({ root: null });
    const term = args.term.toLowerCase();
    const matches: { ref: string; provider: string; context: number }[] = [];

    for (const provider of allProviders(withCatalog(lab.state))) {
      for (const model of provider.models) {
        if (matches.length >= flags.limit) break;
        if (
          `${provider.id}/${model.id}`.toLowerCase().includes(term) ||
          model.label.toLowerCase().includes(term)
        ) {
          matches.push({
            ref: `${provider.id}/${model.id}`,
            provider: provider.label,
            context: model.contextWindow ?? 0,
          });
        }
      }
    }

    this.list(
      matches.map((match) => ({
        ...match,
        context: match.context ? `${Math.round(match.context / 1000)}k` : '—',
      })),
      [
        { key: 'ref', label: 'ref', truncate: true, width: 52 },
        { key: 'provider', label: 'provider', truncate: true, width: 24 },
        { key: 'context', label: 'ctx', align: 'right' },
      ],
      `No model matches “${args.term}”.`,
    );

    if (!this.json && matches.length >= flags.limit) {
      this.log(out.note(`… stopped at ${flags.limit}; raise --limit for more.`));
    }
  }
}
