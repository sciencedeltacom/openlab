/**
 * The experiment ledger, as a table.
 *
 * Experiments live in the workbench's store, not in the folder, so this opens the store alone
 * — the ledger is one list across every lab the app knows, the way the Experiments page reads it.
 */

import { allDomains, allExperiments } from '@/components/experiments/store';

import { LabCommand } from '../../../lib/base';

/** Epoch ms as `YYYY-MM-DD HH:MM`, which is what a ledger row reads. */
function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

export default class ExperimentList extends LabCommand {
  static description = 'List the experiment ledger: id, domain, stage, outcome and trials';

  async run(): Promise<void> {
    const lab = await this.lab();
    const domains = new Map(allDomains().map((domain) => [domain.id, domain.name]));
    const rows = allExperiments().map((experiment) => ({
      id: experiment.id,
      domain: experiment.domainId ? (domains.get(experiment.domainId) ?? experiment.domainId) : '',
      stage: experiment.stage,
      outcome: experiment.outcome,
      trials: experiment.trials.length,
      updated: stamp(experiment.updatedAt),
    }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'domain', label: 'domain' },
        { key: 'stage', label: 'stage' },
        { key: 'outcome', label: 'outcome' },
        { key: 'trials', label: 'trials', align: 'right' },
        { key: 'updated', label: 'updated' },
      ],
      'No experiments yet. `openlab analyze experiments new` opens one.',
    );
  }
}
