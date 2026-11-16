/**
 * The people in the lab.
 *
 * A member is what a task's owner resolves to and what a comment is attributed to, so this is
 * where a person is added before the tracker can assign anything to them. `newMember` derives
 * the initials and the avatar tint the same way the app does.
 */

import { Flags } from '@oclif/core';

import { newMember } from '@/store/research';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

export default class ResearchMembers extends LabCommand {
  static description = 'List the lab’s members, or add one';

  static flags = {
    new: Flags.boolean({ description: 'Add a member instead of listing them' }),
    name: Flags.string({ char: 'n', description: 'The person’s name (with --new)' }),
    role: Flags.string({ char: 'r', description: 'What they do, e.g. “PhD student”' }),
    email: Flags.string({ char: 'e', description: 'Their work address' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ResearchMembers);
    const lab = await this.requireLab();
    const state = lab.state;

    if (flags.new) {
      if (!flags.name) this.fail('A member needs a --name.');
      const member = newMember(flags.name, flags.role ?? '', flags.email ?? '');
      // The store's own `member/create` puts the newest first.
      state.members = [member, ...state.members];
      await lab.save();
      this.emit(
        member,
        (created) =>
          `${out.mark.ok} Added ${out.c.bold(created.name)} ${out.c.grey(`(${created.initials})`)}`,
      );
      return;
    }

    this.list(
      state.members,
      [
        { key: 'name', label: 'name', truncate: true, width: 28 },
        { key: 'initials', label: 'initials' },
        { key: 'role', label: 'role', truncate: true, width: 24 },
        { key: 'email', label: 'email', truncate: true, width: 32 },
        {
          key: 'tasks',
          label: 'tasks',
          align: 'right',
          format: (member) => String(state.tasks.filter((task) => task.assigneeId === member.id).length),
        },
      ],
      'No members yet. `openlab research members --new --name "Ada Lovelace"` adds one.',
    );
  }
}
