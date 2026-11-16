/**
 * The agents a workbench runs.
 *
 * An agent is a named way to run the lead turn: what it is for, the instructions it adds to
 * the system prompt, the model it prefers, and the packs it may open. Agents are grouped into
 * **teams** by a label, so a team is simply the set of agents that share one.
 *
 * `main` ships with the app and cannot be removed: there is always something to run, and a bar
 * that could empty itself would be a bar that can leave the workbench with no agent at all.
 */

import type { PackId } from '@/lib/agent/packs';

/** One agent the lead turn can run as. */
export interface Agent {
  id: string;
  name: string;
  /** One line the bar shows under the name. */
  summary: string;
  /** The team it belongs to; an empty string means no team. */
  team: string;
  /** Appended to the system prompt when this agent leads. */
  instructions: string;
  /** Preferred `provider/model-id`; empty means the session's own model. */
  modelRef: string;
  /** Packs this agent asks for; intersected with the workbench's open packs. */
  packs: PackId[];
  /** A read-only agent loses writes, execution and network access. */
  readOnly: boolean;
  /** Ships with the app and cannot be removed. */
  builtIn: boolean;
  /** The avatar orb's base colour, a hex string. Chosen per agent. */
  avatarColor?: string;
}

/** The colours an agent's orb can wear. Vivid enough to tell two agents apart at a glance. */
export const AVATAR_COLORS: readonly string[] = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
];

/** A stable colour for an agent, from its name, so a new agent is never colourless. */
export function defaultAvatarColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100_003;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

/** The id of the built-in agent every workbench starts on. */
export const MAIN_AGENT_ID = 'main';

/** The agents the app ships with — the standing roster of a research bench. */
export const BUILTIN_AGENTS: Agent[] = [
  {
    id: MAIN_AGENT_ID,
    name: 'General',
    summary: 'The generalist lead: the whole workbench, the session’s own model.',
    team: '',
    instructions:
      'You are the generalist lead of a research workbench. Hold the whole picture: frame the question, choose the method, and drive the work to a defensible result. Delegate when a specialist fits better, and keep every claim tied to the record, code or data that supports it.',
    modelRef: '',
    packs: [],
    readOnly: false,
    builtIn: true,
    avatarColor: '#6366f1',
  },
  {
    id: 'planner',
    name: 'Planner',
    summary: 'Turns an objective into a rigorous, ordered plan.',
    team: '',
    instructions:
      'You are the planner. Turn an objective into a rigorous, ordered plan: hypotheses, milestones, the method for each step, what could go wrong, and how the work will be known to be done. Prefer the smallest plan that answers the question, name the dependencies, and keep the plan honest, and re-plan when the evidence changes.',
    modelRef: '',
    packs: [],
    readOnly: false,
    builtIn: true,
    avatarColor: '#8b5cf6',
  },
  {
    id: 'researcher',
    name: 'Researcher',
    summary: 'Finds, reads and weighs the literature, and cites it.',
    team: '',
    instructions:
      'You are the researcher. Find, read and weigh the literature: search the databases, screen on title and abstract, and synthesise what the evidence actually shows. Separate what is established from what is contested or missing, prefer primary evidence over reviews, and cite every claim with its record id.',
    modelRef: '',
    packs: [],
    readOnly: false,
    builtIn: true,
    avatarColor: '#0ea5e9',
  },
  {
    id: 'coder',
    name: 'Coder',
    summary: 'Writes analysis another scientist can rerun.',
    team: '',
    instructions:
      'You are the coder. Write analysis that another scientist can rerun: small, readable scripts and notebooks, pinned inputs and versions, no hidden state. Validate before you trust: check the shape, the units and the edge cases, and report results with their uncertainty attached.',
    modelRef: '',
    packs: [],
    readOnly: false,
    builtIn: true,
    avatarColor: '#10b981',
  },
  {
    id: 'coordinator',
    name: 'Coordinator',
    summary: 'Keeps the team in step and the record straight.',
    team: '',
    instructions:
      'You are the coordinator. Keep the team in step: break the work into tasks, assign each to the right specialist, track progress and blockers, and resolve conflicts between results. Surface what needs a decision, keep the record straight, and make sure the pieces add up to the question that was asked.',
    modelRef: '',
    packs: [],
    readOnly: false,
    builtIn: true,
    avatarColor: '#f59e0b',
  },
];

/** A new agent from the fields the create form collects. */
export function newAgent(input: Partial<Agent> & { name: string }): Agent {
  const name = input.name.trim() || 'New agent';
  return {
    id: `agent-${crypto.randomUUID().slice(0, 8)}`,
    name,
    summary: input.summary?.trim() ?? '',
    team: input.team?.trim() ?? '',
    instructions: input.instructions?.trim() ?? '',
    modelRef: input.modelRef?.trim() ?? '',
    packs: input.packs ?? [],
    readOnly: input.readOnly ?? false,
    builtIn: false,
    avatarColor: input.avatarColor ?? defaultAvatarColor(name),
  };
}

/** The team labels in play, in order of first appearance. */
export function teamNames(agents: readonly Agent[]): string[] {
  return Array.from(new Set(agents.map((agent) => agent.team).filter((team) => team.length > 0)));
}
