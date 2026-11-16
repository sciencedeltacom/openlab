/**
 * Opening a task.
 *
 * The toolbar's "new task" without the toolbar: `newTask` gives the row its id and its next
 * key, the flags fill in the fields worth asking for, and the row is put at the top of the
 * tracker the way the store does it. `--wave`, `--assignee` and `--label` take a name as
 * readily as an id.
 */

import { Flags } from '@oclif/core';

import { PLAN_BACKLOG, wavePath } from '@/lib/plan/format';
import { TASK_KINDS, newTask, type Label, type Member, type TaskKind, type Wave } from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

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

/** A value that names a label: an id or a name. */
function labelNamed(labels: readonly Label[], ref: string): Label | undefined {
  const name = ref.toLowerCase();
  return labels.find((label) => label.id === ref || label.name.toLowerCase() === name);
}

export default class TaskNew extends LabCommand {
  static description = 'Open a task in the tracker';

  static flags = {
    title: Flags.string({ char: 't', description: 'What the task is', required: true }),
    kind: Flags.string({ description: 'The kind of work', options: [...TASK_KINDS] }),
    priority: Flags.string({
      description: 'Priority, 0 none … 4 urgent',
      options: ['0', '1', '2', '3', '4'],
    }),
    wave: Flags.string({ description: 'The wave to file it in (id, W3, 3 or name)' }),
    assignee: Flags.string({ description: 'Who owns it (id, name or initials)' }),
    due: Flags.string({ description: 'A due date, YYYY-MM-DD' }),
    label: Flags.string({ description: 'A label to carry; repeat for more', multiple: true }),
    description: Flags.string({ char: 'd', description: 'A longer description' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TaskNew);
    const lab = await this.requireLab();
    const state = lab.state;

    const task = newTask(state.tasks, flags.title);
    if (flags.kind) task.kind = flags.kind as TaskKind;
    if (flags.priority) task.priority = Number(flags.priority);
    if (flags.description) task.description = flags.description;

    if (flags.due) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(flags.due)) this.fail(`“${flags.due}” is not a YYYY-MM-DD date.`);
      task.dueDate = flags.due;
    }
    if (flags.wave) {
      const wave = waveNamed(state.waves, flags.wave);
      if (!wave) this.fail(`No wave matches “${flags.wave}”.`);
      task.waveId = wave.id;
    }
    if (flags.assignee) {
      const member = memberNamed(state.members, flags.assignee);
      if (!member) this.fail(`No member matches “${flags.assignee}”.`);
      task.assigneeId = member.id;
    }
    if (flags.label && flags.label.length > 0) {
      task.labels = flags.label.map((ref) => {
        const label = labelNamed(state.labels, ref);
        if (!label)
          this.fail(`No label matches “${ref}”. Create one with \`openlab research labels --new\`.`);
        return label.id;
      });
    }

    // The store's own `task/create` puts the newest first, so a fresh task is at the top.
    state.tasks = [task, ...state.tasks];
    await lab.save();

    const wave = state.waves.find((candidate) => candidate.id === task.waveId);
    const planFile = wave ? wavePath(wave) : PLAN_BACKLOG;
    this.emit({ id: task.id, key: task.key, title: task.title, status: task.status, planFile }, (created) =>
      [
        `${out.mark.ok} ${out.c.bold(created.key)} opened`,
        out.keyValues([
          ['title', created.title],
          ['status', created.status],
          ['plan file', created.planFile],
        ]),
        '',
        out.note(`Next: \`openlab research tasks show ${created.key}\`, or \`plan export\`.`),
      ].join('\n'),
    );
  }
}
