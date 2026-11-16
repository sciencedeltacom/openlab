/**
 * Domain packs, as the runtime sees them.
 *
 * A pack is the unit that turns a general workbench into a specific lab. It declares the
 * tools, MCP servers and procedures a stream of work brings, and enabling it is what makes
 * them visible to the agent. Nothing here owns display copy or icons — the catalogue does
 * that — so this module can be read by the run loop without pulling in the interface.
 *
 * The rule the whole system rests on: **enabling a pack is additive, never implicit**. A
 * session sees the core tools plus the union of the packs the user has opened, and a subagent
 * sees only the packs its assignment names. A tool the workbench has not opened is a tool the
 * model never learns about.
 */

import {
  AGENT_TOOLS,
  CORE_TOOL_IDS,
  PACK_TOOL_OVERRIDES,
  findTool,
  type AgentToolId,
  type ToolId,
} from './tools';
import { extensionPacks, extensionSkillIds, extensionTools } from '@/lib/extensions/registry';
import { mcpToolIds } from '@/lib/mcp/registry';
import type { McpServerId } from './mcp';
import { PACK_IDS } from './pack-ids';

/** The identifiers of the packs openlab ships, in catalogue order. */
export { PACK_IDS };

/**
 * A domain pack's identifier.
 *
 * The shipped packs are named in {@link PACK_IDS}; an installed extension opens one of its
 * own, named by the extension's id. Both are plain strings here, because a pack that arrives
 * in a manifest cannot be a literal.
 */
export type PackId = string;

/** What a pack brings to a session. */
export interface DomainPack {
  id: PackId;
  name: string;
  /** The family the catalogue groups it under. */
  family: string;
  /** MCP servers the pack allows. */
  mcps: readonly McpServerId[];
  /** Skill and recipe ids the pack brings. */
  skills: readonly string[];
}

/** The pack catalogue as the runtime reads it. Display copy lives in `app/screens/packs`. */
export const DOMAIN_PACKS: readonly DomainPack[] = [
  {
    id: 'genomics',
    name: 'Genomics',
    family: 'Genomes & sequence',
    mcps: ['delphi', 'zotero'],
    skills: ['recipe-differential-expression', 'recipe-singlecell-integration', 'reproducible-analysis'],
  },
  {
    id: 'molecular',
    name: 'Molecular dynamics',
    family: 'Structure & chemistry',
    mcps: ['delphi'],
    skills: ['recipe-structure-prep', 'reproducible-analysis'],
  },
  {
    id: 'ml',
    name: 'Machine learning',
    family: 'Modelling & statistics',
    mcps: ['delphi'],
    skills: ['recipe-power-analysis', 'recipe-reproducibility-audit'],
  },
  {
    id: 'structural-biology',
    name: 'Structural biology',
    family: 'Structure & chemistry',
    mcps: ['delphi', 'zotero'],
    skills: ['molecular-structure-prep', 'recipe-structure-prep', 'recipe-figure-pack'],
  },
  {
    id: 'cheminformatics',
    name: 'Cheminformatics',
    family: 'Structure & chemistry',
    mcps: ['delphi'],
    skills: ['recipe-dataset-release', 'recipe-figure-pack'],
  },
  {
    id: 'proteomics',
    name: 'Proteomics',
    family: 'Omics & imaging',
    mcps: ['delphi'],
    skills: ['recipe-incoming-data-audit', 'recipe-results-section'],
  },
  {
    id: 'transcriptomics',
    name: 'Transcriptomics',
    family: 'Genomes & sequence',
    mcps: ['delphi'],
    skills: ['recipe-differential-expression', 'recipe-singlecell-integration', 'recipe-results-section'],
  },
  {
    id: 'imaging',
    name: 'Imaging',
    family: 'Omics & imaging',
    mcps: ['delphi'],
    skills: ['molecular-structure-prep', 'recipe-figure-pack', 'recipe-incoming-data-audit'],
  },
  {
    id: 'epidemiology',
    name: 'Epidemiology',
    family: 'Modelling & statistics',
    mcps: ['delphi', 'zotero', 'ohdsi'],
    skills: ['recipe-power-analysis', 'recipe-systematic-review', 'recipe-results-section'],
  },
];

