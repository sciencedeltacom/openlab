/**
 * The extension protocol.
 *
 * An extension is a JSON manifest: one file that declares a domain pack, the tools it adds,
 * the connectors it reaches through and the credentials those need. It is the only interface
 * a third party has to know — nothing here imports the runtime, and the runtime imports
 * nothing from a manifest but this shape.
 *
 * Three rules the format encodes:
 *
 *   **Declared, never assumed.** A tool states what it touches (`effects`), and the runtime
 *   grants nothing it did not read. A manifest cannot widen its own permissions.
 *
 *   **Additive.** An extension contributes to the surface a session already has; installing
 *   one never replaces a built-in tool or pack.
 *
 *   **Honest about reach.** A connector that needs a server states how that server runs. If
 *   the workbench cannot start it, the tool says so when called rather than pretending.
 *
 * `parseManifest` is the trust boundary: everything from disk goes through it, and a manifest
 * that fails is reported with the reason rather than half-loaded.
 */

/** The only protocol version this build reads. */
export const PROTOCOL = 'openlab.extension/1';

/** What a tool is allowed to touch. Mirrors the runtime's own `ToolEffects`. */
export interface ExtensionEffects {
  readOnly: boolean;
  network: boolean;
  writes: boolean;
  executes: boolean;
}

/** One argument a tool takes. Enough for the brief and for validation at call time. */
export interface ExtensionField {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  description?: string;
}

/**
 * How a tool runs.
 *
 * `http` is a GET against a service the extension names; `command` runs a program in the
 * workspace with the call's arguments appended; `mcp` hands the call to a declared MCP server.
 * The transport is the whole implementation — there is no code in a manifest.
 */
export type ToolTransport =
  | { kind: 'http'; url: string; headers?: Record<string, string> }
  | { kind: 'command'; command: string; args?: string[] }
  | { kind: 'mcp'; server: string; tool?: string };

export interface ExtensionTool {
  /** The name the model calls. Snake case, unique across the workbench. */
  id: string;
  summary: string;
  effects?: Partial<ExtensionEffects>;
  input?: ExtensionField[];
  transport: ToolTransport;
}

/** A service the extension reaches, and what starting it takes. */
export interface ExtensionConnector {
  id: string;
  name: string;
  summary?: string;
  transport: { kind: 'stdio'; command: string; args?: string[] } | { kind: 'http'; url: string };
  /** Credential ids it reads from the vault. */
  credentials?: string[];
  docsUrl?: string;
}

/** A credential the extension needs. The value is never in the manifest. */
export interface ExtensionCredential {
  id: string;
  label: string;
  kind: 'api-key' | 'token' | 'oauth' | 'none';
  hint?: string;
}

/** The domain pack an extension opens, if it opens one. */
export interface ExtensionPack {
  name: string;
  family: string;
  /** Skill and recipe ids it brings. */
  skills?: string[];
}

export interface ExtensionManifest {
  protocol: typeof PROTOCOL;
  /** Reverse-domain id: `edu.example.biostats`. Unique per workbench. */
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  pack?: ExtensionPack;
  tools?: ExtensionTool[];
  connectors?: ExtensionConnector[];
  credentials?: ExtensionCredential[];
}

/** A manifest that parsed, or the reasons it did not. */
export type ParseResult = { ok: true; manifest: ExtensionManifest } | { ok: false; errors: string[] };

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const TOOL_PATTERN = /^[a-z][a-z0-9_]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Read one tool, reporting every problem with it. */
function readTool(value: unknown, at: string, errors: string[]): ExtensionTool | null {
  if (!isRecord(value)) {
    errors.push(`${at}: a tool must be an object.`);
    return null;
  }
  const id = value.id;
  const summary = value.summary;
  const transport = value.transport;
  let ok = true;
  if (!isText(id) || !TOOL_PATTERN.test(id)) {
    errors.push(`${at}.id: a snake_case name, e.g. count_reads.`);
    ok = false;
  }
  if (!isText(summary)) {
    errors.push(`${at}.summary: one line saying what the tool does.`);
    ok = false;
  }
  if (!isRecord(transport) || !isText(transport.kind)) {
    errors.push(`${at}.transport: one of http, command or mcp.`);
    ok = false;
  } else if (transport.kind === 'http' && !isText(transport.url)) {
    errors.push(`${at}.transport.url: required for an http tool.`);
    ok = false;
  } else if (transport.kind === 'command' && !isText(transport.command)) {
    errors.push(`${at}.transport.command: required for a command tool.`);
    ok = false;
  } else if (transport.kind === 'mcp' && !isText(transport.server)) {
    errors.push(`${at}.transport.server: required for an mcp tool.`);
    ok = false;
  } else if (!['http', 'command', 'mcp'].includes(transport.kind)) {
    errors.push(`${at}.transport.kind: "${String(transport.kind)}" is not http, command or mcp.`);
    ok = false;
  }
  if (!ok) return null;

  const effects = isRecord(value.effects) ? value.effects : {};
  const input = Array.isArray(value.input)
    ? value.input.filter(isRecord).flatMap((field) => {
        if (!isText(field.name) || !isText(field.type)) return [];
        const type = String(field.type);
        if (!['string', 'number', 'boolean'].includes(type)) return [];
        return [
          {
            name: String(field.name),
            type: type as ExtensionField['type'],
            ...(field.required === true ? { required: true } : {}),
            ...(isText(field.description) ? { description: field.description } : {}),
          },
        ];
      })
    : undefined;

  const shape = transport as { kind: string };
  return {
    id: String(id),
    summary: String(summary),
    effects: {
      readOnly: effects.readOnly === true,
      network: effects.network === true || shape.kind === 'http',
      writes: effects.writes === true,
      executes: effects.executes === true || shape.kind === 'command',
    },
    ...(input && input.length > 0 ? { input } : {}),
    transport: transport as ToolTransport,
  };
}

