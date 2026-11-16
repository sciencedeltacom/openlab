/**
 * The agent the next turn runs as.
 *
 * With no `--set` it reports the active agent; with one it chooses, the way the agent bar does.
 * A stale id is refused rather than ignored, because silently staying on the old agent would
 * make the command look like it worked.
 */

import { Flags } from '@oclif/core';

import { activeAgent, findAgent, setActiveAgent } from '@/components/agents/store';

import { LabCommand } from '../../lib/base';

export default class AgentsActive extends LabCommand {
  static description = 'Show or set the active agent';

  static flags = {
    set: Flags.string({ description: 'The agent id to make active' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AgentsActive);
    const lab = await this.lab();

    if (flags.set) {
      const wanted = findAgent(flags.set);
      if (!wanted) {
        this.fail(`No agent “${flags.set}”. See \`openlab agents list\`.`);
      }
      setActiveAgent(wanted.id);
      await lab.save();
    }

    const active = activeAgent();
    this.record(active, [
      ['agent', active.id],
      ['name', active.name],
      ['team', active.team || '—'],
      ['model', active.modelRef || 'the session’s own model'],
      ['packs', active.packs.join(', ') || 'none'],
      ['read-only', active.readOnly ? 'yes' : 'no'],
    ]);
  }
}