/** True when a string names a pack this build can open: a shipped one, or an installed one. */
export function isPackId(value: string): value is PackId {
  return (
    (PACK_IDS as readonly string[]).includes(value) || extensionPacks().some((pack) => pack.id === value)
  );
}

/** Look a pack up by id: the catalogue first, then the extensions. */
export function findPack(id: PackId): DomainPack | undefined {
  const shipped = DOMAIN_PACKS.find((pack) => pack.id === id);
  if (shipped) return shipped;
  const extension = extensionPacks().find((pack) => pack.id === id);
  // An extension's connectors are not MCP servers, so a pack it opens allows none; its skills
  // are its own, and its tools are found by scope exactly like a shipped pack's.
  return extension
    ? { id: extension.id, name: extension.name, family: extension.family, mcps: [], skills: extension.skills }
    : undefined;
}

/** Every pack this build can open, shipped and installed. */
export function allPacks(): DomainPack[] {
  return [
    ...DOMAIN_PACKS,
    ...extensionPacks().map((pack) => ({
      id: pack.id,
      name: pack.name,
      family: pack.family,
      mcps: [],
      skills: pack.skills,
    })),
  ];
}

/** Drop anything that is not a known pack id, preserving order and uniqueness. */
export function toPackIds(values: readonly string[]): PackId[] {
  const seen = new Set<PackId>();
  for (const value of values) {
    if (isPackId(value)) {
      seen.add(value);
    }
  }
  return [...seen];
}

/**
 * The tools a pack grants: the tools whose home scope it is, plus the cross-domain tools it
 * overrides. Ordered by the inventory so a model brief is stable across packs.
 */
export function packToolIds(pack: PackId): ToolId[] {
  const granted = new Set<ToolId>(PACK_TOOL_OVERRIDES[pack] ?? []);
  const shipped = AGENT_TOOLS.filter((tool) => tool.scope === pack || granted.has(tool.id)).map(
    (tool) => tool.id,
  );
  // An extension's pack owns exactly the tools the extension declared.
  const installed = extensionTools()
    .filter((entry) => entry.extensionId === pack)
    .map((entry) => entry.tool.id);
  return unique([...shipped, ...installed]);
}

/** The tools, MCP servers and procedures a set of packs makes visible. */
export interface PackSurface {
  toolIds: ToolId[];
  mcpIds: McpServerId[];
  skillIds: string[];
}

/** How a session is scoped: the packs opened for the whole workbench. */
export interface WorkbenchScope {
  /** Packs the user has opened. */
  enabledPacks: readonly PackId[];
  /**
   * MCP servers the user has turned off.
   *
   * A pack names a server; this build starts none of them, so the switch records the reader's
   * intent for when it does. It is not a claim that the server is running.
   */
  closedMcps?: readonly McpServerId[];
}

/**
 * The surface the workbench has opened: core tools plus the union of every enabled pack.
 *
 * This is what the lead agent runs with. Subagents narrow it further through
 * {@link resolveAssignment} rather than widening it.
 */
export function resolveWorkbenchSurface(scope: WorkbenchScope): PackSurface {
  const packs = toPackIds(scope.enabledPacks);
  const closed = new Set(scope.closedMcps ?? []);
  // An extension's own switch is the consent to use its tools. The pack it opens is catalogue
  // and skills, not a second gate: a tool-only manifest has no pack id to enable, and requiring
  // one made every installed tool unreachable.
  const installed = extensionTools().map((entry) => entry.tool.id);
  // A running MCP server is the reader's consent, the same as an extension switch: its tools
  // are on the workbench surface while it runs, and gone when it stops.
  return {
    toolIds: unique([...CORE_TOOL_IDS, ...packs.flatMap(packToolIds), ...installed, ...mcpToolIds()]),
    mcpIds: unique(packs.flatMap((pack) => [...(findPack(pack)?.mcps ?? [])])).filter(
      (id) => !closed.has(id),
    ),
    // Skills come from the packs the workbench opened, including the ones an extension opened.
    skillIds: unique([
      ...packs.flatMap((pack) => [...(findPack(pack)?.skills ?? [])]),
      ...extensionSkillIds(),
    ]),
  };
}

