/**
 * Tools section screens.
 *
 * The tool surface of the lab, read from the runtime rather than retyped: every tool the agent
 * actually has comes from the inventory, every connector from the MCP declarations and the
 * installed extensions, and every credential from the vault. A detail page therefore says what
 * a tool really does — its arguments, what it may touch, and which pack opens it — instead of
 * describing a capability the workbench does not have.
 *
 * Writing a tool or a connector ends in the same place: a manifest. The two create actions open
 * the extension installer with a skeleton for one tool or one connector, because that is the
 * only door into the runtime, and a second one would drift.
 */

import { useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui';
import { InstallDialog } from '@/components/extensions/ExtensionsScreen';
import type { CatalogEntry, DataScreenSpec, DocScreenSpec, ScreenSpec } from '@/components/screens/spec';
import type { RouteId } from '@/app/routes';
import { MCP_SERVERS } from '@/lib/agent/mcp';
import { allPacks, findPack } from '@/lib/agent/packs';
import { specFor } from '@/lib/agent/spec';
import { allTools, type AgentTool } from '@/lib/agent/tools';
import { CONNECTOR_SKELETON, TOOL_SKELETON } from '@/lib/extensions/protocol';
import { extensionConnectors } from '@/lib/extensions/registry';
import { SCIENCE_CONNECTORS, type ScienceConnector } from '@/lib/science/connectors';

/* ================================================================================================
 * tools/catalog
 * ============================================================================================== */

/** The effects of a tool, in the words a reader checks them by. */
function effectLines(tool: AgentTool): string[] {
  const effects = tool.effects;
  const lines: string[] = [];
  if (effects.readOnly) lines.push('reads only');
  if (effects.writes) lines.push('writes files');
  if (effects.network) lines.push('reaches the network');
  if (effects.executes) lines.push('runs programs');
  return lines.length > 0 ? lines : ['no effects declared'];
}

/** The arguments a tool takes, from the schema the model is given. */
function argumentsOf(id: string): { name: string; type: string; description: string; required: boolean }[] {
  const parameters = specFor(id).parameters as {
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
  const required = new Set(parameters.required ?? []);
  return Object.entries(parameters.properties ?? {}).map(([name, field]) => ({
    name,
    type: field.type ?? 'any',
    description: field.description ?? '',
    required: required.has(name),
  }));
}

/** Where a tool comes from, and who gets it. */
function originOf(tool: AgentTool): { group: string; detail: string } {
  if (tool.scope === 'core') {
    return { group: 'Core', detail: 'Every session has this tool, subject to the permission gate.' };
  }
  const pack = findPack(tool.scope);
  return {
    group: pack ? pack.name : tool.scope,
    detail: pack
      ? `Sessions with the ${pack.name} pack open.`
      : `Sessions with the ${tool.scope} extension enabled.`,
  };
}

/** One entry per tool the runtime has, built-ins and installed alike. */
function toolEntry(tool: AgentTool): CatalogEntry {
  const origin = originOf(tool);
  const args = argumentsOf(tool.id);
  const effects = effectLines(tool);
  return {
    id: tool.id,
    name: tool.name,
    summary: tool.summary,
    group: origin.group,
    tags: effects,
    meta: [`${args.length} argument${args.length === 1 ? '' : 's'}`],
    detail: [
      { label: 'Call it', value: <span className="font-mono text-meta text-foreground">{tool.name}</span> },
      { label: 'Where from', value: <span className="text-body text-foreground">{origin.detail}</span> },
      { label: 'Effects', value: <span className="text-body text-foreground">{effects.join(', ')}</span> },
      {
        label: 'Arguments',
        value:
          args.length === 0 ? (
            <span className="text-muted">None.</span>
          ) : (
            <ul className="flex flex-col gap-2">
              {args.map((argument) => (
                <li key={argument.name} className="flex flex-col gap-0.5">
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-meta text-foreground">{argument.name}</span>
                    <span className="text-[11px] text-muted">{argument.type}</span>
                    {argument.required && <span className="text-[11px] text-warning">required</span>}
                  </span>
                  {argument.description && (
                    <span className="text-meta text-muted">{argument.description}</span>
                  )}
                </li>
              ))}
            </ul>
          ),
      },
    ],
  };
}

/** Every tool the runtime has, built on demand so an installed extension appears at once. */
function toolEntries(): CatalogEntry[] {
  return allTools().map(toolEntry);
}

/** Open the installer with a one-tool manifest already in the box. */
function NewToolAction() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" className="gap-1.5" onPress={() => setOpen(true)}>
        <Plus className="size-3.5" />
        New tool
      </Button>
      <InstallDialog open={open} onClose={() => setOpen(false)} initial={TOOL_SKELETON} />
    </>
  );
}

