/**
 * Running a command and fetching a URL.
 *
 * The Rust half is `commands/exec.rs`, and the same two guards apply: the working directory is
 * bounded by the workspace, and output is capped so one run cannot flood the terminal. A
 * command here runs with the user's own privileges, which is the point — it is the same
 * shell they would have typed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isWithin } from './fs';

/** A command is stopped after this long. */
export const COMMAND_TIMEOUT_MS = 120_000;

/** Output past this size is cut and marked. */
export const MAX_OUTPUT_BYTES = 50 * 1024;

/** What a finished command produced. */
export interface RunOutput {
  /** Combined stdout and stderr. */
  output: string;
  /** The exit code, or -1 when it was signalled or timed out. */
  exitCode: number;
  /** True when the time limit stopped it. */
  timedOut: boolean;
}

/** Cut text at the cap and say so. */
export function cap(text: string, limit = MAX_OUTPUT_BYTES): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n\n… output truncated`;
}

/** Resolve a working directory inside the workspace, refusing anything outside it. */
export function workingDir(cwd: string | undefined, root: string): string {
  const base = realpathSync(root);
  if (!cwd) {
    return base;
  }
  const joined = isAbsolute(cwd) ? cwd : join(base, cwd);
  if (!existsSync(joined)) {
    throw new Error(`could not open ${cwd}`);
  }
  const resolved = realpathSync(joined);
  if (!isWithin(resolved, base)) {
    throw new Error(`${cwd} is outside the workspace`);
  }
  return resolved;
}

/** Run a shell command in the workspace and return its output and exit code. */
export function runCommand(
  command: string,
  options: { cwd?: string; root: string; env?: Record<string, string>; timeoutMs?: number },
): RunOutput {
  const working = workingDir(options.cwd, options.root);
  const [shell, flag] = process.platform === 'win32' ? ['cmd', '/C'] : ['sh', '-c'];
  const result = spawnSync(shell, [flag, command], {
    cwd: working,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    env: { ...process.env, ...options.env },
  });

  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (result.error && !timedOut) {
    throw new Error(`could not start the command: ${result.error.message}`);
  }

  const parts = [result.stdout ?? '', result.stderr ?? ''].filter((part) => part !== '');
  let output = parts.join('\n');
  if (timedOut) {
    output += `\n… the command exceeded ${Math.round((options.timeoutMs ?? COMMAND_TIMEOUT_MS) / 1000)}s and was stopped`;
  }
  if (output.trim() === '') {
    output = '(no output)';
  }
  return { output: cap(output), exitCode: result.status ?? -1, timedOut };
}

/** Hosts a fetch will not be pointed at: the machine, and the networks beside it. */
const PRIVATE = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^0\.0\.0\.0$/,
];

/** Parse a URL and refuse anything that is not a public http(s) endpoint. */
export function checkPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${raw} is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${url.protocol} is not a supported protocol`);
  }
  if (PRIVATE.some((pattern) => pattern.test(url.hostname))) {
    throw new Error(`${url.hostname} is not a public host`);
  }
  return url;
}

/** Fetch a URL with GET and return its body as text. */
export async function fetchUrl(url: string): Promise<string> {
  const target = checkPublicUrl(url);
  const response = await fetch(target, {
    headers: { 'User-Agent': 'openlab/1.0 (research workbench)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`the server answered ${response.status} for ${url}`);
  }
  return cap(await response.text());
}

/** Whether a file is executable, for a check on a tool a lab needs. */
export function isExecutable(path: string): boolean {
  try {
    const stats = statSync(path);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
