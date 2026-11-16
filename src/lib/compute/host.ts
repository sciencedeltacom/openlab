/**
 * Running a command for a compute target.
 *
 * The agent's own tool host already runs commands, but a target needs one thing the agent's
 * tools do not: an environment. A CLI that talks to Kaggle, Modal or AWS reads its credential
 * from the environment, so the values are fetched from the credential vault and set on this one
 * child process — never written to a file, never inherited by anything else.
 *
 * `root` is still the workspace, so a target's command runs inside the project it belongs to
 * even when the machine it talks to is somewhere else.
 */

import { invokeCommand } from '@/lib/ipc';

export interface RunOutput {
  output: string;
  exitCode: number;
}

/** Run a shell line, with an optional environment, and return what it produced.
 *
 * `env` values are already in the webview (typed on the create page, or config). `envVault`
 * maps an environment variable to the vault key its value comes from; Rust reads the vault and
 * sets it on the child, so the credential never crosses the IPC boundary.
 */
export async function runOnHost(
  command: string,
  options: {
    root: string;
    cwd?: string;
    env?: Record<string, string>;
    envVault?: Record<string, string>;
    /** How long the command may take, in seconds. Rust caps it at an hour. */
    timeoutSecs?: number;
  },
): Promise<RunOutput> {
  const nonEmpty = (map?: Record<string, string>) => (map && Object.keys(map).length > 0 ? map : null);
  const result = await invokeCommand<RunOutput>('run_command', {
    command,
    cwd: options.cwd ?? null,
    root: options.root,
    env: nonEmpty(options.env),
    envVault: nonEmpty(options.envVault),
    timeoutSecs: options.timeoutSecs ?? null,
  });
  if (!result.ok) {
    // A refusal or a missing runtime is a result, not an exception: the caller records it.
    return { output: result.error.message, exitCode: -1 };
  }
  return result.value;
}
