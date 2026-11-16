/**
 * The agents, live.
 *
 * A small external store rather than the app reducer: the agent bar and the run engine both
 * read it, and neither should re-render the transcript when an agent is renamed. The list is
 * stored in the app's SQLite database, so an agent created today is there next launch; in a
 * plain browser it lives in memory for the session.
 */

import { useSyncExternalStore } from 'react';

import { getDb, serialized } from '@/lib/db/client';
import { loadAgents, saveAgents } from '@/lib/db/agents';
import { BUILTIN_AGENTS, MAIN_AGENT_ID, newAgent, teamNames, type Agent } from './data';

let items: Agent[] = [...BUILTIN_AGENTS];
let activeId: string = MAIN_AGENT_ID;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Fill the list from the database. Called once, by `bootStorage`. */
export async function hydrateAgents(): Promise<void> {
  const db = getDb();
  if (!db) {
    return;
  }
  const loaded = await loadAgents(db);
  // The built-ins are the app's standing roster and are refreshed to the shipped definition on
  // every launch, so a new release's agents appear without a migration. Agents the user made are
  // kept, after them, in their own order.
  const userAgents = loaded.agents.filter((agent) => !agent.builtIn);
  // A built-in agent the reader edited keeps the edit: the stored copy wins over the shipped
  // definition, so a rename or an instruction is not undone by the next launch. A built-in the
  // store has never seen arrives from the shipped list.
  const stored = new Map(loaded.agents.filter((agent) => agent.builtIn).map((agent) => [agent.id, agent]));
  const builtIns = BUILTIN_AGENTS.map((agent) => {
    const kept = stored.get(agent.id);
    return kept ? { ...agent, ...kept, builtIn: true } : agent;
  });
  items = [...builtIns, ...userAgents];
  activeId = items.some((agent) => agent.id === loaded.activeId) ? loaded.activeId : MAIN_AGENT_ID;
  void serialized(() => saveAgents(db, items, activeId));
  emit();
}

function persist(): void {
  const db = getDb();
  if (!db) {
    return;
  }
  void serialized(() => saveAgents(db, items, activeId)).catch((error) => {
    console.error('openlab could not write the agents', error);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The agents, live. */
export function useAgents(): Agent[] {
  return useSyncExternalStore(subscribe, () => items);
}

/** The active agent's id, live. */
export function useActiveAgentId(): string {
  return useSyncExternalStore(subscribe, () => activeId);
}

/** The agents, for readers that are not components — the engine and its tools. */
export function allAgents(): Agent[] {
  return items;
}

/** An agent by id. */
export function findAgent(id: string): Agent | undefined {
  return items.find((agent) => agent.id === id);
}

/** The agent the next turn runs as; `main` when the selection is stale. */
export function activeAgent(): Agent {
  return items.find((agent) => agent.id === activeId) ?? items[0];
}

/** The team labels in play. */
export function agentTeams(): string[] {
  return teamNames(items);
}

/** The agents other than the active one — who the lead may delegate to. */
export function teammates(): Agent[] {
  return items.filter((agent) => agent.id !== activeId);
}

/** Add an agent and make it active, so creating one is also choosing it. */
export function addAgent(input: Partial<Agent> & { name: string }): Agent {
  const agent = newAgent(input);
  items = [...items, agent];
  activeId = agent.id;
  persist();
  emit();
  return agent;
}

/** Change an agent in place. */
export function patchAgent(id: string, patch: Partial<Agent>): void {
  items = items.map((agent) =>
    agent.id === id ? { ...agent, ...patch, id, builtIn: agent.builtIn } : agent,
  );
  persist();
  emit();
}

/** Remove an agent. A built-in agent cannot be removed; returns whether it was. */
export function removeAgent(id: string): boolean {
  const agent = findAgent(id);
  if (!agent || agent.builtIn) {
    return false;
  }
  items = items.filter((candidate) => candidate.id !== id);
  if (activeId === id) {
    activeId = MAIN_AGENT_ID;
  }
  persist();
  emit();
  return true;
}

/** Choose the agent the next turn runs as. */
export function setActiveAgent(id: string): void {
  if (!findAgent(id)) {
    return;
  }
  activeId = id;
  persist();
  emit();
}
