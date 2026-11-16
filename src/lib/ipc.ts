/**
 * Typed wrappers around the Rust command surface.
 *
 * Every call goes through {@link invokeCommand}, which:
 *  - returns a `Result`-shaped value instead of throwing, so callers never need a try/catch;
 *  - detects when the app is running in a plain browser (`vite dev` without Tauri) and
 *    fails with a readable message rather than an opaque "window.__TAURI_INTERNALS__" error.
 */

import type { CommandError } from './ipc-types';

export type { CommandError } from './ipc-types';

/** Discriminated result of a command call. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: CommandError };

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: InvokeFn | null = null;
let invokeLoadFailed = false;

/** Load `@tauri-apps/api/core` lazily so browser-only dev keeps working. */
async function getInvoke(): Promise<InvokeFn | null> {
  if (cachedInvoke || invokeLoadFailed) {
    return cachedInvoke;
  }
  // `__TAURI_INTERNALS__` is injected by the Tauri runtime before any script runs.
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    invokeLoadFailed = true;
    return null;
  }
  try {
    const core = await import('@tauri-apps/api/core');
    cachedInvoke = core.invoke as InvokeFn;
    return cachedInvoke;
  } catch {
    invokeLoadFailed = true;
    return null;
  }
}

/** True when the UI is hosted by the Tauri shell rather than a plain browser. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Call a Rust command.
 *
 * Never throws: failures come back as `{ ok: false, error }` with a `kind` the UI can
 * branch on and a `message` that is safe to display.
 */
export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<Result<T>> {
  const invoke = await getInvoke();
  if (!invoke) {
    return {
      ok: false,
      error: {
        kind: 'no-runtime',
        message: 'The desktop runtime is not attached. Run `bun run dev:openlab` from the repository root.',
      },
    };
  }
  try {
    return { ok: true, value: await invoke<T>(command, args) };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

/** Tauri rejects with the command's serialised error; anything else is unexpected. */
function normalizeError(error: unknown): CommandError {
  if (typeof error === 'object' && error !== null && 'kind' in error && 'message' in error) {
    return error as CommandError;
  }
  if (error instanceof Error) {
    return { kind: 'unknown', message: error.message };
  }
  return { kind: 'unknown', message: String(error) };
}

/** Convenience: unwrap a result, falling back to `undefined` and reporting the error. */
export function unwrap<T>(result: Result<T>, onError?: (error: CommandError) => void): T | undefined {
  if (result.ok) {
    return result.value;
  }
  onError?.(result.error);
  return undefined;
}
