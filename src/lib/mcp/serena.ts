/**
 * Serena, as the coding worker uses it.
 *
 * The generic client in `client.ts` does the work; this is the name the engine and the servers
 * page call for the one server the coding worker needs.
 */

import { ensureServer, serverStatus, startServer, stopServer, type McpServerStatus } from './client';

/** The server id Rust knows. */
export const SERENA = 'serena';

/** Start Serena against a workspace, and adopt the tools it offers. */
export function startSerena(root: string): Promise<{ ok: boolean; error?: string }> {
  return startServer(SERENA, root);
}

/** Stop Serena and forget its tools. */
export function stopSerena(): Promise<void> {
  return stopServer(SERENA);
}

/** What Serena is doing, and where its binary is. */
export async function serenaStatus(): Promise<McpServerStatus> {
  return (
    (await serverStatus(SERENA)) ?? {
      server: SERENA,
      running: false,
      tools: [],
      binary: null,
      install: null,
      requires: '',
    }
  );
}

/** Make sure Serena is running, for a worker that needs it. */
export function ensureSerena(root: string): Promise<{ ok: boolean; error?: string }> {
  return ensureServer(SERENA, root);
}
