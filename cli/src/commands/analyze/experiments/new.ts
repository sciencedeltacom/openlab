/**
 * Open an experiment.
 *
 * The same create the agent's `experiment_create` tool calls: an objective, and whatever of the
 * hypothesis, design and domain the user already knows. The criterion and the checks come after,
 * which is the point of a pre-registration.
 */

import { Flags } from '@oclif/core';

import { allDomains, createExperiment } from '@/components/experiments/store';

import { LabCommand } from '../../../lib/base';

export default class ExperimentNew extends LabCommand {
  static description = 'Create an experiment in the ledger';

  static flags = {
    objective: Flags.string({ required: true, description: 'The question the experiment answers' }),
    hypothesis: Flags.string({ description: 'What it expects to find' }),
    design: Flags.string({ description: 'How it will be run' }),
    'design-kind': Flags.string({ description: 'A short label for the design kind' }),
    domain: Flags.string({ description: 'The domain id to file it under; see `openlab analyze domains`' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExperimentNew);
    const lab = await this.lab();

    const domainId = flags.domain;
    if (domainId && !allDomains().some((domain) => domain.id === domainId)) {
      this.fail(
        `No domain ${domainId}. Known: ${
          allDomains()
            .map((domain) => domain.id)
            .join(', ') || 'none'
        }.`,
      );
    }

    const experiment = createExperiment({
      objective: flags.objective,
      hypothesis: flags.hypothesis ?? '',
      design: flags.design ?? '',
      designKind: flags['design-kind'] ?? '',
      domainId,
    });
    // The catalogue store queues its own write; the save drains it before the process exits.
    await lab.save();

    this.record(experiment, [
      ['id', experiment.id],
      ['objective', experiment.objective],
      ['domain', domainId],
      ['stage', experiment.stage],
    ]);
  }
}
