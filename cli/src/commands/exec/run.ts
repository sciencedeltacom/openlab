/**
 * Running a command.
 *
 * The app's own `run_command`: the working directory is bounded by the workspace, output is
 * capped, and the command runs with the user's own privileges — it is the same shell they
 * would have typed. The process exits with the command's own code, so a script can branch on
 * it. A credential named on the command line is read from the CLI's vault, never printed.
 */

import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import { runCommand } from '../../lib/host/exec';
import { getSecret } from '../../lib/host/secrets';
import * as out from '../../lib/output';

export default class ExecRun extends LabCommand {
  static description = 'Run a shell command in the workspace, and exit with its code';

  static args = {
    command: Args.string({ required: true, description: 'The shell command to run, quoted as one argument' }),
  };

  static flags = {
    cwd: Flags.string({ description: 'Run in this folder, relative to the lab root' }),
    timeout: Flags.integer({ char: 't', description: 'Seconds before the command is stopped', default: 120 }),
    env: Flags.string({
      description: 'Set an environment variable, as name=value; repeat for more',
      multiple: true,
      multipleNonGreedy: true,
    }),
    credential: Flags.string({
      description: 'Resolve ENV=provider from the vault; repeat for more',
      multiple: true,
      multipleNonGreedy: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExecRun);
    const lab = await this.requireLab();
    const root = lab.root as string;

    const env: Record<string, string> = {};
    for (const pair of flags.env ?? []) {
      const [name, value] = this.pair(pair);
      env[name] = value;
    }
    for (const pair of flags.credential ?? []) {
      const [name, provider] = this.pair(pair);
      const value = getSecret(provider);
      if (value === null) {
        // The app's Rust side leaves a missing credential unset rather than failing the run.
        this.warn(`no stored credential for ${provider}; ${name} was left unset`);
        continue;
      }
      env[name] = value;
    }

    const command = args.command;
    const result = runCommand(command, { cwd: flags.cwd, root, env, timeoutMs: flags.timeout * 1000 });

    if (this.json) {
      this.log(
        out.json({ command, output: result.output, exitCode: result.exitCode, timedOut: result.timedOut }),
      );
    } else {
      process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
    }

    // The command's own code, so a script can branch on the run. A signal or a timeout has no
    // code of its own; report 1 rather than an impossible negative exit.
    process.exitCode = result.exitCode >= 0 ? result.exitCode : 1;
  }

  /** Split `name=value` at the first `=`, keeping any further `=` in the value. */
  private pair(pair: string): [string, string] {
    const at = pair.indexOf('=');
    if (at <= 0) {
      this.fail(`expected name=value, not “${pair}”.`);
    }
    return [pair.slice(0, at), pair.slice(at + 1)];
  }
}
