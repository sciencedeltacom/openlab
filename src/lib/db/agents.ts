/**
 * The agents, in and out of SQLite.
 *
 * The `active` flag lives on the rows rather than in a table of its own, so choosing an agent
 * rewrites the flags. The write memory is invalidated when the choice changes, because the
 * rows' contents have not moved but their meaning has.
 */

import type { Agent } from '../../components/agents/data';

import type { Db } from './client';
import * as t from './schema';
import { TableSyncer } from './sync';

let active = 'main';

const agentSyncer = new TableSyncer<Agent>(t.agents, (agent, position) => ({
  id: agent.id,
  position,
  name: agent.name,
  summary: agent.summary,
  team: agent.team,
  instructions: agent.instructions,
  modelRef: agent.modelRef,
  packs: agent.packs,
  readOnly: agent.readOnly,
  builtIn: agent.builtIn,
  active: agent.id === active,
  avatarColor: agent.avatarColor ?? null,
}));

/** Every agent and which one is active. */
export async function loadAgents(db: Db): Promise<{ agents: Agent[]; activeId: string }> {
  const rows = await db.select().from(t.agents).orderBy(t.agents.position);
  const agents = rows.map(({ position: _position, active: _active, avatarColor, ...agent }) => ({
    ...agent,
    avatarColor: avatarColor ?? undefined,
  }));
  active = rows.find((row) => row.active)?.id ?? 'main';
  return { agents, activeId: active };
}

/** Write the agents and the active choice. */
export async function saveAgents(db: Db, agents: readonly Agent[], activeId: string): Promise<void> {
  const choiceMoved = activeId !== active;
  active = activeId;
  await agentSyncer.sync(db, agents, '', choiceMoved);
}

/** Drop the write memory, so the next save rewrites everything. */
export function resetAgentSyncer(): void {
  agentSyncer.reset();
  active = 'main';
}
