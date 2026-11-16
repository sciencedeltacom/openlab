/**
 * Add a target.
 *
 * The kind decides everything else: the adapter names the configuration the machine needs and
 * the credentials its CLI reads, so the flags here are only the minimum worth asking for. The
 * target is added as `needs-setup` — openlab cannot know a machine is reachable until its own
 * probe answers, and `openlab compute targets check` is what runs it.
 */

import { Flags } from '@oclif/core';

import { ADAPTER_ORDER, adapterFor, defaultConfig, hostOf, missingConfig } from '@/lib/compute/adapters';
import { newTarget, type TargetKind } from '@/store/compute';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** The `key=value` pairs a `--config` list carries. */
function parseConfig(values: readonly string[]): Record<string, string> {
  const config: Record<string, string> = {};
  for (const pair of values) {
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      throw new Error(`--config takes key=value, not “${pair}”`);
    }
    config[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }
  return config;
}

export default class ComputeTargetsNew extends LabCommand {
  static description = 'Add a compute target of a given kind';

  static flags = {
    kind: Flags.string({
      description: 'How jobs reach the machine',
      required: true,
      options: [...ADAPTER_ORDER],
    }),
    label: Flags.string({ description: 'How the machine is listed (default: the kind’s name)' }),
    host: Flags.string({ description: 'The host, for the kinds reached over ssh' }),
    queue: Flags.string({ description: 'The job queue, for AWS Batch' }),
    config: Flags.string({
      description: 'A configuration value, as key=value; repeat for more',
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ComputeTargetsNew);
    const lab = await this.requireLab();
    const kind = flags.kind as TargetKind;
    const adapter = adapterFor(kind);
    const declared = new Set(adapter.config.map((field) => field.key));

    let given: Record<string, string> = {};
    try {
      given = parseConfig(flags.config ?? []);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
    const config: Record<string, string> = { ...defaultConfig(kind), ...given };
    // `--host` and `--queue` are the two fields every second kind needs; they feed the adapter's
    // own key rather than a separate record, so a target built here checks and submits like one
    // built in the app.
    if (flags.host && declared.has('host')) config.host = flags.host;
    if (flags.queue && declared.has('queue')) config.queue = flags.queue;

    const missing = missingConfig(kind, config);
    if (missing.length > 0) {
      const fields = missing.map((field) => `--config ${field.key}=…`).join(', ');
      this.fail(`${adapter.label} needs ${fields}. See \`openlab compute targets new --help\`.`);
    }

    const target = newTarget({
      name: flags.label?.trim() || adapter.label,
      kind,
      host: flags.host ?? hostOf(kind, config),
      summary: adapter.summary,
      config,
    });
    target.credentials = adapter.secrets.map((field) => field.key);
    lab.state.targets = [target, ...lab.state.targets];
    await lab.save();

    this.emit(target, () =>
      [
        `${out.mark.ok} Added ${out.c.bold(target.name)}  ${out.c.grey(target.id)}`,
        out.keyValues([
          ['kind', adapter.label],
          ['host', target.host],
          ['needs', target.needs.join(', ')],
        ]),
        '',
        out.note(`Check it with \`openlab compute targets check ${target.id}\`.`),
      ].join('\n'),
    );
  }
}
