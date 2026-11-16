/**
 * One job, in full.
 *
 * The ledger row answers "did it run"; this answers what it ran, where, what happened at each
 * state change, what it read and wrote, and what its log says. The command is kept verbatim
 * because a run without its command is an anecdote.
 */

import { Args } from '@oclif/core';

import { LabCommand } from '../../../lib/base';
import { pathExists } from '../../../lib/host/fs';
import * as out from '../../../lib/output';

export default class ComputeJobsShow extends LabCommand {
  static description = 'Show one job: its command, target, state, events, artifacts and logs';

  static args = { id: Args.string({ description: 'The job id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ComputeJobsShow);
    const lab = await this.requireLab();
    const job = lab.state.jobs.find((candidate) => candidate.id === args.id);
    if (!job) {
      this.fail(`No job ${args.id}. See \`openlab compute jobs list\`.`);
    }
    const target = lab.state.targets.find((candidate) => candidate.id === job.targetId);
    const logPath = `logs/job-${job.id}.log`;
    const value = {
      job,
      target: target
        ? {
            id: target.id,
            name: target.name,
            kind: target.kind,
            host: target.host,
            readiness: target.readiness,
          }
        : null,
      log: pathExists(logPath, lab.root) ? logPath : null,
    };

    this.emit(value, ({ job: record, target: where, log }) => {
      const artifact = (item: { ref: string; note?: string }): string =>
        `${item.ref}${item.note ? `  ${out.c.grey(item.note)}` : ''}`;
      const lines = [
        out.keyValues([
          ['job', `${out.c.bold(record.name)}  ${out.c.grey(record.id)}`],
          ['state', record.state],
          ['target', where ? `${where.name}  ${out.c.grey(where.kind)}` : record.targetId],
          ['duration', record.duration],
          ['cost', record.cost],
          ['objective', record.objective],
          ['error', record.error],
        ]),
        '',
        out.heading('Command'),
        `  ${record.command}`,
        '',
        out.heading(`Events (${record.history.length})`),
        ...(record.history.length > 0
          ? out
              .bullets(
                record.history.map(
                  (event) => `${event.at}  ${event.state}${event.note ? `  ${event.note}` : ''}`,
                ),
              )
              .split('\n')
          : [out.note('  none')]),
        '',
        out.heading(`Inputs (${record.inputs.length})`),
        ...(record.inputs.length > 0
          ? out.bullets(record.inputs.map(artifact)).split('\n')
          : [out.note('  none')]),
        '',
        out.heading(`Outputs (${record.outputs.length})`),
        ...(record.outputs.length > 0
          ? out.bullets(record.outputs.map(artifact)).split('\n')
          : [out.note('  none')]),
        '',
        out.heading(`Log tail (${record.logTail.length})`),
        ...(record.logTail.length > 0 ? record.logTail.map((line) => `  ${line}`) : [out.note('  empty')]),
      ];
      if (log) {
        lines.push('', out.note(`Full log: ${log}`));
      }
      return lines.join('\n');
    });
  }
}
