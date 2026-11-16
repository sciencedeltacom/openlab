/**
 * The job ledger.
 *
 * Every run the workspace has queued, with the two facts a ledger row exists to answer: where
 * it went and where it stands. A job whose target was removed shows the id it names rather than
 * vanishing, because a run that happened is a fact.
 */

import { Flags } from '@oclif/core';

import { LabCommand } from '../../../lib/base';

/** Where a run is in its life, as `JobState` names them. */
const JOB_STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;

export default class ComputeJobsList extends LabCommand {
  static description = 'List the compute job ledger: target, state, command and duration';

  static flags = {
    state: Flags.string({ description: 'Only jobs in this state', options: [...JOB_STATES] }),
    target: Flags.string({ description: 'Only jobs sent to this target, by id or name' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ComputeJobsList);
    const lab = await this.requireLab();
    const targets = new Map(lab.state.targets.map((target) => [target.id, target]));

    const rows = lab.state.jobs
      .filter((job) => !flags.state || job.state === flags.state)
      .filter((job) => {
        if (!flags.target) return true;
        const target = targets.get(job.targetId);
        return job.targetId === flags.target || target?.name.toLowerCase() === flags.target.toLowerCase();
      })
      .map((job) => ({
        id: job.id,
        name: job.name,
        target: targets.get(job.targetId)?.name ?? job.targetId,
        state: job.state,
        command: job.command,
        duration: job.duration,
      }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'target', label: 'target', truncate: true, width: 22 },
        { key: 'state', label: 'state' },
        { key: 'command', label: 'command', truncate: true, width: 48 },
        { key: 'duration', label: 'duration', align: 'right' },
      ],
      'No jobs yet. `openlab compute jobs new` queues one.',
    );
  }
}
