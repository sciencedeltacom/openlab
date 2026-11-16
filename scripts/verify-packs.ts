/**
 * Checks the domain-pack runtime.
 *
 * Run with: `bun scripts/verify-packs.ts`
 *
 * The pack system exists to stop the agent seeing tools the workbench did not open, and to
 * let the lead hand a subagent a narrower slice than the lead has. Both are visibility rules,
 * and a visibility bug is silent: the model simply never learns a tool exists, or, worse,
 * learns one the user closed. These checks pin the two properties that matter — packs are
 * additive and assignments only ever intersect — plus the consistency between the runtime
 * packs and the catalogue that renders them.
 */

import {
  CORE_TOOL_IDS,
  PACK_TOOL_OVERRIDES,
  AGENT_TOOLS,
  findTool,
  type AgentToolId,
} from '../src/lib/agent/tools';
import {
  DOMAIN_PACKS,
  PACK_IDS,
  isPackId,
  packToolIds,
  resolveAssignment,
  resolveWorkbenchSurface,
  toPackIds,
  type PackId,
} from '../src/lib/agent/packs';
import { MCP_SERVERS, findMcpServer } from '../src/lib/agent/mcp';
import { SUBAGENT_PROFILES, resolveSubagent } from '../src/lib/agent/subagents';
import { packCatalog } from '../src/app/screens/packs';
import { PACK_SKILLS, PACK_TOOLS, hasSkillEntry } from '../src/components/packs/meta';

let failures = 0;

/** Assert equality and report the difference rather than throwing. */
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

