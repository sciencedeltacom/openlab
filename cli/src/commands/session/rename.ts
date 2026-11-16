import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class SessionRename extends LabCommand {
  static description = 'Rename a session';

  static args = {
    id: Args.string({ description: 'The session id (default: the active one)' }),
  };

  static flags = {
    title: Flags.string({ char: 't', description: 'The new title', required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionRename);
    const lab = await this.requireLab();
    const id = args.id ?? lab.state.activeSessionId;
    const session = lab.state.sessions.find((candidate) => candidate.id === id);
    if (!session) {
      this.fail('No such session. `openlab session list` shows the ids.');
    }
    const before = session.title;
    lab.state.sessions = lab.state.sessions.map((candidate) =>
      candidate.id === session.id ? { ...candidate, title: flags.title } : candidate,
    );
    await lab.save();

    this.emit(
      { id: session.id, from: before, to: flags.title },
      () => `${out.mark.ok} ${out.c.grey(before)} → ${out.c.bold(flags.title)}`,
    );
  }
}
