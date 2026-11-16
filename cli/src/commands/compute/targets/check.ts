/**
 * Check that a target can take a job.
 *
 * This is the app's own check, run from the terminal: the adapter's probe for the kind, with the
 * credentials the provider's CLI reads, through the same command runner the workspace uses. The
 * credential comes first, because a probe without its key fails for a reason that is not the
 * machine's fault. When a key is missing the check says which one and how to set it, records
 * `needs-setup`, and does not claim the machine is ready.
 */

import { Args } from '@oclif/core';

import {
  adapterFor,
  environmentFor,
  missingConfig,
  missingSecrets,
  probeCommand,
} from '@/lib/compute/adapters';
import type { Readiness } from '@/store/compute';

import { LabCommand } from '../../../lib/base';
import { runCommand } from '../../../lib/host/exec';
import { getSecret } from '../../../lib/host/secrets';
import * as out from '../../../lib/output';

/** The value a credential has, from the environment first, then the CLI's own vault. */
function credentialFor(key: string): string | undefined {
  return process.env[key] ?? getSecret(key) ?? undefined;
}

export default class ComputeTargetsCheck extends LabCommand {
  static description = 'Run a target’s own readiness check and record what came back';

  static args = { id: Args.string({ description: 'The target id or name', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ComputeTargetsCheck);
    const lab = await this.requireLab();
    const root = lab.root as string;
    const target = lab.state.targets.find(
      (candidate) => candidate.id === args.id || candidate.name.toLowerCase() === args.id.toLowerCase(),
    );
    if (!target) {
      this.fail(`No target “${args.id}”. See \`openlab compute targets list\`.`);
    }
    const adapter = adapterFor(target.kind);
    const config = target.config ?? {};

    /** Record a check that could not run, and say why. */
    const record = (readiness: Readiness, tone: 'success' | 'warning' | 'danger', detail: string): void => {
      target.readiness = readiness;
      target.needs = readiness === 'ready' ? [] : [detail];
      target.check = { at: 'just now', tone, detail };
    };

    const incomplete = missingConfig(target.kind, config);
    if (incomplete.length > 0) {
      const detail = `Needs ${incomplete.map((field) => field.label.toLowerCase()).join(', ')}`;
      record('needs-setup', 'warning', detail);
      await lab.save();
      this.emit(
        { target: target.id, ok: false, readiness: target.readiness, detail, command: null, output: null },
        () => `${out.mark.warn} ${target.name}: ${detail}`,
      );
      return;
    }

    const values: Record<string, string> = {};
    const present: string[] = [];
    for (const field of adapter.secrets) {
      const value = credentialFor(field.key);
      if (value !== undefined && value !== '') {
        values[field.key] = value;
        present.push(field.key);
      }
    }
    const missing = missingSecrets(target.kind, present);
    if (missing.length > 0) {
      const keys = missing.map((field) => field.key);
      const detail = `Needs ${keys.map((key) => `\`openlab tools credentials set ${key}\``).join(', ')}`;
      record('needs-setup', 'warning', detail);
      await lab.save();
      this.emit(
        {
          target: target.id,
          ok: false,
          readiness: target.readiness,
          detail,
          missing: keys,
          command: null,
          output: null,
        },
        () =>
          [
            `${out.mark.warn} ${target.name}: a credential is missing, so the check did not run.`,
            ...keys.map(
              (key) => `  ${out.mark.bad} ${key}: set it with \`openlab tools credentials set ${key}\``,
            ),
          ].join('\n'),
      );
      return;
    }

    const command = probeCommand(target.kind, config);
    const env = environmentFor(target.kind, config, values);
    const result = runCommand(command, { root, env });
    const ok = result.exitCode === 0;
    const firstLine =
      result.output
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? 'no output';
    const detail = ok ? adapter.readyNote : firstLine.slice(0, 160);
    record(ok ? 'ready' : 'offline', ok ? 'success' : 'danger', detail);
    await lab.save();

    this.emit(
      {
        target: target.id,
        ok,
        readiness: target.readiness,
        detail,
        exitCode: result.exitCode,
        command,
        output: result.output,
      },
      () =>
        [
          `${ok ? out.mark.ok : out.mark.bad} ${out.c.bold(target.name)}: ${detail}`,
          out.keyValues([
            ['command', command],
            ['exit', String(result.exitCode)],
            ['readiness', target.readiness],
          ]),
          '',
          result.output.trim() || out.note('(no output)'),
        ].join('\n'),
    );
  }
}
