/**
 * Checking a target and running a job on it.
 *
 * Two operations, both real: a check runs the adapter's probe and records what came back, and
 * a submit runs the adapter's command and records the output and exit code. Nothing is
 * simulated — a target whose CLI is missing fails its check and says so, and a job that exits
 * non-zero is a failed job with its own error text.
 *
 * Credentials are read from the credential vault at the moment of the call and handed to that one
 * child process. They are never written into the target record, the job record or the
 * transcript.
 */

import { invokeCommand, isDesktop } from '@/lib/ipc';
import type { Job, Target } from '@/store/compute';
import {
  adapterFor,
  environmentFor,
  missingConfig,
  missingSecrets,
  probeCommand,
  submitCommand,
} from './adapters';
import { runOnHost } from './host';

/** Where one target's credential lives in the credential vault. */
function vaultKey(targetId: string, key: string): string {
  return `target:${targetId}:${key}`;
}

/** The names of the credentials a target has stored. */
export async function storedSecretKeys(targetId: string, keys: readonly string[]): Promise<string[]> {
  if (!isDesktop()) return [];
  const providers = keys.map((key) => vaultKey(targetId, key));
  const result = await invokeCommand<{ provider: string; hasKey: boolean }[]>('secrets_status', {
    providers,
  });
  if (!result.ok) return [];
  const present = new Set(result.value.filter((row) => row.hasKey).map((row) => row.provider));
  return keys.filter((key) => present.has(vaultKey(targetId, key)));
}

/** Write a target's credentials. An empty value removes the entry. */
export async function saveTargetSecrets(targetId: string, values: Record<string, string>): Promise<string[]> {
  const written: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const provider = vaultKey(targetId, key);
    if (value.trim() === '') {
      await invokeCommand('secret_delete', { provider });
      continue;
    }
    const result = await invokeCommand('secret_set', { provider, value: value.trim() });
    if (result.ok) written.push(key);
  }
  return written;
}

/**
 * The environment a target's command runs with.
 *
 * `env` is what the webview already holds: values typed on the create page, and the config
 * fields that are environment variables. `envVault` names, for each stored credential, the
 * vault key the value is read from — Rust resolves those and sets them on the child process, so
 * a credential never crosses the IPC boundary and no script can read it out of the interface.
 */
function environment(
  target: Target,
  provided?: Record<string, string>,
): { env: Record<string, string>; envVault: Record<string, string> } {
  const adapter = adapterFor(target.kind);
  const typed: Record<string, string> = {};
  for (const field of adapter.secrets) {
    const given = provided?.[field.key];
    if (given !== undefined && given.trim() !== '') typed[field.key] = given.trim();
  }
  const env = environmentFor(target.kind, target.config ?? {}, typed);
  const envVault: Record<string, string> = {};
  for (const field of adapter.secrets) {
    // A value typed on the create page wins for this call; everything else comes from the vault.
    if (typed[field.key] === undefined) envVault[field.key] = vaultKey(target.id, field.key);
  }
  return { env, envVault };
}

/** What a connection check found. */
export interface TargetCheck {
  ok: boolean;
  tone: 'success' | 'warning' | 'danger';
  /** One line the target record keeps. */
  detail: string;
  /** The command that ran and everything it printed. */
  command: string;
  output: string;
}

/** The first line of output that says something, for a record that keeps one line. */
function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0 && candidate !== '(no output)');
  return line ? line.slice(0, 160) : 'no output';
}

/**
 * Check that a target can take a job.
 *
 * The credential check comes first, because a probe without its key fails for a reason that is
 * not the machine's fault, and "the key is missing" is a more useful line than the CLI's own
 * complaint about an empty variable.
 */
export async function checkTarget(
  target: Target,
  root: string,
  provided?: Record<string, string>,
): Promise<TargetCheck> {
  const adapter = adapterFor(target.kind);
  const config = target.config ?? {};

  const incomplete = missingConfig(target.kind, config);
  if (incomplete.length > 0) {
    return {
      ok: false,
      tone: 'warning',
      detail: `Needs ${incomplete.map((field) => field.label.toLowerCase()).join(', ')}`,
      command: '',
      output: '',
    };
  }

  const secrets = await storedSecretKeys(
    target.id,
    adapterFor(target.kind).secrets.map((field) => field.key),
  );
  const missing = missingSecrets(target.kind, secrets);
  if (missing.length > 0) {
    return {
      ok: false,
      tone: 'warning',
      detail: `Needs ${missing.map((field) => field.label.toLowerCase()).join(', ')}`,
      command: '',
      output: '',
    };
  }

  const command = probeCommand(target.kind, config);
  const { env, envVault } = environment(target, provided);
  const result = await runOnHost(command, { root, env, envVault });
  const ok = result.exitCode === 0;
  return {
    ok,
    tone: ok ? 'success' : 'danger',
    detail: ok ? adapter.readyNote : firstLine(result.output),
    command,
    output: result.output,
  };
}

/** What a submit produced. */
export interface JobRun {
  ok: boolean;
  exitCode: number;
  /** The command that reached the machine. */
  command: string;
  output: string;
}

/**
 * Send a job's command to its target.
 *
 * The adapter wraps the command the way that machine receives it — an ssh line, an `sbatch`
 * submission, a Batch container override — and the result is the submission's own output. For
 * a scheduler that means the job id it printed, which is what the ledger keeps.
 */
export async function runJobOnTarget(target: Target, job: Job, root: string): Promise<JobRun> {
  const config = target.config ?? {};
  const command = submitCommand(target.kind, config, job.command, job.id);
  const { env, envVault } = environment(target);
  // A job is not a keystroke: a notebook can execute for half an hour, and the default
  // two-minute cap is for the composer.
  const result = await runOnHost(command, { root, env, envVault, timeoutSecs: 60 * 30 });
  return { ok: result.exitCode === 0, exitCode: result.exitCode, command, output: result.output };
}

/**
 * The lines a job keeps from a submission.
 *
 * Both ends, not the first `limit`: the opening lines say what was run, and the closing ones
 * carry the failure. Keeping only the head is how a job failed with a traceback whose cause
 * was twelve lines below the fold — the one line the reader needed was the one dropped.
 */
export function logLines(output: string, limit = 12): string[] {
  const lines = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length <= limit) {
    return lines;
  }
  const head = Math.min(3, limit - 1);
  const tail = Math.max(1, limit - head - 1);
  const hidden = lines.length - head - tail;
  return [
    ...lines.slice(0, head),
    `… ${hidden} ${hidden === 1 ? 'line' : 'lines'} between …`,
    ...lines.slice(-tail),
  ];
}
