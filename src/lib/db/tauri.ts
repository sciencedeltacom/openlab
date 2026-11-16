/**
 * The Tauri executor.
 *
 * Every statement Drizzle builds is one `db_execute` call to Rust, where rusqlite runs it on
 * the single connection behind a mutex. Rows come back as positional arrays; drizzle maps
 * them against the column list it already knows.
 */

import { invokeCommand } from '../ipc';
import type { Executor } from './client';

/** The executor the desktop app stores everything through. */
export function tauriExecutor(): Executor {
  return async (sql, params, method) => {
    const result = await invokeCommand<unknown[][] | null>('db_execute', { sql, params, method });
    if (!result.ok) {
      throw new Error(`db_execute failed: ${result.error.message}`);
    }
    // `get` answers with the row itself (or null); `all`/`values` with a list of rows.
    return { rows: result.value };
  };
}
