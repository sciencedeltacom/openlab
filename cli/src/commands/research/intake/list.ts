/**
 * The intake queue.
 *
 * Two things wait for a person, exactly as the intake screen shows them: work the tracker took
 * on but nobody owns — every task an agent opens — and what the inbox has not been read. The
 * queue is derived from the records by `intakeQueue`, so it says what the app would say.
 */

import { intakeQueue, inboxUnread } from '@/store/research';
import { relativeTime } from '@/lib/format';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

export default class IntakeList extends LabCommand {
  static description = 'Show the intake queue: work with no owner and unread inbox entries';

  async run(): Promise<void> {
    const { state } = await this.requireLab();
    const queue = intakeQueue(state.inbox, state.tasks);
    const unread = inboxUnread(state.inbox);

    const rows = queue.map((item) => ({
      id: item.id,
      kind: item.kind,
      source: item.entryId ? 'inbox' : 'backlog',
      body: item.body,
      task: item.task ? { id: item.task.id, key: item.task.key, title: item.task.title } : null,
      createdAt: item.createdAt,
      age: relativeTime(item.createdAt),
      // A row from the inbox is there because the entry is unread; a backlog row is not an
      // inbox entry at all.
      unread: item.entryId !== null,
    }));

    this.emit({ unread, count: rows.length, rows }, (shown) => {
      if (shown.rows.length === 0) {
        return out.note('The queue is clear. Nothing is waiting for a decision.');
      }
      return [
        out.table(shown.rows, [
          { key: 'id', label: 'id' },
          { key: 'source', label: 'source' },
          {
            key: 'unread',
            label: 'unread',
            format: (row) => (row.unread ? out.mark.ok : out.c.grey('·')),
          },
          { key: 'body', label: 'what', truncate: true, width: 52 },
          {
            key: 'task',
            label: 'task',
            format: (row) => (row.task ? `${row.task.key} ${out.c.grey(row.task.title)}` : out.c.grey('—')),
          },
          { key: 'age', label: 'age' },
        ]),
        '',
        out.note(`${shown.count} waiting · ${shown.unread} unread in the inbox`),
        out.note('Accept or decline a row by its id: `openlab research intake accept <id>`.'),
      ].join('\n');
    });
  }
}
