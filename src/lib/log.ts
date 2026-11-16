/**
 * The client half of the log.
 *
 * Rust owns the file: it redacts, rotates and keeps the last five rotations. This module is
 * the one place the interface calls it, so every report has the same shape whether it came
 * from boot, a save, a render boundary or an uncaught promise.
 *
 * A local line is always written. The crash *report* — a separate JSON file the reader can
 * attach to a bug report — is opt-in, and the path comes back so the interface can say where
 * it went.
 */

import { invokeCommand, isDesktop } from '@/lib/ipc';

/** The levels the file uses. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Extra context for one line. Values are redacted on the Rust side. */
export type LogFields = Record<string, unknown>;

/** Write one structured line; returns the crash report's path when one was asked for. */
export function logEvent(
  level: LogLevel,
  scope: string,
  message: string,
  fields?: LogFields,
  report = false,
): Promise<string | null> {
  if (!isDesktop()) {
    const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    write(`[${scope}] ${message}`, fields ?? '');
    return Promise.resolve(null);
  }
  return invokeCommand<string | null>('log_write', {
    level,
    scope,
    message,
    fields: fields ?? null,
    report,
  })
    .then((result) => (result.ok ? result.value : null))
    .catch(() => null);
}

/**
 * Report a failure.
 *
 * An `Error` is unpacked rather than stringified: the stack is the part that makes a report
 * worth reading, and it is redacted like any other text.
 */
export function logError(
  scope: string,
  error: unknown,
  fields: LogFields = {},
  report = false,
): Promise<string | null> {
  if (error instanceof Error) {
    return logEvent(
      'error',
      scope,
      `${error.name}: ${error.message}`,
      { ...fields, stack: error.stack },
      report,
    );
  }
  return logEvent('error', scope, String(error), fields, report);
}
