/**
 * Creating an agent.
 *
 * Creating one also makes it active — the same way the app's create form does — because an
 * agent made and not chosen is an agent the user has to go find. `--pack` may be repeated; an
 * unknown pack is refused rather than dropped, so an agent never quietly loses a capability.
 */

import { Flags } from '@oclif/core';

import { addAgent } from '@/components/agents/store';
import { isPackId, toPackIds } from '@/lib/agent/packs';

import { LabCommand } from '../../lib/base';

export default class AgentsNew extends LabCommand {
  static description = 'Create an agent and make it active';

  static flags = {
    name: Flags.string({ description: 'The agent’s name', required: true }),
    summary: Flags.string({ description: 'One line about what it is for' }),
    team: Flags.string({ description: 'The team it belongs to' }),
    model: Flags.string({ description: 'Its preferred provider/model-id' }),
    pack: Flags.string({ description: 'A pack it may open; repeat for more', multiple: true }),
    instructions: Flags.string({ description: 'Instructions appended to the system prompt' }),
    'read-only': Flags.boolean({ description: 'Lose writes, execution and network access' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AgentsNew);
    const lab = await this.lab();

    const unknown = (flags.pack ?? []).filter((pack) => !isPackId(pack));
    if (unknown.length > 0) {
      this.fail(`Unknown pack(s): ${unknown.join(', ')}. See \`openlab packs list\`.`);
    }

    const agent = addAgent({
      name: flags.name,
      summary: flags.summary,
      team: flags.team,
      modelRef: flags.model,
      packs: toPackIds(flags.pack ?? []),
      instructions: flags.instructions,
      readOnly: flags['read-only'],
    });
    await lab.save();

    this.record(agent, [
      ['agent', agent.id],
      ['name', agent.name],
      ['team', agent.team || '—'],
      ['model', agent.modelRef || 'the session’s own model'],
      ['packs', agent.packs.join(', ') || 'none'],
      ['read-only', agent.readOnly ? 'yes' : 'no'],
    ]);
  }
}
