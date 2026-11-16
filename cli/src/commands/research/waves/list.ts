/**
 * The waves, as a table.
 *
 * A wave is a bounded stretch of experiment time, so the columns answer "how much of it is
 * left" and "how much of it is done" before anything else. `waveDaysLeft` is the tracker's own
 * arithmetic, so a wave reads here the way it reads in the app.
 */

import { currentWave, waveDaysLeft, type Wave } from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** `12 days left`, or how far over it is once it has passed. */
export function daysLeftLabel(days: number): string {
  if (days > 1) return `${days} days left`;
  if (days === 1) return '1 day left';
  if (days === 0) return 'Last day';
  return `${-days} days over`;
}

/** A wave flattened with the counts and the time left, so the table and the JSON agree. */
export interface WaveRow {
  id: string;
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  goal: string;
  tasks: number;
  done: number;
  daysLeft: number;
  current: boolean;
}

export default class WaveList extends LabCommand {
  static description = 'List the waves: their dates, their goal and how much work is in them';

  async run(): Promise<void> {
    const { state } = await this.requireLab();
    const current = currentWave(state.waves);

    const rows: WaveRow[] = [...state.waves]
      .sort((a, b) => a.number - b.number)
      .map((wave: Wave) => {
        const tasks = state.tasks.filter((task) => task.waveId === wave.id);
        return {
          id: wave.id,
          number: wave.number,
          name: wave.name,
          startDate: wave.startDate,
          endDate: wave.endDate,
          goal: wave.goal,
          tasks: tasks.length,
          done: tasks.filter((task) => task.status === 'done').length,
          daysLeft: waveDaysLeft(wave),
          current: wave.id === current?.id,
        };
      });

    this.list(
      rows,
      [
        {
          key: 'number',
          label: 'wave',
          format: (row) => `${row.current ? out.c.cyan('▸ ') : ''}W${row.number}`,
        },
        { key: 'name', label: 'name', truncate: true, width: 28 },
        { key: 'dates', label: 'dates', format: (row) => `${row.startDate} → ${row.endDate}` },
        {
          key: 'tasks',
          label: 'tasks',
          align: 'right',
          format: (row) => `${row.tasks}${out.c.grey(` (${row.done} done)`)}`,
        },
        {
          key: 'time',
          label: 'time',
          format: (row) =>
            row.daysLeft < 0 ? out.c.red(daysLeftLabel(row.daysLeft)) : daysLeftLabel(row.daysLeft),
        },
        { key: 'goal', label: 'goal', truncate: true, width: 40 },
      ],
      'No waves yet. `openlab research waves new` opens one.',
    );
  }
}
