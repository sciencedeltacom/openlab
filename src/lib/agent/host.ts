/**
 * The real tool host.
 *
 * Every executor call lands here and becomes a Tauri command, which is what keeps process and
 * filesystem access on the Rust side of the boundary rather than in the webview. The workspace
 * root travels with each call so the backend can refuse a path outside it — the model proposes
 * a path, it does not get to choose the boundary.
 *
 * Errors are thrown, not returned: an executor wraps its call in `guard`, so a refusal becomes
 * a readable tool result instead of an exception that ends the turn.
 */

import { invokeCommand } from '@/lib/ipc';
import { executionPayload, type ExecutionSettings } from '@/lib/execution';
import type { ToolHost } from './registry';

/** Run a command, throwing the backend's own message when it fails. */
async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const result = await invokeCommand<T>(command, args);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

/** Build a host whose every path is resolved inside `root`, running commands in `execution`. */
export function createToolHost(root: string, execution?: ExecutionSettings): ToolHost {
  return {
    readFile: (path) => call<string>('read_file', { path, root }),
    writeFile: async (path, contents) => {
      await call<null>('write_file', { path, contents, root });
    },
    listDir: (path) => call<{ name: string; path: string; isDir: boolean }[]>('list_dir', { path, root }),
    glob: (pattern, path) => call<string[]>('glob_files', { pattern, root, path: path ?? null }),
    grep: (pattern, options) =>
      call<string>('grep_files', {
        pattern,
        root,
        path: options.path ?? null,
        glob: options.glob ?? null,
      }),
    runCommand: (command, cwd) =>
      call<{ output: string; exitCode: number }>('run_command', {
        command,
        cwd: cwd ?? null,
        root,
        execution: execution ? executionPayload(execution) : null,
      }),
    mcpCall: async (server, tool, arguments_) => {
      const result = await call<{ text: string; isError: boolean }>('mcp_call', {
        server,
        tool,
        arguments: arguments_,
      });
      return result;
    },
    fetchUrl: (url, options) =>
      call<string>('fetch_url', {
        url,
        headers: options?.headers ?? null,
        vaultHeaders: options?.vaultHeaders ?? null,
      }),
  };
}
