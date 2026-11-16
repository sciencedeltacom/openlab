/**
 * The lab's notes.
 *
 * A note is a line of thinking that belongs to no task in particular, so this is the shortest
 * command in the tracker: list them, or add one with `--add`. The app has no notes surface yet,
 * so the CLI writes the same record the store would hold.
 */

import { Flags } from '@oclif/core';

import { relativeTime } from '@/lib/format';
import type { Note } from '@/store/research';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class ResearchNotes extends LabCommand {
  static description = 'List the lab’s notes, or add one';

  static flags = {
    add: Flags.boolean({ description: 'Write a new note instead of listing them' }),
    title: Flags.string({ char: 't', description: 'The note’s title (with --add)' }),
    body: Flags.string({ char: 'b', description: 'The note’s body (with --add)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ResearchNotes);
    const lab = await this.requireLab();
    const state = lab.state;

    if (flags.add) {
      if (!flags.title) this.fail('A note needs a --title.');
      const note: Note = {
        id: `n-${crypto.randomUUID().slice(0, 8)}`,
        title: flags.title,
        body: flags.body ?? '',
        authorId: state.members[0]?.id ?? '',
        updatedAt: Date.now(),
      };
      // The store's own `note/create` puts the newest first.
      state.notes = [note, ...state.notes];
      await lab.save();
      this.emit(note, (created) => `${out.mark.ok} Wrote note ${out.c.bold(created.title)}`);
      return;
    }

    this.list(
      state.notes,
      [
        { key: 'title', label: 'title', truncate: true, width: 32 },
        {
          key: 'authorId',
          label: 'author',
          format: (note) =>
            state.members.find((member) => member.id === note.authorId)?.name ?? out.c.grey('—'),
        },
        { key: 'updatedAt', label: 'updated', format: (note) => relativeTime(note.updatedAt) },
        {
          key: 'body',
          label: 'body',
          truncate: true,
          width: 52,
          format: (note) => note.body.replace(/\s+/g, ' ').trim(),
        },
      ],
      'No notes yet. `openlab research notes --add --title "…"` writes one.',
    );
  }
}
