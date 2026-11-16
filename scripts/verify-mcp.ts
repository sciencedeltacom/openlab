/**
 * Checks the MCP tool bridge.
 *
 * Run with: `bun scripts/verify-mcp.ts`
 *
 * A server's tools are discovered at start, so the checks are about the translation: the id
 * the model calls, the effects the gate reads, the schema the loop validates against, and the
 * fact that a stopped server leaves nothing behind. The process itself is covered by the Rust
 * client's own test.
 */

import { allTools, findTool } from '../src/lib/agent/tools';
import { specFor } from '../src/lib/agent/spec';
import { resolveAssignment, resolveWorkbenchSurface } from '../src/lib/agent/packs';
import { resolveSubagent } from '../src/lib/agent/subagents';
import { executeToolCall, type ToolContext, type ToolHost } from '../src/lib/agent/registry';
import {
  classifyEffects,
  clearMcpTools,
  findMcpTool,
  mcpToolId,
  mcpToolIds,
  setMcpTools,
} from '../src/lib/mcp/registry';

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

// ── The classification the permission gate reads ────────────────────────────────────────────

check('a read tool is read-only', classifyEffects('find_symbol').readOnly, true);
check('and does not write', classifyEffects('find_symbol').writes, false);
check('an overview reads', classifyEffects('get_symbols_overview').readOnly, true);
check('an edit writes', classifyEffects('replace_symbol_body').writes, true);
check('and is not read-only', classifyEffects('replace_symbol_body').readOnly, false);
check('an unknown name is treated as a write', classifyEffects('do_something_clever').writes, true);
check('nothing here claims to run a process', classifyEffects('replace_symbol_body').executes, false);

check('the id is namespaced by the server', mcpToolId('serena', 'find_symbol'), 'serena_find_symbol');

// ── A running server's tools join the inventory ─────────────────────────────────────────────

const schema = {
  type: 'object',
  properties: { name_path: { type: 'string' }, depth: { type: 'number' } },
  required: ['name_path'],
  additionalProperties: false,
};

setMcpTools('serena', [
  { name: 'find_symbol', description: 'Find a symbol by name path.', inputSchema: schema },
  { name: 'replace_symbol_body', description: 'Replace a symbol body.' },
]);

check('the tools are known', mcpToolIds().sort(), ['serena_find_symbol', 'serena_replace_symbol_body']);
checkTruthy('the inventory has them', allTools().some((tool) => tool.id === 'serena_find_symbol'));
check('and the effects come through', findTool('serena_find_symbol')?.effects.writes, false);
check('a write tool is marked', findTool('serena_replace_symbol_body')?.effects.writes, true);
check('the server published the schema', specFor('serena_find_symbol').parameters, schema);
check(
  'a tool without a schema gets a permissive one',
  (specFor('serena_replace_symbol_body').parameters as { additionalProperties?: boolean }).additionalProperties,
  true,
);
checkTruthy(
  'the workbench surface includes a running server',
  resolveWorkbenchSurface({ enabledPacks: [] }).toolIds.includes('serena_find_symbol'),
);

// ── A worker can be given exactly one of them ───────────────────────────────────────────────

const handpicked = resolveAssignment({ packs: [], tools: ['serena_find_symbol'] }, { enabledPacks: [] });
check('a named MCP tool is the whole assignment', handpicked.toolIds, ['serena_find_symbol']);
check('and nothing is reported missing', handpicked.missingTools, []);

const coding = resolveSubagent('coding', { enabledPacks: [] });
check('the coding worker gets the server tools by default', coding.toolIds.sort(), [
  'serena_find_symbol',
  'serena_replace_symbol_body',
]);
checkTruthy('and cannot re-delegate', !coding.toolIds.includes('task'));

// ── The call goes through the host ──────────────────────────────────────────────────────────

const host = (withMcp: boolean): ToolHost => ({
  readFile: async () => '',
  writeFile: async () => undefined,
  listDir: async () => [],
  glob: async () => [],
  grep: async () => '',
  runCommand: async () => ({ output: '', exitCode: 0 }),
  fetchUrl: async () => '',
  ...(withMcp
    ? {
        mcpCall: async (server: string, tool: string) => ({
          text: `${server}:${tool} ok`,
          isError: false,
        }),
      }
    : {}),
});

const context = (withMcp: boolean): ToolContext => ({
  workspace: '/tmp/lab',
  signal: new AbortController().signal,
  host: host(withMcp),
});

const ran = await executeToolCall(
  { id: 'c1', name: 'serena_find_symbol', arguments: JSON.stringify({ name_path: 'Task' }) },
  context(true),
);
check('the call reaches the server', ran.isError, false);
check('and its answer comes back', ran.content, 'serena:find_symbol ok');

const withoutServer = await executeToolCall(
  { id: 'c2', name: 'serena_find_symbol', arguments: '{}' },
  context(false),
);
check('a host with no MCP support says so', withoutServer.isError, true);
checkTruthy('and names the server', withoutServer.content.includes('serena'));

// ── Stopping leaves nothing behind ──────────────────────────────────────────────────────────

clearMcpTools('serena');
check('the tools are gone', mcpToolIds(), []);
check('the lookup misses', findMcpTool('serena_find_symbol'), undefined);
check(
  'and the surface no longer offers them',
  resolveWorkbenchSurface({ enabledPacks: [] }).toolIds.includes('serena_find_symbol'),
  false,
);

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: a running server\'s tools are discovered, classified, gated and callable');