/* ================================================================================================
 * tools/connectors
 * ============================================================================================== */

/** The brand mark for an MCP server, where the server has a brand of its own. */
const MCP_ICONS: Record<string, string> = { zotero: 'zotero' };

/** The brand mark for a public research API, where the service has one. */
const SCIENCE_ICONS: Record<string, string> = { pubmed: 'pubmed', arxiv: 'arxiv' };

/** One MCP server, as a catalogue entry. */
function mcpEntry(server: (typeof MCP_SERVERS)[number]): CatalogEntry {
  const allowedBy = allPacks()
    .filter((pack) => pack.mcps.includes(server.id))
    .map((pack) => pack.name);
  return {
    id: `mcp-${server.id}`,
    name: server.name,
    icon: MCP_ICONS[server.id],
    summary: server.summary,
    group: 'MCP servers',
    tags: [server.transport.kind],
    // Startable servers are started by the reader on the MCP servers page; an HTTP endpoint
    // stays a reference. Neither label claims a server is running.
    status: server.startable ? { label: 'startable', tone: 'ok' } : { label: 'reference', tone: 'warn' },
    meta: [`needs ${server.requires.length} thing${server.requires.length === 1 ? '' : 's'}`],
    href: server.docsUrl,
    detail: [
      {
        label: 'Transport',
        value: (
          <span className="font-mono text-meta text-foreground">
            {server.transport.kind === 'stdio'
              ? `${server.transport.command} ${server.transport.args.join(' ')}`
              : server.transport.url}
          </span>
        ),
      },
      {
        label: 'State',
        value: (
          <span className="text-body text-foreground">
            Reference only. openlab states how it would run and does not launch it; the agent is told the
            server is not available.
          </span>
        ),
      },
      {
        label: 'Needs',
        value: <span className="text-body text-foreground">{server.requires.join(' · ')}</span>,
      },
      {
        label: 'Allowed by',
        value: (
          <span className="text-body text-foreground">
            {allowedBy.length > 0 ? allowedBy.join(', ') : 'No pack allows it.'}
          </span>
        ),
      },
    ],
  };
}

/** One public science API, as a catalogue entry. */
function scienceEntry(connector: ScienceConnector): CatalogEntry {
  return {
    id: `api-${connector.id}`,
    name: connector.label,
    icon: SCIENCE_ICONS[connector.id],
    summary: connector.summary,
    group: 'Public research APIs',
    tags: [connector.category, 'no key'],
    meta: [connector.attribution.split('(')[0]!.trim()],
    href: connector.docsUrl,
    detail: [
      { label: 'Kind', value: <span className="text-body text-foreground">{connector.category}</span> },
      { label: 'Access', value: <span className="text-body text-foreground">No key required.</span> },
      {
        label: 'Attribution',
        value: <span className="text-body text-foreground">{connector.attribution}</span>,
      },
      {
        label: 'Docs',
        value: (
          <a href={connector.docsUrl} target="_blank" rel="noreferrer" className="text-accent">
            {connector.docsUrl}
          </a>
        ),
      },
    ],
  };
}

