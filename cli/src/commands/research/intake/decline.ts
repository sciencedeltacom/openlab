/**
 * Declining an intake row.
 *
 * The intake screen's Decline, with the two branches it takes: a task is closed, and an inbox
 * entry is read. As with Accept, the entry is read even when the row names a task, so the row
 * leaves the queue instead of sitting there because a decision moved something else.
 */

import { Args } from '@oclif/core';

import { intakeQueue, intakeStatus, type IntakeRow } from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** The row a value names: its queue id, or the key of the task it is about. */
function rowNamed(rows: readonly IntakeRow[], ref: string): IntakeRow | undefined {
  const key = ref.toLowerCase();
  return rows.find((row) => row.id === ref || (row.task ? row.task.key.toLowerCase() === key : false));
}

export default class IntakeDecline extends LabCommand {
  static description = 'Decline an intake row: close the task it is about, or dismiss the entry';

  static args = {
    row: Args.string({ description: 'The row’s id from `intake list`, or the task’s key', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(IntakeDecline);
    const lab = await this.requireLab();
    const state = lab.state;

    const row = rowNamed(intakeQueue(state.inbox, state.tasks), args.row);
    if (!row) this.fail(`No intake row matches “${args.row}”. Run \`openlab research intake list\`.`);

    let closed: { id: string; key: string; title: string } | null = null;
    if (row.task) {
      const task = state.tasks.find((candidate) => candidate.id === row.task?.id);
      if (!task) this.fail(`The task behind “${args.row}” is no longer in the tracker.`);
      task.status = intakeStatus('declined');
      task.updatedAt = Date.now();
      closed = { id: task.id, key: task.key, title: task.title };
    }

    const entry = row.entryId ? state.inbox.find((candidate) => candidate.id === row.entryId) : undefined;
    if (entry) {
      entry.read = true;
    }

    await lab.save();

    this.emit(
      {
        row: row.id,
        decision: 'declined',
        task: closed ? { ...closed, status: intakeStatus('declined') } : null,
        entry: entry ? { id: entry.id, read: entry.read } : null,
      },
      (result) =>
        result.task
          ? `${out.mark.ok} Closed ${out.c.bold(result.task.key)} ${out.c.grey(result.task.title)}`
          : `${out.mark.ok} Dismissed ${out.c.grey(row.body)}`,
    );
  }
}
