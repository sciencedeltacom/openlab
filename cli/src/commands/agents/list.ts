/**
 * The agents a workbench runs.
 *
 * An agent is a named way to run the lead turn: what it is for, the model it prefers, and the
 * packs it may open. The active one is marked — it is who the next turn runs as — and a team is
 * simply the set of agents that share a label.
 */

import { activeAgent, allAgents } from '@/components/agents/store';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class AgentsList extends LabCommand {
  static description = 'List the agents, marking the active one';

  async run(): Promise<void> {
    await this.lab();

    const active = activeAgent();
    const rows = allAgents().map((agent) => ({
      id: agent.id,
      name: agent.name,
      team: agent.team || out.c.grey('—'),
      packs: agent.packs.join(', ') || out.c.grey('—'),
      model: agent.modelRef || out.c.grey('session'),
      read: agent.readOnly ? 'read-only' : '',
      active: agent.id === active.id ? out.mark.ok : '',
    }));

    this.list(
      rows,
      [
        { key: 'active', label: '' },
        { key: 'id', label: 'id' },
        { key: 'name', label: 'name' },
        { key: 'team', label: 'team' },
        { key: 'packs', label: 'packs' },
        { key: 'model', label: 'model' },
        { key: 'read', label: '' },
      ],
      'No agents. `openlab agents new --name <name>` creates one.',
    );
  }
}
