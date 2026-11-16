/**
 * Terminal furniture.
 *
 * A CLI is read, not looked at: a spinner while something takes time, a prompt that shows the
 * choices instead of listing them in the help text, and colour that disappears when the output
 * is piped. `ora`, `@clack/prompts` and `picocolors` supply those three; this module decides
 * when they are appropriate.
 *
 * Nothing here runs when the terminal is not interactive (a pipe, CI, `--json`), because a
 * spinner in a log is noise and a prompt in a pipeline is a hang.
 */

import * as clack from '@clack/prompts';
import ora, { type Ora } from 'ora';

export type { Ora };
import { createColors } from 'picocolors';

/** True when there is a person at the other end of both streams. */
export const interactive =
  Boolean(process.stdin.isTTY) &&
  Boolean(process.stdout.isTTY) &&
  process.env.CI !== 'true' &&
  process.env.TERM !== 'dumb';

/** picocolors, switched off when the output is piped or colour is disabled. */
export const pc = createColors(
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb',
);

/** A spinner on stderr, so it never contaminates data on stdout. */
export function spinner(text: string, enabled = interactive && !process.env.NO_COLOR): Ora {
  return ora({ text, isEnabled: enabled, stream: process.stderr });
}

/** Run `work` under a spinner; succeed or fail the label from the result. */
export async function withSpinner<T>(
  label: string,
  work: (spinner: Ora) => Promise<T>,
  done?: (value: T) => string,
): Promise<T> {
  const spin = spinner(label);
  // ora still writes its final line when it was never started, which would put a tick in a
  // piped log. Start and settle only when it is actually enabled.
  if (spin.isEnabled) spin.start();
  try {
    const value = await work(spin);
    if (spin.isEnabled) spin.succeed(done ? done(value) : label);
    return value;
  } catch (error) {
    if (spin.isEnabled) spin.fail(label);
    throw error;
  }
}

/** The clack namespace, re-exported so commands import one module for terminal behaviour. */
export const prompts = clack;

/** True when the reader cancelled a prompt (Esc or Ctrl-C). */
export function cancelled(value: unknown): boolean {
  return clack.isCancel(value);
}

/** Exit gently after a cancelled prompt, with clack's own goodbye rather than a stack trace. */
export function cancel(message = 'Cancelled.'): never {
  clack.cancel(message);
  process.exit(0);
}

/** Ask only when there is someone to ask; otherwise return the fallback. */
export async function askWhenInteractive<T>(fallback: T, ask: () => Promise<T | symbol>): Promise<T> {
  if (!interactive) return fallback;
  const answer = await ask();
  if (cancelled(answer)) cancel();
  return answer as T;
}