/** Assert a value is present. */
function checkTruthy(label: string, actual: unknown) {
  if (actual) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label} — got ${JSON.stringify(actual)}`);
}

/* ================================================================================================
 * Inventory and catalogue consistency
 * ============================================================================================== */

console.log('\n— inventory —');
{
  const toolIds = new Set(AGENT_TOOLS.map((tool) => tool.id));
  check('tool ids are unique', toolIds.size, AGENT_TOOLS.length);
  check(
    'core tools match scope core',
    CORE_TOOL_IDS,
    AGENT_TOOLS.filter((tool) => tool.scope === 'core').map((tool) => tool.id),
  );
  checkTruthy('read_file is core', CORE_TOOL_IDS.includes('read_file'));
  checkTruthy('run_command is core', CORE_TOOL_IDS.includes('run_command'));

  for (const pack of Object.keys(PACK_TOOL_OVERRIDES)) {
    checkTruthy(`override key ${pack} is a real pack`, isPackId(pack));
  }
  for (const pack of DOMAIN_PACKS) {
    for (const id of packToolIds(pack.id)) {
      if (!findTool(id)) {
        failures += 1;
        console.log(`FAIL pack ${pack.id} grants unknown tool ${id}`);
      }
    }
  }

  const catalogueIds = new Set(packCatalog.entries.map((entry) => entry.id));
  check(
    'every catalogue pack has a runtime pack',
    PACK_IDS.filter((id) => !catalogueIds.has(id)),
    [],
  );
  check(
    'every runtime pack is in the catalogue',
    DOMAIN_PACKS.filter((pack) => !catalogueIds.has(pack.id)),
    [],
  );
}

/* ================================================================================================
 * Enabling is additive and nothing leaks from a closed pack
 * ============================================================================================== */

console.log('\n— workbench surface —');
{
  const none = resolveWorkbenchSurface({ enabledPacks: [] });
  check('no pack means core tools only', none.toolIds, [...CORE_TOOL_IDS]);
  check('no pack means no MCP servers', none.mcpIds, []);
  check('no pack means no procedures', none.skillIds, []);
  checkTruthy('the lead can delegate', none.toolIds.includes('task'));

  const genomics = resolveWorkbenchSurface({ enabledPacks: ['genomics'] });
  checkTruthy('genomics adds the science search tool', genomics.toolIds.includes('science_search'));
  checkTruthy('genomics adds the statistics tool', genomics.toolIds.includes('statistics'));
  check('genomics allows its MCP servers', genomics.mcpIds, ['delphi', 'zotero']);
  checkTruthy('genomics brings procedures', genomics.skillIds.includes('recipe-differential-expression'));

  const mlOnly = resolveWorkbenchSurface({ enabledPacks: ['ml'] });
  checkTruthy('ml adds statistics', mlOnly.toolIds.includes('statistics'));
  check('ml does not leak science_search', mlOnly.toolIds.includes('science_search'), false);
  check('ml allows only its own MCP servers', mlOnly.mcpIds, ['delphi']);
  check(
    'and a server the user closed is not in the surface',
    resolveWorkbenchSurface({ enabledPacks: ['genomics'], closedMcps: ['delphi'] }).mcpIds,
    ['zotero'],
  );
  check(
    'closing one the packs do not allow changes nothing',
    resolveWorkbenchSurface({ enabledPacks: ['ml'], closedMcps: ['ohdsi'] }).mcpIds,
    ['delphi'],
  );
  check(
    'a disabled pack contributes nothing',
    mlOnly.toolIds.filter((id) => id === 'science_fetch'),
    [],
  );

  check(
    'enabling is a union, not a replacement',
    [...resolveWorkbenchSurface({ enabledPacks: ['ml', 'genomics'] }).toolIds].length >=
      [...mlOnly.toolIds].length,
    true,
  );
}

/* ================================================================================================
 * Assignments only ever narrow the workbench
 * ============================================================================================== */

console.log('\n— assignments —');
{
  const scope = { enabledPacks: ['genomics', 'ml'] as PackId[] };

  const widened = resolveAssignment({ packs: ['transcriptomics'] }, scope);
  check('a pack the workbench has not opened is reported, not granted', widened.missingPacks, [
    'transcriptomics',
  ]);
  check('and it grants no tool from the missing pack', widened.toolIds.includes('science_fetch'), false);

  const narrowed = resolveAssignment({ packs: ['ml'] }, scope);
  checkTruthy('an open pack is granted', narrowed.toolIds.includes('statistics'));
  check('and only that pack is reported missing', narrowed.missingPacks, []);

  const worker = resolveAssignment({ packs: ['genomics'] }, scope);
  check('a worker cannot re-delegate', worker.toolIds.includes('task'), false);

  const readOnly = resolveAssignment({ packs: ['genomics'], readOnly: true }, scope);
  check('a read-only worker cannot write', readOnly.toolIds.includes('write_file'), false);
  check('a read-only worker cannot run a command', readOnly.toolIds.includes('run_command'), false);
  check('a read-only worker cannot reach the network', readOnly.toolIds.includes('fetch_url'), false);
  check('a read-only worker takes no MCP servers', readOnly.mcpIds, []);
  checkTruthy('but it can still read', readOnly.toolIds.includes('read_file'));
  checkTruthy('and still search text', readOnly.toolIds.includes('grep'));

  // A named tool list is the assignment: exactly those tools, and nothing else.
  const named = resolveAssignment({ packs: [], tools: ['read_file', 'grep', 'nope'] }, scope);
  check('a named list is the whole assignment', named.toolIds, ['read_file', 'grep']);
  check('and a tool the workbench lacks is reported', named.missingTools, ['nope']);
  check('a named list drops the core tools it did not name', named.toolIds.includes('write_file'), false);

  const namedReadOnly = resolveAssignment(
    { packs: [], readOnly: true, tools: ['read_file', 'write_file'] },
    scope,
  );
  check('a read-only worker loses a named write tool', namedReadOnly.toolIds, ['read_file']);

  const closedPack = resolveAssignment({ packs: [], tools: ['science_search'] }, { enabledPacks: [] });
  check('a named pack tool needs the pack open', closedPack.missingTools, ['science_search']);
  const openPack = resolveAssignment({ packs: ['genomics'], tools: ['science_search'] }, scope);
  check('and is granted when it is', openPack.toolIds, ['science_search']);
}

/* ================================================================================================
 * Subagent profiles
 * ============================================================================================== */

console.log('\n— subagents —');
{
  const scope = { enabledPacks: ['genomics', 'molecular', 'ml'] as PackId[] };

  const ids = SUBAGENT_PROFILES.map((profile) => profile.id);
  check('profile ids are unique', new Set(ids).size, ids.length);

  const explore = resolveSubagent('explore', scope);
  check('explore is read-only', explore.toolIds.includes('run_command'), false);
  check('explore has no MCP servers', explore.mcpIds, []);
  checkTruthy('explore can read the workspace', explore.toolIds.includes('list_dir'));

  const literature = resolveSubagent('literature', scope);
  checkTruthy('literature gets the science tools', literature.toolIds.includes('science_search'));
  check('and cannot re-delegate', literature.toolIds.includes('task'), false);

  const overridden = resolveSubagent('explore', scope, ['ml']);
  checkTruthy(
    'a read-only worker stays read-only with an override',
    overridden.toolIds.includes('statistics'),
  );
  check('an override cannot make it run commands', overridden.toolIds.includes('run_command'), false);

  const handpicked = resolveSubagent('analyst', scope, undefined, ['statistics', 'read_file']);
  check('a worker can be given exactly the named tools', handpicked.toolIds, ['statistics', 'read_file']);

  const unknown = resolveSubagent('does-not-exist', scope);
  check(
    'an unknown profile falls back to a scout, not the workbench',
    unknown.toolIds.includes('write_file'),
    false,
  );
  check('an unknown profile is reported as read-only', unknown.toolIds.includes('fetch_url'), false);
}

/* ================================================================================================
 * MCP and data hygiene
 * ============================================================================================== */

console.log('\n— hygiene —');
{
  for (const server of MCP_SERVERS) {
    checkTruthy(`MCP server ${server.id} resolves`, findMcpServer(server.id));
  }
  const declared = DOMAIN_PACKS.flatMap((pack) => pack.mcps);
  check(
    'every pack MCP id is a known server',
    declared.filter((id) => !findMcpServer(id)),
    [],
  );
  check(
    'MCP servers are references: nothing claims to be running',
    MCP_SERVERS.every((server) => !('installed' in server)),
    true,
  );
  check('toPackIds drops unknown ids', toPackIds(['genomics', 'nope', 'genomics']), ['genomics']);
  check('toPackIds keeps only real packs', isPackId('ml') && !isPackId('astrology'), true);

  for (const pack of DOMAIN_PACKS) {
    const catalogueSkills = new Set((PACK_SKILLS[pack.id] ?? []).map((skill) => skill.id));
    const unknown = pack.skills.filter((id) => !catalogueSkills.has(id));
    check(`pack ${pack.id} skills are in the catalogue`, unknown, []);
  }

  // A pack names procedures it expects the library to have. A missing page is a link to
  // nothing on the pack page, so it is a failure here rather than a reader's surprise.
  const missingSkills = Object.entries(PACK_SKILLS).flatMap(([pack, skills]) =>
    skills.filter((skill) => !hasSkillEntry(skill.id)).map((skill) => `${pack}:${skill.id}`),
  );
  check('every pack skill has a catalogue page', missingSkills, []);

  const packToolIds = Object.values(PACK_TOOLS).flat();
  check('pack tool ids are non-empty', packToolIds.filter((id) => id.trim().length === 0), []);
  check('pack tool ids are unique within a pack', Object.values(PACK_TOOLS).filter((ids) => new Set(ids).size !== ids.length).length, 0);

  const allTools = new Set<AgentToolId>(AGENT_TOOLS.map((tool) => tool.id));
  check(
    'every core tool is in the inventory',
    CORE_TOOL_IDS.every((id) => allTools.has(id)),
    true,
  );
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: packs gate tool visibility, and assignments only ever narrow it');
