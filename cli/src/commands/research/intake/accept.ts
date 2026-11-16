/**
 * Accepting an intake row.
 *
 * The intake screen's Accept, with the two branches it takes: a task is planned, and an inbox
 * entry is read. The screen's code returns after the first branch, so an entry that names a
 * task keeps its row in the queue even though the work moved; here the entry is read as well,
 * which is what the screen's own copy promises — "Accept plans the work" — and what makes the
 * row leave.
 */

import { Args } from '@oclif/core';

import { intakeQueue, intakeStatus, type IntakeRow } from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** The row a value names: its queue id, or the key of the task it is about. */
export function rowNamed(rows: readonly IntakeRow[], ref: string): IntakeRow | undefined {
  const key = ref.toLowerCase();
  return rows.find((row) => row.id === ref || (row.task ? row.task.key.toLowerCase() === key : false));
}

export default class IntakeAccept extends LabCommand {
  static description = 'Accept an intake row: plan the task it is about, or read the entry';

  static args = {
    row: Args.string({ description: 'The row’s id from `intake list`, or the task’s key', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(IntakeAccept);
    const lab = await this.requireLab();
    const state = lab.state;

    const row = rowNamed(intakeQueue(state.inbox, state.tasks), args.row);
    if (!row) this.fail(`No intake row matches “${args.row}”. Run \`openlab research intake list\`.`);

    let planned: { id: string; key: string; title: string } | null = null;
    if (row.task) {
      const task = state.tasks.find((candidate) => candidate.id === row.task?.id);
      if (!task) this.fail(`The task behind “${args.row}” is no longer in the tracker.`);
      task.status = intakeStatus('accepted');
      task.updatedAt = Date.now();
      planned = { id: task.id, key: task.key, title: task.title };
    }

    const entry = row.entryId ? state.inbox.find((candidate) => candidate.id === row.entryId) : undefined;
    if (entry) {
      entry.read = true;
    }

    await lab.save();

    this.emit(
      {
        row: row.id,
        decision: 'accepted',
        task: planned ? { ...planned, status: intakeStatus('accepted') } : null,
        entry: entry ? { id: entry.id, read: entry.read } : null,
      },
      (result) =>
        result.task
          ? `${out.mark.ok} Planned ${out.c.bold(result.task.key)} ${out.c.grey(result.task.title)}`
          : `${out.mark.ok} Kept for the record ${out.c.grey(row.body)}`,
    );
  }
}
