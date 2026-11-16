/**
 * The tracker's tasks, as a table.
 *
 * The same query the list screen runs: `filterTasks` narrows the store by whatever the flags
 * name, so the CLI and the app answer with the same rows. A `--wave`, `--assignee` or `--label`
 * may be an id or the name a person would type, because a name is what a person types.
 */

import { Flags } from '@oclif/core';

import {
  PRIORITY_META,
  STATUS_META,
  WORK_STATUSES,
  filterTasks,
  isOverdue,
  labelsOf,
  memberById,
  type Label,
  type Member,
  type Task,
  type TaskFilter,
  type Wave,
  type WorkStatus,
} from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** The wave a value names: an id, `W3`, `3`, or its name. */
export function waveNamed(waves: readonly Wave[], ref: string): Wave | undefined {
  const number = Number(ref.replace(/^w/i, ''));
  const name = ref.toLowerCase();
  return waves.find(
    (wave) =>
      wave.id === ref ||
      wave.name.toLowerCase() === name ||
      (Number.isFinite(number) && wave.number === number),
  );
}

/** The member a value names: an id, a name, initials, or a first name. */
export function memberNamed(members: readonly Member[], ref: string): Member | undefined {
  const name = ref.toLowerCase();
  return members.find(
    (member) =>
      member.id === ref ||
      member.name.toLowerCase() === name ||
      member.initials.toLowerCase() === name ||
      // The first name is how a person is usually named at a terminal.
      member.name.toLowerCase().split(/\s+/)[0] === name,
  );
}

/** The label a value names: an id or a name. */
export function labelNamed(labels: readonly Label[], ref: string): Label | undefined {
  const name = ref.toLowerCase();
  return labels.find((label) => label.id === ref || label.name.toLowerCase() === name);
}

export default class TaskList extends LabCommand {
  static description = 'List the tracker’s tasks';

  static flags = {
    status: Flags.string({ description: 'Only tasks in this status', options: [...WORK_STATUSES] }),
    wave: Flags.string({ description: 'Only tasks in this wave (id, W3, 3 or name)' }),
    assignee: Flags.string({ description: 'Only tasks this person owns (id, name or initials)' }),
    label: Flags.string({ description: 'Only tasks carrying this label (id or name)' }),
    search: Flags.string({ description: 'Only tasks whose title or key contains this text' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TaskList);
    const lab = await this.requireLab();
    const { tasks, waves, members, labels } = lab.state;

    const filter: TaskFilter = {};
    if (flags.status) {
      filter.status = [flags.status as WorkStatus];
    }
    if (flags.wave) {
      const wave = waveNamed(waves, flags.wave);
      if (!wave) this.fail(`No wave matches “${flags.wave}”.`);
      filter.waveId = [wave.id];
    }
    if (flags.assignee) {
      const member = memberNamed(members, flags.assignee);
      if (!member) this.fail(`No member matches “${flags.assignee}”.`);
      filter.assigneeId = [member.id];
    }
    if (flags.label) {
      const label = labelNamed(labels, flags.label);
      if (!label) this.fail(`No label matches “${flags.label}”.`);
      filter.label = [label.id];
    }
    if (flags.search) {
      filter.text = flags.search;
    }

    const rows = filterTasks(tasks, filter);

    this.list(
      rows,
      [
        { key: 'key', label: 'key' },
        { key: 'title', label: 'title', truncate: true, width: 44 },
        { key: 'status', label: 'status', format: (task) => STATUS_META[task.status].label },
        { key: 'priority', label: 'priority', format: (task) => PRIORITY_META[task.priority]?.short ?? '—' },
        {
          key: 'assigneeId',
          label: 'assignee',
          format: (task) => memberById(members, task.assigneeId)?.name ?? out.c.grey('unassigned'),
        },
        {
          key: 'labels',
          label: 'labels',
          format: (task) =>
            labelsOf(labels, task)
              .map((label) => label.name)
              .join(', ') || out.c.grey('—'),
        },
        {
          key: 'dueDate',
          label: 'due',
          format: (task) =>
            task.dueDate ? (isOverdue(task) ? out.c.red(task.dueDate) : task.dueDate) : out.c.grey('—'),
        },
      ],
      'No task matches. `openlab research tasks new` opens one.',
    );
  }
}
