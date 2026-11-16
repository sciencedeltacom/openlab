/**
 * The compute targets.
 *
 * A target is a machine a job can be sent to. The list carries the four things a reader scans
 * for: what it is, how it is reached, whether it can take a run now, and how much of its
 * allocation is already committed.
 */

import { Flags } from '@oclif/core';

import { adapterFor, hostOf } from '@/lib/compute/adapters';
import type { Target } from '@/store/compute';

import { LabCommand } from '../../../lib/base';

/** How much of a target's allocation is committed, or a dash when it has none. */
function allocation(target: Target): string {
  if (!target.allocation) return '—';
  return `${target.allocation.used.toLocaleString('en-US')}/${target.allocation.total.toLocaleString('en-US')} ${target.allocation.unit}`;
}

export default class ComputeTargetsList extends LabCommand {
  static description = 'List the compute targets: kind, readiness, host and allocation';

  static flags = {
    ready: Flags.boolean({ description: 'Only targets ready to take a job' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ComputeTargetsList);
    const lab = await this.requireLab();
    const rows = lab.state.targets
      .filter((target) => !flags.ready || target.readiness === 'ready')
      .map((target) => ({
        id: target.id,
        kind: target.kind,
        label: adapterFor(target.kind).label,
        readiness: target.readiness,
        host: target.host || hostOf(target.kind, target.config ?? {}),
        allocation: allocation(target),
      }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'kind', label: 'kind' },
        { key: 'readiness', label: 'readiness' },
        { key: 'host', label: 'host', truncate: true, width: 32 },
        { key: 'allocation', label: 'allocation', align: 'right' },
      ],
      'No targets yet. `openlab compute targets new --kind local` adds one.',
    );
  }
}
