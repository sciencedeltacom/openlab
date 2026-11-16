import { Flags } from '@oclif/core';

import { relativeTime } from '@/lib/format';

import { LabCommand } from '../../lib/base';
import { messagesOf, phaseLabel } from '../../lib/sessions';

export default class SessionList extends LabCommand {
  static description = 'List this lab’s sessions';

  static flags = {
    all: Flags.boolean({ description: 'Include archived sessions' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SessionList);
    const lab = await this.requireLab();
    const rows = [...lab.state.sessions]
      .filter((session) => flags.all || session.phase !== 'PUBLISHED')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => ({
        id: session.id,
        title: session.title,
        phase: phaseLabel(session.phase),
        turns: messagesOf(lab, session.id).length,
        updated: relativeTime(session.updatedAt),
        pinned: session.pinned ? 'pinned' : '',
      }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'title', label: 'title', truncate: true, width: 44 },
        { key: 'phase', label: 'phase' },
        { key: 'turns', label: 'turns', align: 'right' },
        { key: 'updated', label: 'updated' },
        { key: 'pinned', label: '' },
      ],
      'No sessions yet. `openlab chat "…"` starts one.',
    );
  }
}
