/**
 * Subagent profiles.
 *
 * A profile is a named, bounded worker the lead can delegate to. What makes it bounded is its
 * pack assignment: a literature scout is not given the chemistry stack, and a read-only
 * explorer is not given a shell. The lead may override the packs for one dispatch — that is
 * the point of `resolveSubagent` taking an explicit list — but it can never hand a worker a
 * pack the workbench has not opened, because resolution intersects with the enabled set.
 */

import { resolveAssignment, type AssignmentResolution, type PackId, type WorkbenchScope } from './packs';
import { mcpToolIds } from '@/lib/mcp/registry';

/** A named worker and the packs it runs with. */
export interface SubagentProfile {
  id: string;
  name: string;
  /** One line the lead reads to decide whether to delegate here. */
  summary: string;
  /** Packs this profile asks for by default. */
  packs: readonly PackId[];
  /** A read-only worker loses writes, execution and network access. */
  readOnly?: boolean;
  /**
   * This worker's default tools are the running MCP server's, not a pack's.
   *
   * The coding worker is the case: its tools are whatever Serena advertises, discovered when
   * the server starts, so they cannot be written into a profile.
   */
  mcp?: boolean;
}

/** The workers the lead can dispatch. */
export const SUBAGENT_PROFILES: readonly SubagentProfile[] = [
  {
    id: 'explore',
    name: 'Explore',
    summary: 'Read the workspace and report what is there. No pack, no writes, no network: a pure scout.',
    packs: [],
    readOnly: true,
  },
  {
    id: 'literature',
    name: 'Literature',
    summary: 'Search the literature and the public research databases for a stream of work.',
    packs: ['genomics', 'epidemiology'],
  },
  {
    id: 'analyst',
    name: 'Analyst',
    summary: 'Design and run the statistical part of a study, with a reproducible result.',
    packs: ['ml'],
  },
  {
    id: 'biologist',
    name: 'Biologist',
    summary: 'Sequence, expression and proteomics work from reads to quantified results.',
    packs: ['genomics', 'transcriptomics', 'proteomics'],
  },
  {
    id: 'chemist',
    name: 'Chemist',
    summary: 'Small molecules and structures: parsing, standardising, preparing and describing.',
    packs: ['molecular', 'cheminformatics'],
  },
  {
    id: 'imager',
    name: 'Imager',
    summary: 'Microscopy and plate images, from acquisition metadata to measured objects.',
    packs: ['imaging'],
  },
  {
    id: 'coding',
    name: 'Coding',
    summary:
      'Read and edit code with Serena: symbols, references and precise edits. Needs a workspace folder and the Serena server.',
    packs: [],
    mcp: true,
  },
  {
    id: 'epidemiologist',
    name: 'Epidemiologist',
    summary: 'Cohort and registry analysis with the design fixed before the outcome is read.',
    packs: ['epidemiology'],
  },
];

/** Look a profile up by id. */
export function findSubagent(id: string): SubagentProfile | undefined {
  return SUBAGENT_PROFILES.find((profile) => profile.id === id);
}

/**
 * Resolve one dispatch to a concrete tool surface.
 *
 * `packs` overrides the profile's defaults when given, so the lead can hand a literature
 * worker the imaging pack for one task without inventing a profile for it. An unknown profile
 * falls back to a read-only scout rather than to the full workbench.
 */
export function resolveSubagent(
  id: string,
  scope: WorkbenchScope,
  packs?: readonly PackId[],
  tools?: readonly string[],
): AssignmentResolution {
  const profile = findSubagent(id);
  // A worker whose tools come from a server gets what is running now, unless the lead named
  // an exact list.
  const served = !tools && profile?.mcp ? mcpToolIds() : undefined;
  const assignment = {
    packs: packs ?? profile?.packs ?? [],
    // Only an unknown profile falls back to read-only; a named profile keeps its own posture.
    readOnly: profile ? profile.readOnly === true : true,
    ...(tools && tools.length > 0 ? { tools } : served && served.length > 0 ? { tools: served } : {}),
  };
  return resolveAssignment(assignment, scope);
}
