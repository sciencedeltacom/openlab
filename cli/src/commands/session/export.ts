import { Args, Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { messagesOf, transcriptMarkdown } from '../../lib/sessions';

export default class SessionExport extends LabCommand {
  static description = 'Export a session’s transcript as Markdown';

  static args = {
    id: Args.string({ description: 'The session id (default: the active one)' }),
  };

  static flags = {
    out: Flags.string({
      char: 'o',
      description: 'Write to this file inside the workspace instead of stdout',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionExport);
    const lab = await this.requireLab();
    const id = args.id ?? lab.state.activeSessionId ?? undefined;
    const session = this.require(
      id ? lab.state.sessions.find((candidate) => candidate.id === id) : undefined,
      'No such session. `openlab session list` shows the ids.',
    );

    const markdown = transcriptMarkdown(lab, session.id);
    const destination = flags.out;
    if (destination) {
      const { writeFile } = await import('../../lib/host/fs');
      writeFile(destination, markdown, lab.root);
      const count = messagesOf(lab, session.id).length;
      this.emit(
        { id: session.id, path: destination, messages: count },
        () => `${out.mark.ok} wrote ${out.c.bold(destination)} (${count} messages)`,
      );
      return;
    }
    this.log(markdown);
  }
}
