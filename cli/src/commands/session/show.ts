import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { messagesOf, phaseLabel, renderMessage } from '../../lib/sessions';

export default class SessionShow extends LabCommand {
  static description = 'Read a session’s transcript';

  static args = {
    id: Args.string({ description: 'The session id (default: the active one)' }),
  };

  static flags = {
    thinking: Flags.boolean({ description: 'Include reasoning traces' }),
    tools: Flags.boolean({ description: 'Include tool output', default: true, allowNo: true }),
    tail: Flags.integer({ description: 'Only the last N messages' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionShow);
    const lab = await this.requireLab();
    const id = args.id ?? lab.state.activeSessionId ?? undefined;
    const session = id ? lab.state.sessions.find((candidate) => candidate.id === id) : undefined;
    if (!session) {
      this.fail('No such session. `openlab session list` shows the ids.');
    }
    const all = messagesOf(lab, session.id);
    const messages = flags.tail ? all.slice(-flags.tail) : all;

    this.emit({ session, messages }, () =>
      [
        out.keyValues([
          ['session', session.id],
          ['title', session.title],
          ['phase', phaseLabel(session.phase)],
          ['turns', String(all.length)],
          ['created', new Date(session.createdAt).toLocaleString()],
          ['updated', new Date(session.updatedAt).toLocaleString()],
          ...(session.branch ? [['branch', session.branch] as const] : []),
        ]),
        '',
        ...messages.flatMap((message) => [
          ...renderMessage(message, { thinking: flags.thinking, tools: flags.tools }),
          '',
        ]),
      ].join('\n'),
    );
  }
}