/** One connector an installed extension declared. */
function extensionConnectorEntry(entry: ReturnType<typeof extensionConnectors>[number]): CatalogEntry {
  const { connector, extensionId } = entry;
  const transport = connector.transport;
  return {
    id: `ext-${extensionId}-${connector.id}`,
    name: connector.name,
    summary: connector.summary ?? `Declared by the ${extensionId} extension.`,
    group: 'Extension connectors',
    tags: [transport.kind],
    // A connector is a declaration. Nothing in this build starts one, so the row must not
    // borrow a runtime state from the manifest that claimed it.
    status: { label: 'declared', tone: 'warn' },
    meta: [`from ${extensionId}`],
    ...(connector.docsUrl ? { href: connector.docsUrl } : {}),
    detail: [
      {
        label: 'Transport',
        value: (
          <span className="font-mono text-meta text-foreground">
            {transport.kind === 'stdio'
              ? `${transport.command} ${(transport.args ?? []).join(' ')}`
              : transport.url}
          </span>
        ),
      },
      { label: 'From', value: <span className="font-mono text-meta text-foreground">{extensionId}</span> },
      {
        label: 'Credentials',
        value: (
          <span className="text-body text-foreground">
            {connector.credentials && connector.credentials.length > 0
              ? connector.credentials.join(', ')
              : 'None.'}
          </span>
        ),
      },
    ],
  };
}

/** The connectors: what openlab can reach, declared or installed. */
function connectorEntries(): CatalogEntry[] {
  return [
    ...MCP_SERVERS.map(mcpEntry),
    ...extensionConnectors().map(extensionConnectorEntry),
    ...SCIENCE_CONNECTORS.map(scienceEntry),
  ];
}

/** Open the installer with a one-connector manifest already in the box. */
function NewConnectorAction() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" className="gap-1.5" onPress={() => setOpen(true)}>
        <Plus className="size-3.5" />
        New connector
      </Button>
      <InstallDialog open={open} onClose={() => setOpen(false)} initial={CONNECTOR_SKELETON} />
    </>
  );
}

/* ================================================================================================
 * tools/credentials
 * ============================================================================================== */

/** Saved service credentials and their state. Values are never held by the webview. */
const CREDENTIALS_SCREEN: DataScreenSpec = {
  kind: 'data',
  stats: [
    { label: 'Storage', value: 'credential vault' },
    { label: 'Read by', value: 'Rust only' },
  ],
  columns: [
    { key: 'service', label: 'Service' },
    { key: 'scope', label: 'Scope' },
    { key: 'kind', label: 'Kind' },
    { key: 'storage', label: 'Storage' },
    { key: 'state', label: 'State' },
  ],
  rows: [
    {
      service: 'Model providers',
      scope: 'Chat, tool use and embeddings for the session model',
      kind: 'API key',
      storage: 'credential vault',
      state: 'per provider',
    },
    {
      service: 'Extension connectors',
      scope: 'Whatever an installed extension declared it needs',
      kind: 'API key or token',
      storage: 'credential vault',
      state: 'per extension',
    },
  ],
};

/* ================================================================================================
 * tools/custom
 * ============================================================================================== */

