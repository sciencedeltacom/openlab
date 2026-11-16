/**
 * Removing a task.
 *
 * The row menu's Remove, which the app offers behind a confirmation. A command has no dialog
 * to show, so `--yes` is the confirmation: without it the command refuses and names what it
 * would have removed.
 */

import { Args, Flags } from '@oclif/core';

import type { Task } from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** The task a value names: its id or its key, however it is cased. */
function taskNamed(tasks: readonly Task[], ref: string): Task | undefined {
  const key = ref.toLowerCase();
  return tasks.find((task) => task.id === ref || task.key.toLowerCase() === key);
}

export default class TaskRemove extends LabCommand {
  static description = 'Remove a task from the tracker';

  static args = {
    task: Args.string({ description: 'The task’s id or key', required: true }),
  };

  static flags = {
    yes: Flags.boolean({ description: 'Confirm the removal; without it the command refuses' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TaskRemove);
    const lab = await this.requireLab();

    const task = taskNamed(lab.state.tasks, args.task);
    if (!task) this.fail(`No task matches “${args.task}”.`);
    if (!flags.yes) {
      this.fail(`Refusing to remove ${task.key} “${task.title}”. Pass --yes to confirm.`);
    }

    lab.state.tasks = lab.state.tasks.filter((candidate) => candidate.id !== task.id);
    await lab.save();

    this.emit(
      { id: task.id, key: task.key, title: task.title, removed: true },
      (removed) => `${out.mark.ok} Removed ${out.c.bold(removed.key)} ${out.c.grey(removed.title)}`,
    );
  }
}
