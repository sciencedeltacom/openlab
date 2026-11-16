/**
 * Changing a task.
 *
 * The row menu's edits, all at once: every field the detail view can patch, plus `--note` to
 * append a comment. Only the flags that were passed change, so a command that sets a status
 * leaves the title alone. `none` clears an owner, a wave or a due date.
 */

import { Args, Flags } from '@oclif/core';

import {
  WORK_STATUSES,
  memberById,
  type Member,
  type Task,
  type Wave,
  type WorkStatus,
} from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** The task a value names: its id or its key, however it is cased. */
function taskNamed(tasks: readonly Task[], ref: string): Task | undefined {
  const key = ref.toLowerCase();
  return tasks.find((task) => task.id === ref || task.key.toLowerCase() === key);
}

/** A value that names a wave: an id, `W3`, `3`, or its name. */
function waveNamed(waves: readonly Wave[], ref: string): Wave | undefined {
  const number = Number(ref.replace(/^w/i, ''));
  const name = ref.toLowerCase();
  return waves.find(
    (wave) =>
      wave.id === ref ||
      wave.name.toLowerCase() === name ||
      (Number.isFinite(number) && wave.number === number),
  );
}

/** A value that names a member: an id, a name, initials, or a first name. */
function memberNamed(members: readonly Member[], ref: string): Member | undefined {
  const name = ref.toLowerCase();
  return members.find(
    (member) =>
      member.id === ref ||
      member.name.toLowerCase() === name ||
      member.initials.toLowerCase() === name ||
      member.name.toLowerCase().split(/\s+/)[0] === name,
  );
}

/** True when a flag was passed as `none`, `-` or empty, the way a person clears a field. */
function clears(value: string): boolean {
  return value === 'none' || value === '-' || value === '';
}

export default class TaskUpdate extends LabCommand {
  static description = 'Change a task: its status, owner, wave, due date, priority or a note';

  static args = {
    task: Args.string({ description: 'The task’s id or key', required: true }),
  };

  static flags = {
    status: Flags.string({ description: 'The new status', options: [...WORK_STATUSES] }),
    title: Flags.string({ description: 'A new title' }),
    priority: Flags.string({
      description: 'Priority, 0 none … 4 urgent',
      options: ['0', '1', '2', '3', '4'],
    }),
    wave: Flags.string({ description: 'The wave to move it to, or `none`' }),
    assignee: Flags.string({ description: 'The owner (id, name or initials), or `none`' }),
    due: Flags.string({ description: 'A due date YYYY-MM-DD, or `none`' }),
    description: Flags.string({ description: 'A new description' }),
    note: Flags.string({ description: 'A comment to append to the task' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TaskUpdate);
    const lab = await this.requireLab();
    const state = lab.state;

    const task = taskNamed(state.tasks, args.task);
    if (!task) this.fail(`No task matches “${args.task}”.`);

    const changed: string[] = [];
    if (flags.status) {
      task.status = flags.status as WorkStatus;
      changed.push(`status ${flags.status}`);
    }
    if (flags.title) {
      task.title = flags.title;
      changed.push('title');
    }
    if (flags.priority) {
      task.priority = Number(flags.priority);
      changed.push(`priority ${flags.priority}`);
    }
    if (flags.description !== undefined) {
      task.description = flags.description;
      changed.push('description');
    }
    if (flags.wave !== undefined) {
      if (clears(flags.wave)) {
        task.waveId = null;
        changed.push('wave none');
      } else {
        const wave = waveNamed(state.waves, flags.wave);
        if (!wave) this.fail(`No wave matches “${flags.wave}”.`);
        task.waveId = wave.id;
        changed.push(`wave W${wave.number}`);
      }
    }
    if (flags.assignee !== undefined) {
      if (clears(flags.assignee)) {
        task.assigneeId = null;
        changed.push('assignee none');
      } else {
        const member = memberNamed(state.members, flags.assignee);
        if (!member) this.fail(`No member matches “${flags.assignee}”.`);
        task.assigneeId = member.id;
        changed.push(`assignee ${member.name}`);
      }
    }
    if (flags.due !== undefined) {
      if (clears(flags.due)) {
        task.dueDate = null;
        changed.push('due none');
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(flags.due)) this.fail(`“${flags.due}” is not a YYYY-MM-DD date.`);
        task.dueDate = flags.due;
        changed.push(`due ${flags.due}`);
      }
    }
    if (flags.note) {
      // The detail view authors a comment as the first member in the workspace, or nobody.
      task.comments = [
        ...task.comments,
        {
          id: `c-${crypto.randomUUID().slice(0, 8)}`,
          authorId: state.members[0]?.id ?? '',
          body: flags.note,
          createdAt: Date.now(),
          reactions: {},
        },
      ];
      changed.push('note');
    }

    if (changed.length === 0) {
      this.fail(
        'Nothing to change. Pass --status, --title, --priority, --wave, --assignee, --due, --description or --note.',
      );
    }

    task.updatedAt = Date.now();
    await lab.save();

    const assignee = memberById(state.members, task.assigneeId);
    this.emit(
      {
        id: task.id,
        key: task.key,
        title: task.title,
        status: task.status,
        priority: task.priority,
        waveId: task.waveId,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
        comments: task.comments.length,
        changed,
      },
      (updated) =>
        [
          `${out.mark.ok} ${out.c.bold(updated.key)} updated`,
          out.keyValues([
            ['changed', updated.changed.join(', ')],
            ['status', updated.status],
            ['assignee', assignee?.name ?? out.c.grey('unassigned')],
          ]),
        ].join('\n'),
    );
  }
}