/** A subagent's assignment: which packs to give it, and whether it may only read. */
export interface PackAssignment {
  /** Packs assigned to this worker. */
  packs: readonly PackId[];
  /** A read-only worker keeps the core read tools and drops every pack tool that changes state. */
  readOnly?: boolean;
  /**
   * The exact tools the worker needs, when the lead named them.
   *
   * A named list replaces the default surface: the worker gets those tools and nothing else,
   * intersected with what the workbench has open. The point is a worker that cannot wander —
   * a reader that can only read, a statistician that only has the statistics tool.
   */
  tools?: readonly ToolId[];
}

/** The tools a worker actually gets, plus what the workbench could not grant. */
export interface AssignmentResolution {
  toolIds: ToolId[];
  mcpIds: McpServerId[];
  skillIds: string[];
  /**
   * Packs the assignment named that the workbench has not opened.
   *
   * Reported rather than dropped: an agent that quietly lost a capability would produce a
   * confident answer from a smaller toolkit and never say so.
   */
  missingPacks: PackId[];
  /**
   * Tools the lead asked for that the workbench does not have open.
   *
   * Reported for the same reason as `missingPacks`: a worker that quietly lost a tool would
   * report a confident result from a smaller toolkit.
   */
  missingTools: ToolId[];
}

/**
 * Narrow the workbench surface to one assignment.
 *
 * The intersection is deliberate: a subagent can be given a subset of the open packs, never a
 * pack the user did not open. A read-only worker additionally loses the tools that write,
 * execute or reach the network, so delegation cannot become a way around the permission gate.
 */
/**
 * Tools that belong to the lead alone.
 *
 * A worker neither delegates, nor writes the session's plan, nor renames it: those describe the
 * session, and the lead is what holds the session. Leaving them in the surface only taught a
 * worker to call a tool the host would refuse.
 */
const LEAD_ONLY_TOOLS: readonly ToolId[] = ['task', 'plan_update', 'session_title', 'split_session'];

export function resolveAssignment(assignment: PackAssignment, scope: WorkbenchScope): AssignmentResolution {
  // An installed extension's pack is as open as its switch says, so a worker can be given the
  // same tools the lead has without a second, invisible enable step.
  const enabled = new Set([...toPackIds(scope.enabledPacks), ...extensionPacks().map((pack) => pack.id)]);
  const assigned = toPackIds(assignment.packs);
  const missingPacks = assigned.filter((pack) => !enabled.has(pack));
  const granted = assigned.filter((pack) => enabled.has(pack));

  const allowed = unique([...CORE_TOOL_IDS, ...granted.flatMap(packToolIds), ...mcpToolIds()]).filter(
    (id) => !LEAD_ONLY_TOOLS.includes(id),
  );

  // A named list is the assignment: exactly those tools, minus anything the workbench has not
  // opened. Without one, the worker gets the packs it was given.
  const requested = assignment.tools;
  const chosen = requested && requested.length > 0 ? requested.filter((id) => allowed.includes(id)) : allowed;
  const missingTools = requested ? requested.filter((id) => !allowed.includes(id)) : [];

  const toolIds = unique(chosen).filter((id) => !assignment.readOnly || isReadOnlyTool(id));

  return {
    toolIds,
    mcpIds: assignment.readOnly ? [] : unique(granted.flatMap((pack) => [...(findPack(pack)?.mcps ?? [])])),
    skillIds: unique(granted.flatMap((pack) => [...(findPack(pack)?.skills ?? [])])),
    missingPacks,
    missingTools,
  };
}

/** True when a tool changes nothing anywhere: the read half of the inventory, network excluded. */
function isReadOnlyTool(id: ToolId): boolean {
  const effects = findTool(id)?.effects;
  return Boolean(effects?.readOnly && !effects.network && !effects.writes && !effects.executes);
}

/** Preserve first-seen order while removing duplicates. */
function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
