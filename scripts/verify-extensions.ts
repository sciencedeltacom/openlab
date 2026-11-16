/**
 * Checks the extension runtime.
 *
 * Run with: `bun scripts/verify-extensions.ts`
 *
 * The extension system's failure mode is silence: a manifest parses, the switch says enabled,
 * and the agent never learns the tool exists. These checks pin the properties that matter —
 * the protocol refuses a bad file with every reason, effects are widened by the transport,
 * the workbench refuses a manifest that takes a shipped id or another extension's tool, and
 * an enabled extension's tools reach the model **without** needing a pack to be opened.
 */

import { parseManifest, type ExtensionManifest } from '../src/lib/extensions/protocol';
import {
  extensionCredentialKey,
  extensionTools,
  installExtension,
  removeExtension,
  setExtensionEnabled,
} from '../src/lib/extensions/registry';
import { resolveAssignment, resolveWorkbenchSurface } from '../src/lib/agent/packs';
import { buildSystemPrompt } from '../src/lib/agent/prompt';
import { executeToolCall, type ToolHost } from '../src/lib/agent/registry';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
}

function checkTruthy(label: string, actual: unknown) {
  if (actual) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label} — got ${JSON.stringify(actual)}`);
}

/** A one-tool manifest, tool-only unless `pack` is added. */
function manifest(id: string, tool: string, extra: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    protocol: 'openlab.extension/1',
    id,
    name: id,
    version: '1.0.0',
    tools: [
      {
        id: tool,
        summary: 'A test tool.',
        effects: { readOnly: true, network: false, writes: false, executes: false },
        transport: { kind: 'http', url: 'https://api.example.org/search' },
      },
    ],
    connectors: [],
    credentials: [],
    ...extra,
  };
}

// ── The parser is the trust boundary ─────────────────────────────────────────────────────────

const bad = parseManifest({ protocol: 'nope', id: 'Bad Id', version: '' });
checkTruthy('a bad manifest fails', bad.ok === false);
check(
  'every problem is reported, not the first',
  bad.ok === false ? bad.errors.length >= 4 : 0,
  true,
);

const normalized = parseManifest(manifest('org.test.normalized', 'normalized_tool'));
checkTruthy('a good manifest parses', normalized.ok);
if (normalized.ok) {
  const tool = normalized.manifest.tools?.[0];
  check('an http tool always reaches the network', tool?.effects?.network, true);
  check('an http tool never executes', tool?.effects?.executes, false);
}

const command = parseManifest({
  ...manifest('org.test.command', 'command_tool'),
  tools: [
    {
      id: 'command_tool',
      summary: 'Runs something.',
      transport: { kind: 'command', command: 'echo' },
    },
  ],
});
checkTruthy('a command manifest parses', command.ok);
if (command.ok) {
  const tool = command.manifest.tools?.[0];
  check('a command tool always executes', tool?.effects?.executes, true);
  check('a command tool is never read-only by declaration', tool?.effects?.readOnly, false);
}

// ── The workbench refuses what the file cannot know ──────────────────────────────────────────

const shipped = installExtension(manifest('genomics', 'takes_a_shipped_pack'));
check('a shipped pack id is refused', shipped.ok, false);

const first = installExtension(manifest('org.test.one', 'shared_tool'));
checkTruthy('a tool-only extension installs', first.ok);

const second = installExtension(manifest('org.test.two', 'shared_tool'));
check('a tool id belongs to one extension', second.ok, false);

// ── An enabled extension reaches the surface without a pack ──────────────────────────────────

const surface = resolveWorkbenchSurface({ enabledPacks: [] });
check('a tool-only extension is on the workbench surface', surface.toolIds.includes('shared_tool'), true);
check(
  'the model is told the tool exists',
  buildSystemPrompt({ mode: 'agent', workspace: '/tmp/lab', surface }).includes('shared_tool'),
  true,
);

setExtensionEnabled('org.test.one', false);
check(
  'disabling the extension removes its tool',
  resolveWorkbenchSurface({ enabledPacks: [] }).toolIds.includes('shared_tool'),
  false,
);
setExtensionEnabled('org.test.one', true);

check(
  'the enabled tools are exactly the installed ones',
  extensionTools().map((entry) => entry.tool.id),
  ['shared_tool'],
);

check(
  'a credential gets a scoped vault key',
  extensionCredentialKey('org.test.one', 'api-key'),
  'extension:org.test.one:api-key',
);

// ── An HTTP tool's headers: literals stay here, credentials are named for Rust ────────────────

const http = parseManifest({
  protocol: 'openlab.extension/1',
  id: 'org.test.http',
  name: 'HTTP tool',
  version: '1.0.0',
  credentials: [{ id: 'key', label: 'Key', kind: 'api-key' }],
  tools: [
    {
      id: 'http_tool',
      summary: 'Calls a service.',
      transport: {
        kind: 'http',
        url: 'https://api.example.org/lookup',
        headers: { 'X-Api-Key': '{{credential:key}}', 'X-Plain': 'yes' },
      },
    },
  ],
});
checkTruthy('an http manifest parses', http.ok);
if (http.ok) installExtension(http.manifest);

let fetched: { url: string; options?: { headers?: Record<string, string>; vaultHeaders?: Record<string, string> } } | undefined;
const host: ToolHost = {
  readFile: async () => '',
  writeFile: async () => undefined,
  listDir: async () => [],
  glob: async () => [],
  grep: async () => '',
  runCommand: async () => ({ output: '', exitCode: 0 }),
  fetchUrl: async (url, options) => {
    fetched = { url, options };
    return 'ok';
  },
};
const result = await executeToolCall(
  { id: 'c1', name: 'http_tool', arguments: JSON.stringify({ query: 'crispr' }) },
  { workspace: '/tmp/lab', signal: new AbortController().signal, host },
);
check('the tool ran', result.isError, false);
checkTruthy('the arguments become query parameters', fetched?.url.includes('query=crispr'));
check('a literal header is sent as written', fetched?.options?.headers?.['X-Plain'], 'yes');
check(
  'a credential is named for the vault, never sent as text',
  fetched?.options?.vaultHeaders?.['X-Api-Key'],
  'extension:org.test.http:key',
);
check('the credential placeholder is not a literal header', fetched?.options?.headers?.['X-Api-Key'], undefined);

removeExtension('org.test.http');
removeExtension('org.test.one');

// ── A worker can be handed the extension's pack ─────────────────────────────────────────────

const packed = parseManifest({
  ...manifest('org.test.pack', 'pack_tool'),
  pack: { name: 'Test pack', family: 'Test' },
});
checkTruthy('a pack manifest parses', packed.ok);
if (packed.ok) installExtension(packed.manifest);
check(
  'a worker assigned the pack gets its tool',
  resolveAssignment({ packs: ['org.test.pack'] }, { enabledPacks: [] }).toolIds.includes('pack_tool'),
  true,
);
removeExtension('org.test.pack');
check('removal takes the tool off the surface', resolveWorkbenchSurface({ enabledPacks: [] }).toolIds.includes('shared_tool'), false);

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: manifests are validated, conflicts are refused, and enabled tools reach the model');
