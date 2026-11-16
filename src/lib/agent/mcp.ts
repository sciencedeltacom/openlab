/**
 * The MCP servers openlab knows about.
 *
 * These are **references**: a pack names the servers its work would use, and this catalogue
 * states how one would run and what it needs. This build does not launch an MCP server, and
 * the model is told so — a server listed as present would be a capability the agent believes
 * it has and the user cannot see. Starting one is a separate piece of work; until then the
 * honest answer is the transport and the requirement, not a promise.
 */

/** Identifiers of the MCP servers the workbench can describe. */
export type McpServerId = 'delphi' | 'zotero' | 'ohdsi';

/** How a server is reached. */
export type McpTransport =
  /** A process the workbench starts and talks to over stdin/stdout. */
  | { kind: 'stdio'; command: string; args: string[] }
  /** A running HTTP endpoint. */
  | { kind: 'http'; url: string };

/** One MCP server a pack can allow. */
export interface McpServer {
  id: McpServerId;
  name: string;
  summary: string;
  transport: McpTransport;
  /** Executables, credentials or services the server needs before it can start. */
  requires: readonly string[];
  /**
   * True when this build can start it: a stdio server with a program the client knows how to
   * run. An HTTP endpoint is a reference, because this build speaks only stdio.
   */
  startable: boolean;
  docsUrl: string;
}

/** Local retrieval over repositories, papers and datasets. */
const delphi: McpServer = {
  id: 'delphi',
  name: 'Delphi',
  summary: 'Local search over code, papers and datasets, with a versioned snapshot per hit.',
  transport: { kind: 'stdio', command: 'npx', args: ['-y', '@synsci/delphi-proxy'] },
  requires: ['Docker for the index stack', 'an embedding provider'],
  startable: true,
  docsUrl: 'https://github.com/synthetic-sciences/delphi',
};

/** Reference-manager library and metadata. */
const zotero: McpServer = {
  id: 'zotero',
  name: 'Zotero',
  summary: 'Read a reference library and attach citations from it.',
  transport: { kind: 'stdio', command: 'npx', args: ['-y', 'zotero-mcp'] },
  requires: ['a Zotero API key', 'a library id'],
  startable: true,
  docsUrl: 'https://www.zotero.org',
};

/** OMOP cohort tools. */
const ohdsi: McpServer = {
  id: 'ohdsi',
  name: 'OHDSI',
  summary: 'Cohort definition and OMOP vocabulary lookups for registry work.',
  transport: { kind: 'http', url: 'http://127.0.0.1:8080/mcp' },
  requires: ['a local OMOP CDM instance'],
  startable: false,
  docsUrl: 'https://www.ohdsi.org',
};

/** Every server, keyed for lookup and ordered for display. */
export const MCP_SERVERS: readonly McpServer[] = [delphi, zotero, ohdsi];

/** Look a server up by id. */
export function findMcpServer(id: McpServerId): McpServer | undefined {
  return MCP_SERVERS.find((server) => server.id === id);
}
