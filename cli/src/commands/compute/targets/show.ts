/**
 * One target, in full.
 *
 * What it is, how it is reached, what configuration it carries, and — the part a reader checks
 * before sending a run — which credential the provider's own CLI reads and whether this
 * terminal has it. The credential is named by its environment variable and its value is never
 * read out here; `openlab tools credentials list` answers the same question for every surface.
 */

import { Args } from '@oclif/core';

import { adapterFor } from '@/lib/compute/adapters';

import { LabCommand } from '../../../lib/base';
import { getSecret } from '../../../lib/host/secrets';
import * as out from '../../../lib/output';

/** Where a credential was found: the CLI's vault, the environment, or nowhere. */
function credentialState(key: string): 'vault' | 'environment' | 'missing' {
  if (getSecret(key) !== null) return 'vault';
  if (process.env[key]) return 'environment';
  return 'missing';
}

export default class ComputeTargetsShow extends LabCommand {
  static description = 'Show one target, including the credential env vars its CLI reads';

  static args = { id: Args.string({ description: 'The target id or name', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ComputeTargetsShow);
    const lab = await this.requireLab();
    const target = lab.state.targets.find(
      (candidate) => candidate.id === args.id || candidate.name.toLowerCase() === args.id.toLowerCase(),
    );
    if (!target) {
      this.fail(`No target “${args.id}”. See \`openlab compute targets list\`.`);
    }
    const adapter = adapterFor(target.kind);
    const credentials = adapter.secrets.map((field) => ({
      key: field.key,
      label: field.label,
      required: Boolean(field.required),
      state: credentialState(field.key),
    }));
    const config = adapter.config.map((field) => ({
      key: field.key,
      label: field.label,
      value: target.config?.[field.key] ?? '',
      required: Boolean(field.required),
    }));
    const jobs = lab.state.jobs.filter((job) => job.targetId === target.id);

    const value = {
      ...target,
      adapter: { label: adapter.label, summary: adapter.summary },
      config,
      credentials,
      jobs: jobs.map((job) => job.id),
    };

    this.emit(value, () => {
      const lines = [
        out.keyValues([
          ['target', `${out.c.bold(target.name)}  ${out.c.grey(target.id)}`],
          ['kind', `${adapter.label}  ${out.c.grey(target.kind)}`],
          ['readiness', target.readiness],
          ['host', target.host],
          ['summary', target.summary],
          ['cores', `${target.cores} cores · ${target.memoryGb} GB${target.gpus ? ` · ${target.gpus}` : ''}`],
          ['concurrency', target.concurrency > 0 ? `${target.concurrency} jobs at once` : 'none'],
          ['cost', target.cost],
          [
            'allocation',
            target.allocation
              ? `${target.allocation.used}/${target.allocation.total} ${target.allocation.unit}`
              : 'unmetered',
          ],
          ['check', `${target.check.tone}  ${target.check.detail}  ${out.c.grey(target.check.at)}`],
        ]),
        '',
        out.heading('Configuration'),
        ...(config.length > 0
          ? config.map(
              (field) =>
                `  ${field.label}  ${field.value || out.c.grey(field.required ? 'required, not set' : 'not set')}`,
            )
          : [out.note('  nothing to configure for this kind')]),
        '',
        out.heading('Credentials'),
        ...(credentials.length > 0
          ? credentials.map((field) => {
              const mark = field.state === 'missing' ? out.mark.bad : out.mark.ok;
              const where =
                field.state === 'missing'
                  ? `missing: set it with \`openlab tools credentials set ${field.key}\``
                  : field.state;
              return `  ${mark} ${field.key}  ${out.c.grey(field.label)}  ${where}`;
            })
          : [out.note('  none needed')]),
        '',
        out.heading(`What it still needs (${target.needs.length})`),
        ...(target.needs.length > 0
          ? target.needs.map((need) => `  ${out.mark.warn} ${need}`)
          : [out.note('  nothing; ready to take a job')]),
        '',
        out.heading(`Recent jobs (${jobs.length})`),
        ...(jobs.length > 0
          ? jobs.map((job) => `  ${job.state.padEnd(9)} ${job.id}  ${job.name}`)
          : [out.note('  none')]),
      ];
      return lines.join('\n');
    });
  }
}
