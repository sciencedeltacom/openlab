/**
 * The MCP servers this build can start.
 *
 * Rust owns the processes and the JSON-RPC; this module is the small client the interface and
 * the agent read. A server is started deliberately — by the reader on the servers page, or by
 * a worker that needs it — and its tools join the surface while it runs.
 */

import { invokeCommand, isDesktop } from '@/lib/ipc';
import { clearMcpTools, setMcpTools, type McpRawTool } from './registry';

/** What one server reports about itself. */
export interface McpServerStatus {
  server: string;
  running: boolean;
  tools: string[];
  /** Where the program was found, when it was. */
  binary: string | null;
  /** The command that installs it, when this build can offer one. */
  install: string | null;
  /** What the machine has to have for it to run. */
  requires: string;
  error?: string;
}

/** Every server this build knows, running or not. */
export async function listServers(): Promise<McpServerStatus[]> {
  if (!isDesktop()) return [];
  const result = await invokeCommand<McpServerStatus[]>('mcp_status', {});
  if (!result.ok) return [];
  return result.value;
}

/** One server's row, or undefined when it is not a server this build knows. */
export async function serverStatus(id: string): Promise<McpServerStatus | undefined> {
  return (await listServers()).find((row) => row.server === id);
}

/** Adopt the tools a running server advertises. */
async function adopt(id: string): Promise<void> {
  const listed = await invokeCommand<McpRawTool[]>('mcp_list_tools', { server: id });
  if (listed.ok) {
    setMcpTools(id, listed.value);
  }
}

/** Start a server against a workspace and adopt its tools. */
export async function startServer(id: string, root: string): Promise<{ ok: boolean; error?: string }> {
  if (!isDesktop()) {
    return { ok: false, error: 'MCP servers run in the desktop app.' };
  }
  if (!root) {
    return { ok: false, error: 'Open a workspace folder first: a server indexes the project it works on.' };
  }
  const started = await invokeCommand<{ tools: string[] }>('mcp_start', { server: id, root });
  if (!started.ok) {
    return { ok: false, error: started.error.message };
  }
  await adopt(id);
  return { ok: true };
}

/** Stop a server and forget its tools. */
export async function stopServer(id: string): Promise<void> {
  clearMcpTools(id);
  if (!isDesktop()) return;
  await invokeCommand('mcp_stop', { server: id });
}

/** Install a server this build knows how to install. */
export async function installServer(id: string): Promise<{ ok: boolean; error?: string; output?: string }> {
  if (!isDesktop()) {
    return { ok: false, error: 'MCP servers run in the desktop app.' };
  }
  const result = await invokeCommand<string>('mcp_install', { server: id });
  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, output: result.value };
}

/**
 * Make sure a server is running, for a worker that needs it.
 *
 * The worker's tools only exist once the server has answered `tools/list`, so the dispatch
 * starts it first and reports a failure in the handoff rather than handing the worker an empty
 * toolkit.
 */
export async function ensureServer(id: string, root: string): Promise<{ ok: boolean; error?: string }> {
  const status = await serverStatus(id);
  if (status?.running) {
    // A restarted app has the tools in Rust but not in this module's registry.
    await adopt(id);
    return { ok: true };
  }
  return startServer(id, root);
}
