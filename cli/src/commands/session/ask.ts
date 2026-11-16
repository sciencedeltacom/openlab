import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { chatTurn, startSession } from '../../lib/chat';
import type { AgentMode, ReasoningEffort } from '@/store/types';

export default class SessionAsk extends LabCommand {
  static description = 'Send one turn to a session';

  static args = {
    prompt: Args.string({ description: 'What to ask', required: true }),
  };

  static flags = {
    session: Flags.string({ char: 's', description: 'The session id (default: the active one)' }),
    new: Flags.boolean({ char: 'n', description: 'Start a fresh session for this turn' }),
    mode: Flags.string({ description: 'How much latitude the agent has', options: ['agent', 'plan', 'ask'] }),
    reasoning: Flags.string({
      description: 'How hard to think first',
      options: ['off', 'low', 'medium', 'high'],
    }),
    model: Flags.string({ description: 'provider/model-id for this turn' }),
    yes: Flags.boolean({ char: 'y', description: 'Approve mutating calls without asking' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionAsk);
    const lab = await this.requireLab();

    if (flags.new) {
      startSession(lab, args.prompt.slice(0, 60));
    }

    const result = await chatTurn(lab, {
      prompt: args.prompt,
      mode: (flags.mode as AgentMode | undefined) ?? lab.state.mode,
      reasoning: (flags.reasoning as ReasoningEffort | undefined) ?? lab.state.reasoning,
      modelRef: flags.model,
      yes: flags.yes,
      sessionId: flags.session,
      interactive: Boolean(process.stdin.isTTY),
    });

    if (this.json) {
      this.log(out.json({ sessionId: result.sessionId, blocks: result.blocks, failed: result.failed }));
    }
    if (result.failed) {
      process.exitCode = 1;
    }
  }
}