/**
 * Parse a manifest.
 *
 * Every failure is reported, not the first: a manifest is written by hand, and fixing one
 * error only to be told about the next is a bad way to spend an afternoon.
 */
export function parseManifest(value: unknown): ParseResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['The manifest must be a JSON object.'] };
  }
  if (value.protocol !== PROTOCOL) {
    errors.push(`protocol: expected "${PROTOCOL}", found ${JSON.stringify(value.protocol ?? null)}.`);
  }
  if (!isText(value.id) || !ID_PATTERN.test(String(value.id))) {
    errors.push('id: a reverse-domain id such as edu.example.biostats.');
  }
  if (!isText(value.name)) errors.push('name: what the extension is called.');
  if (!isText(value.version)) errors.push('version: a version string, e.g. 1.0.0.');

  const pack = isRecord(value.pack)
    ? isText(value.pack.name) && isText(value.pack.family)
      ? {
          name: String(value.pack.name),
          family: String(value.pack.family),
          skills: Array.isArray(value.pack.skills) ? value.pack.skills.filter(isText).map(String) : [],
        }
      : (errors.push('pack: needs a name and a family.'), undefined)
    : undefined;

  const tools = Array.isArray(value.tools)
    ? value.tools.flatMap((tool, index) => {
        const parsed = readTool(tool, `tools[${index}]`, errors);
        return parsed ? [parsed] : [];
      })
    : [];

  const connectors = Array.isArray(value.connectors)
    ? value.connectors.flatMap((connector, index) => {
        if (
          !isRecord(connector) ||
          !isText(connector.id) ||
          !isText(connector.name) ||
          !isRecord(connector.transport)
        ) {
          errors.push(`connectors[${index}]: needs an id, a name and a transport.`);
          return [];
        }
        const transport = connector.transport;
        if (transport.kind === 'stdio' && !isText(transport.command)) {
          errors.push(`connectors[${index}].transport.command: required for stdio.`);
          return [];
        }
        if (transport.kind === 'http' && !isText(transport.url)) {
          errors.push(`connectors[${index}].transport.url: required for http.`);
          return [];
        }
        if (transport.kind !== 'stdio' && transport.kind !== 'http') {
          errors.push(`connectors[${index}].transport.kind: stdio or http.`);
          return [];
        }
        return [
          {
            id: String(connector.id),
            name: String(connector.name),
            ...(isText(connector.summary) ? { summary: connector.summary } : {}),
            transport: transport as ExtensionConnector['transport'],
            credentials: Array.isArray(connector.credentials)
              ? connector.credentials.filter(isText).map(String)
              : [],
            ...(isText(connector.docsUrl) ? { docsUrl: connector.docsUrl } : {}),
          },
        ];
      })
    : [];

  const credentials = Array.isArray(value.credentials)
    ? value.credentials.flatMap((credential, index) => {
        if (!isRecord(credential) || !isText(credential.id) || !isText(credential.label)) {
          errors.push(`credentials[${index}]: needs an id and a label.`);
          return [];
        }
        const kind = String(credential.kind ?? 'none');
        if (!['api-key', 'token', 'oauth', 'none'].includes(kind)) {
          errors.push(`credentials[${index}].kind: api-key, token, oauth or none.`);
          return [];
        }
        return [
          {
            id: String(credential.id),
            label: String(credential.label),
            kind: kind as ExtensionCredential['kind'],
            ...(isText(credential.hint) ? { hint: credential.hint } : {}),
          },
        ];
      })
    : [];

  if (tools.length === 0 && !pack && connectors.length === 0) {
    errors.push('An extension must contribute something: a pack, a tool or a connector.');
  }

  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.id)) errors.push(`tools: "${tool.id}" is declared twice.`);
    seen.add(tool.id);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    manifest: {
      protocol: PROTOCOL,
      id: String(value.id),
      name: String(value.name),
      version: String(value.version),
      ...(isText(value.description) ? { description: value.description } : {}),
      ...(isText(value.author) ? { author: value.author } : {}),
      ...(isText(value.homepage) ? { homepage: value.homepage } : {}),
      ...(pack ? { pack } : {}),
      tools,
      connectors,
      credentials,
    },
  };
}

