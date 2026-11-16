/**
 * Run a job.
 *
 * On a `local` target this is real: the adapter's own submit line runs in the workspace through
 * the same command runner every other surface uses, the ledger keeps the state, the exit code
 * and the log tail, and the run's full output is appended under `logs/`. The state comes from
 * the exit code — nothing is reported as succeeded that did not exit zero.
 *
 * A remote kind is not run here. Its submit needs the desktop app's worker, which resolves the
 * credential from the credential vault and hands it to one child process; the terminal has neither,
 * so this says what is missing instead of pretending.
 */

import { Args } from '@oclif/core';

import { environmentFor, submitCommand } from '@/lib/compute/adapters';
import { logLines } from '@/lib/compute/run';
import { formatDuration } from '@/lib/format';

import { LabCommand } from '../../lib/base';
import { runCommand } from '../../lib/host/exec';
import { pathExists, readFile, writeFile } from '../../lib/host/fs';
import * as out from '../../lib/output';

export default class ComputeRun extends LabCommand {
  static description = 'Run a queued job on a local target, recording its state and output';

  static args = { job: Args.string({ description: 'The job id to run', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ComputeRun);
    const lab = await this.requireLab();
    const root = lab.root as string;
    const job = lab.state.jobs.find((candidate) => candidate.id === args.job);
    if (!job) {
      this.fail(`No job ${args.job}. See \`openlab compute jobs list\`.`);
    }
    const target = lab.state.targets.find((candidate) => candidate.id === job.targetId);
    if (!target) {
      this.fail(`Job ${job.id} names a target that no longer exists (${job.targetId}).`);
    }
    if (target.kind !== 'local') {
      this.fail(
        `${target.name} is a ${target.kind} target. Submitting to it needs the desktop app: the adapter’s command runs through the app’s worker, which reads the credential from the credential vault and sets it on the child process. Neither is available in the terminal. Run this job from the app, or send it to a local target.`,
      );
    }

    job.state = 'running';
    job.startedMinutesAgo = 0;
    job.history = [...job.history, { at: 'just now', state: 'running', note: target.name }];

    const config = target.config ?? {};
    const command = submitCommand(target.kind, config, job.command, job.id);
    const env = environmentFor(target.kind, config, {});
    const startedAt = Date.now();
    const result = runCommand(command, { root, env });
    const ok = result.exitCode === 0;

    const lines = [`$ ${command}`, ...logLines(result.output)];
    const logPath = `logs/job-${job.id}.log`;
    const stamp = new Date().toISOString();
    const block = `# ${job.id}: ${stamp}, exit ${result.exitCode}\n$ ${command}\n${result.output}\n\n`;
    const previous = pathExists(logPath, root) ? readFile(logPath, root) : '';
    writeFile(logPath, previous + block, root);

    job.state = ok ? 'succeeded' : 'failed';
    job.duration = formatDuration(Date.now() - startedAt);
    job.error = ok ? undefined : (lines.find((line) => line !== `$ ${command}`) ?? 'no output').slice(0, 160);
    job.logTail = lines;
    // A re-run appends to the same log file, so the artifact is recorded once rather than once
    // per run.
    if (!job.outputs.some((item) => item.ref === logPath)) {
      job.outputs = [...job.outputs, { ref: logPath, note: 'run log' }];
    }
    job.history = [...job.history, { at: 'just now', state: job.state, note: `exit ${result.exitCode}` }];
    await lab.save();

    this.emit(
      {
        job: job.id,
        state: job.state,
        exitCode: result.exitCode,
        duration: job.duration,
        log: logPath,
      },
      () =>
        [
          `${ok ? out.mark.ok : out.mark.bad} ${out.c.bold(job.name)} ${job.state}  ${out.c.grey(
            `exit ${result.exitCode}`,
          )}`,
          out.keyValues([
            ['command', command],
            ['duration', job.duration],
            ['log', logPath],
          ]),
          '',
          result.output.trim() || out.note('(no output)'),
        ].join('\n'),
    );
  }
}
