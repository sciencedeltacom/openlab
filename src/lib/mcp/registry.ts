/**
 * The tools a running MCP server offers.
 *
 * Serena's tools are discovered at start, not written down here: the server is the source of
 * truth, and a new Serena release adds tools without an openlab change. Each one is mapped to
 * the shape the runtime already reads, so an MCP tool is gated, briefed and drawn exactly like
 * a built-in one.
 *
 * Effects are classified from the tool's name, conservatively: anything that is not clearly a
 * read is treated as a write, so the permission gate asks before a tool that edits code runs.
 */

import { useSyncExternalStore } from 'react';

import type { ToolEffects } from '@/lib/agent/tools';

/** One tool a server advertises. */
export interface McpToolDef {
  server: string;
  /** The name the server knows it by, e.g. `find_symbol`. */
  name: string;
  description: string;
  /** The JSON Schema the server published for the arguments. */
  inputSchema: Record<string, unknown>;
  effects: ToolEffects;
}

/** The shape `tools/list` answers with, as far as this app reads it. */
export interface McpRawTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

let tools: McpToolDef[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** The id the model calls: the server's namespace plus the tool's own name. */
export function mcpToolId(server: string, name: string): string {
  return `${server}_${name}`;
}

/** Names that only read. Anything else is treated as a write, which asks before it runs. */
const READ_PREFIXES = [
  'get_',
  'find_',
  'list_',
  'search_',
  'read_',
  'symbol_overview',
  'initial_instructions',
  'check_',
  'onboarding',
];

/** What a tool touches, judged from its name. */
export function classifyEffects(name: string): ToolEffects {
  const readOnly = READ_PREFIXES.some(
    (prefix) => name === prefix.replace(/_$/, '') || name.startsWith(prefix),
  );
  return {
    readOnly,
    network: false,
    // The server runs in this process's child, not as a shell command; nothing here is a
    // general-purpose execution.
    executes: false,
    writes: !readOnly,
  };
}

/** Adopt one server's tools, replacing whatever it advertised before. */
export function setMcpTools(server: string, raw: readonly McpRawTool[]): void {
  const mapped: McpToolDef[] = raw
    .filter((tool) => typeof tool.name === 'string' && tool.name.trim().length > 0)
    .map((tool) => ({
      server,
      name: tool.name,
      description: tool.description?.trim() || `${tool.name} (from ${server})`,
      inputSchema:
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {}, additionalProperties: true },
      effects: classifyEffects(tool.name),
    }));
  tools = [...tools.filter((tool) => tool.server !== server), ...mapped];
  emit();
}

/** Forget one server's tools, when it stops. */
export function clearMcpTools(server: string): void {
  tools = tools.filter((tool) => tool.server !== server);
  emit();
}

/** Every tool a running server offers. */
export function mcpTools(): McpToolDef[] {
  return tools;
}

/** The ids, for the surfaces that only need names. */
export function mcpToolIds(): string[] {
  return tools.map((tool) => mcpToolId(tool.server, tool.name));
}

/** One tool by the id the model calls. */
export function findMcpTool(id: string): McpToolDef | undefined {
  return tools.find((tool) => mcpToolId(tool.server, tool.name) === id);
}

/** The tools, live, for a component that lists them. */
export function useMcpTools(): McpToolDef[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => tools,
  );
}
