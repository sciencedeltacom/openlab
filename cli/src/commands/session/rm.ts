import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class SessionRm extends LabCommand {
  static description = 'Remove a session and its transcript';

  static args = {
    id: Args.string({ description: 'The session id (default: the active one)', required: true }),
  };

  static flags = {
    yes: Flags.boolean({ char: 'y', description: 'Confirm the removal' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionRm);
    const lab = await this.requireLab();
    const session = lab.state.sessions.find((candidate) => candidate.id === args.id);
    if (!session) {
      this.fail(`No session ${args.id}. \`openlab session list\` shows the ids.`);
    }
    if (!flags.yes) {
      this.fail(
        `This removes “${session.title}” and its ${(lab.state.transcripts[session.id] ?? []).length} messages. Pass --yes.`,
      );
    }

    const transcripts = { ...lab.state.transcripts };
    delete transcripts[session.id];
    lab.state.sessions = lab.state.sessions.filter((candidate) => candidate.id !== session.id);
    lab.state.transcripts = transcripts;
    if (lab.state.activeSessionId === session.id) {
      lab.state.activeSessionId = null;
      lab.state.messages = [];
    }
    await lab.save();

    this.emit({ id: session.id, removed: true }, () => `${out.mark.ok} removed ${out.c.grey(session.title)}`);
  }
}