/** How to add a small typed operation the agent can call. */
const CUSTOM_TOOL_DOC: DocScreenSpec = {
  kind: 'doc',
  sections: [
    {
      id: 'why-narrow',
      title: 'Why a narrow tool beats a broad one',
      body: [
        'A broad tool (run any shell command, edit any file) moves the decision to the model at run time. That is useful once, and unreviewable forever after: the transcript says "ran a command", not what was allowed.',
        'A narrow tool encodes one operation with one contract. The model chooses when to call it, not what it means. Reviewers can read the definition, the permission set is enforced by the runtime rather than by prompt text, and the output shape is stable enough to test.',
      ],
      bullets: [
        'One operation per tool. If the description needs an "or", it is two tools.',
        'Typed inputs and outputs: the runtime validates both, so a malformed call fails before anything runs.',
        'Declare permissions, not intentions. A tool that needs no network cannot reach one, whatever the model asks.',
        'Return facts, not prose. Numbers and paths go into the output; the model writes the sentence.',
        'Name it the way a colleague would say it: count_reads, not execute_utility.',
      ],
    },
    {
      id: 'shape',
      title: 'The shape of a definition',
      body: [
        'A tool is a manifest under `.openlab/extensions/`, installed from Extensions. One file declares the pack it opens, the tools it adds and how each one runs; the registry loads every manifest in that directory at session start. There is no build step and no dependency on the openlab internals.',
        'The same file is what "New tool" on the catalogue writes, which is why there is one door into the runtime rather than two.',
      ],
      code: {
        language: 'json',
        source: `// .openlab/extensions/count-reads.json
{
  "protocol": "openlab.extension/1",
  "id": "edu.example.read-counts",
  "name": "Read counts",
  "version": "1.0.0",
  "tools": [
    {
      "id": "count_reads",
      "summary": "Count primary alignments per reference from a coordinate-sorted BAM. Read-only.",
      "effects": { "readOnly": true, "executes": true },
      "input": [
        { "name": "bam", "type": "string", "required": true, "description": "Path to a coordinate-sorted BAM" }
      ],
      "transport": { "kind": "command", "command": "samtools", "args": ["idxstats"] }
    }
  ]
}`,
      },
    },
    {
      id: 'io',
      title: 'Inputs and outputs',
      body: [
        'Inputs are declared in the manifest and validated before the transport runs. A call that fails validation never reaches the service, and the model receives the validation error as the tool result.',
        'Return plain text: the model reads it directly. For anything large, write a file and return its path instead.',
      ],
      table: {
        columns: ['Part', 'Rule', 'Example'],
        rows: [
          ['input', 'name, type, required, description', 'bam: string (required)'],
          [
            'summary',
            'One sentence; says what it does and what it cannot do',
            'no writes; refuses CRAM without a reference',
          ],
          ['effects', 'readOnly / network / writes / executes', 'readOnly, executes'],
          ['transport', 'http, command or mcp', 'command: samtools idxstats'],
          ['errors', 'Say what happened in the tool result', 'not a coordinate-sorted BAM'],
        ],
      },
    },
    {
      id: 'permissions',
      title: 'Permissions',
      body: [
        'The effects block is enforced by the runtime, not by the prompt. If a tool declares no network, a call that tries to open a socket fails. A command tool runs only when the session has allowed programs to run.',
        'Declare the narrowest set that works, and expect to be asked the first time.',
      ],
      table: {
        columns: ['Effect', 'Means', 'Default when omitted'],
        rows: [
          ['readOnly', 'changes nothing anywhere', 'false'],
          ['network', 'reaches a host', 'true for an http transport'],
          ['writes', 'changes files in the workspace', 'false'],
          ['executes', 'runs a program', 'true for a command transport'],
        ],
      },
    },
    {
      id: 'test',
      title: 'Before you install it',
      body: [
        'Read the manifest as a reviewer would: is the summary honest about what it cannot do, does the effect set match the transport, and does every required argument have a description a model can act on?',
        'Then install it, enable it, and call it from a session once. A tool that has never been called is a claim, not a capability.',
      ],
    },
  ],
};

/* ================================================================================================
 * Export
 * ============================================================================================== */

/**
 * The live tool and connector catalogues.
 *
 * Built when the screen renders rather than at module load: an extension installed in this
 * session, or loaded from the workspace after startup, is on the page immediately. The static
 * part below holds the pages whose content is a document rather than a list.
 */
export function toolCatalogScreens(): Partial<Record<RouteId, ScreenSpec>> {
  return {
    'tools/catalog': {
      kind: 'catalog',
      facetLabel: 'Scope',
      columns: 3,
      records: { noun: 'Tool' },
      actions: <NewToolAction />,
      entries: toolEntries(),
      empty: 'No tools. The inventory is the runtime’s own list, so this should not be empty.',
    },
    'tools/connectors': {
      kind: 'catalog',
      facetLabel: 'Kind',
      columns: 3,
      records: { noun: 'Connector' },
      actions: <NewConnectorAction />,
      entries: connectorEntries(),
      empty: 'No connectors configured.',
    },
  };
}

/** The tools pages whose content is a document. */
export const toolScreens: Partial<Record<RouteId, ScreenSpec>> = {
  'tools/credentials': CREDENTIALS_SCREEN,
  'tools/custom': CUSTOM_TOOL_DOC,
};
