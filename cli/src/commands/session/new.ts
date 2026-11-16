import { Flags } from '@oclif/core';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { startSession } from '../../lib/chat';

export default class SessionNew extends LabCommand {
  static description = 'Start a session in this lab';

  static flags = {
    title: Flags.string({ char: 't', description: 'What the session is for', default: 'Untitled session' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SessionNew);
    const lab = await this.requireLab();
    const id = startSession(lab, flags.title);
    await lab.save();

    this.emit(
      { id, title: flags.title, root: lab.root },
      () =>
        `${out.mark.ok} session ${out.c.bold(id)}: ${flags.title}\n${out.note(`\`openlab chat --session ${id} "…"\``)}`,
    );
  }
}
