/**
 * One agent in full: the instructions it adds to the system prompt, the model it prefers, and
 * the packs it may open.
 *
 * The instructions are shown as written, because they are the whole difference between one
 * agent and another — a summary that paraphrased them would hide the thing being inspected.
 */

import { Args } from '@oclif/core';

import { findAgent } from '@/components/agents/store';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class AgentsShow extends LabCommand {
  static description = 'Show one agent: its instructions, model, packs and posture';

  static args = {
    id: Args.string({ description: 'The agent id', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(AgentsShow);
    await this.lab();

    const agent = findAgent(args.id);
    if (!agent) {
      this.fail(`No agent “${args.id}”. See \`openlab agents list\`.`);
    }

    this.emit(agent, () =>
      [
        out.heading(agent.name),
        out.keyValues([
          ['id', agent.id],
          ['team', agent.team || out.c.grey('none')],
          ['summary', agent.summary || out.c.grey('none')],
          ['model', agent.modelRef || out.c.grey('the session’s own model')],
          ['packs', agent.packs.join(', ') || out.c.grey('none')],
          ['read-only', agent.readOnly ? 'yes' : 'no'],
          ['built-in', agent.builtIn ? 'yes' : 'no'],
        ]),
        '',
        out.heading('Instructions'),
        agent.instructions || out.c.grey('none'),
      ].join('\n'),
    );
  }
}