/** What an extension brings, as a line a reader can check at a glance. */
export function describeExtension(manifest: ExtensionManifest): string[] {
  const parts: string[] = [];
  if (manifest.pack) parts.push(`pack “${manifest.pack.name}”`);
  if (manifest.tools?.length)
    parts.push(`${manifest.tools.length} tool${manifest.tools.length === 1 ? '' : 's'}`);
  if (manifest.connectors?.length)
    parts.push(`${manifest.connectors.length} connector${manifest.connectors.length === 1 ? '' : 's'}`);
  if (manifest.credentials?.length)
    parts.push(`${manifest.credentials.length} credential${manifest.credentials.length === 1 ? '' : 's'}`);
  return parts;
}

/** The permissions an extension's tools add up to, for the install list. */
export function extensionPermissions(manifest: ExtensionManifest): string[] {
  const granted = new Set<string>();
  for (const tool of manifest.tools ?? []) {
    if (tool.effects?.network) granted.add('network');
    if (tool.effects?.writes) granted.add('writes files');
    if (tool.effects?.executes) granted.add('runs programs');
  }
  for (const connector of manifest.connectors ?? []) {
    granted.add(
      connector.transport.kind === 'http'
        ? `network: ${connector.transport.url}`
        : `declares ${connector.transport.command}`,
    );
  }
  if (granted.size === 0) return ['reads only'];
  return [...granted];
}

/** A one-tool manifest, as the skeleton for "New tool". */
export const TOOL_SKELETON = `{
  "protocol": "${PROTOCOL}",
  "id": "edu.example.my-tool",
  "name": "My tool",
  "version": "0.1.0",
  "description": "What this tool is for, in one line.",
  "tools": [
    {
      "id": "my_tool",
      "summary": "One line the model reads to decide when to reach for it.",
      "effects": { "readOnly": true, "network": true },
      "input": [
        { "name": "query", "type": "string", "required": true, "description": "What to look up" }
      ],
      "transport": { "kind": "http", "url": "https://example.edu/api/lookup" }
    }
  ]
}`;

/** A one-connector manifest, as the skeleton for "New connector". */
export const CONNECTOR_SKELETON = `{
  "protocol": "${PROTOCOL}",
  "id": "edu.example.my-connector",
  "name": "My connector",
  "version": "0.1.0",
  "description": "What this connector reaches, and what starting it takes.",
  "credentials": [{ "id": "my-connector-key", "label": "My connector key", "kind": "api-key" }],
  "connectors": [
    {
      "id": "my-connector",
      "name": "My connector",
      "summary": "A short line about the service.",
      "transport": { "kind": "http", "url": "https://api.example.org" },
      "credentials": ["my-connector-key"],
      "docsUrl": "https://example.org/docs"
    }
  ],
  "tools": [
    {
      "id": "my_connector_search",
      "summary": "Search the service through this connector.",
      "effects": { "readOnly": true, "network": true },
      "transport": {
        "kind": "http",
        "url": "https://api.example.org/search",
        "headers": { "Authorization": "{{credential:my-connector-key}}" }
      }
    }
  ]
}`;

/** A manifest to start from, shown wherever an extension is installed by hand. */
export const EXAMPLE_MANIFEST = `{
  "protocol": "${PROTOCOL}",
  "id": "edu.example.biostats",
  "name": "Biostatistics helpers",
  "version": "1.0.0",
  "description": "Effect sizes and a normality check, over the local R install.",
  "pack": { "name": "Biostatistics", "family": "Modelling & statistics", "skills": ["recipe-power-analysis"] },
  "credentials": [{ "id": "r-api", "label": "Local R service", "kind": "token" }],
  "connectors": [
    {
      "id": "r-service",
      "name": "R service",
      "transport": { "kind": "http", "url": "https://api.example.org" },
      "credentials": ["r-api"]
    }
  ],
  "tools": [
    {
      "id": "effect_size",
      "summary": "Cohen's d and Hedges' g for two groups, with a confidence interval.",
      "effects": { "readOnly": true, "network": true },
      "input": [
        { "name": "treated", "type": "number", "required": true, "description": "Mean of the treated arm" },
        { "name": "control", "type": "number", "required": true, "description": "Mean of the control arm" },
        { "name": "sd", "type": "number", "required": true, "description": "Pooled standard deviation" }
      ],
      "transport": {
        "kind": "http",
        "url": "https://api.example.org/effect-size",
        "headers": { "Authorization": "{{credential:r-api}}" }
      }
    }
  ]
}`;
