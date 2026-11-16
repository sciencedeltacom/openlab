/**
 * The tracker, in numbers.
 *
 * The analytics surface without the charts. The view computes its bars inline from the store's
 * own helpers (`WORK_STATUSES`, `TASK_KINDS`, `isOverdue`, per-wave task counts); this command
 * computes the same numbers and prints them as text and bars, so a terminal and a dashboard
 * cannot disagree about the same tracker.
 *
 * The one number the view does not carry is throughput over the last weeks, because a bar per
 * wave is what it draws instead. The tracker records no completion time, so "closed" reads a
 * done task's last update — a proxy, and said so rather than hidden.
 */

import { Flags } from '@oclif/core';

import {
  KIND_META,
  PRIORITY_META,
  STATUS_META,
  TASK_KINDS,
  WORK_STATUSES,
  isOverdue,
  waveDaysLeft,
} from '@/store/research';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';

const DAY = 86_400_000;

/** A local date as `YYYY-MM-DD`, so a week boundary does not drift through UTC. */
function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A labelled count, for a bar row. */
interface Bar {
  label: string;
  value: number;
}

export default class ResearchAnalytics extends LabCommand {
  static description = 'The tracker in numbers: by status, kind, priority, wave and week';

  static flags = {
    weeks: Flags.integer({
      description: 'How many weeks of throughput to show',
      default: 8,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ResearchAnalytics);
    const { state } = await this.requireLab();
    const tasks = state.tasks;

    const byStatus: Bar[] = WORK_STATUSES.map((status) => ({
      label: STATUS_META[status].label,
      value: tasks.filter((task) => task.status === status).length,
    }));
    const byKind: Bar[] = TASK_KINDS.map((kind) => ({
      label: KIND_META[kind].label,
      value: tasks.filter((task) => task.kind === kind).length,
    }));
    const byPriority: Bar[] = [4, 3, 2, 1, 0].map((priority) => ({
      label: PRIORITY_META[priority].label,
      value: tasks.filter((task) => task.priority === priority).length,
    }));
    const byAssignee: Bar[] = [
      ...state.members.map((member) => ({
        label: member.name,
        value: tasks.filter((task) => task.assigneeId === member.id).length,
      })),
      { label: 'Unassigned', value: tasks.filter((task) => task.assigneeId === null).length },
    ];

    const waves = [...state.waves]
      .sort((a, b) => a.number - b.number)
      .map((wave) => {
        const inWave = tasks.filter((task) => task.waveId === wave.id);
        const done = inWave.filter((task) => task.status === 'done').length;
        return {
          id: wave.id,
          number: wave.number,
          name: wave.name,
          total: inWave.length,
          done,
          daysLeft: waveDaysLeft(wave),
          percent: inWave.length > 0 ? Math.round((done / inWave.length) * 100) : 0,
        };
      });

    const overdue = tasks.filter((task) => isOverdue(task)).length;
    const covered = tasks.filter((task) => task.evidence.some((item) => item.verified)).length;

    // Throughput by week: opened is when a task was created, closed is a done task's last
    // update — the tracker keeps no completion time, so the column is named for what it is.
    const weeks = Math.max(1, flags.weeks);
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const weekOf = (at: number) => Math.max(0, Math.floor((midnight.getTime() - at) / (7 * DAY)));
    const weekly = Array.from({ length: weeks }, (_, index) => {
      const ago = weeks - 1 - index;
      return {
        week: isoDay(new Date(midnight.getTime() - ago * 7 * DAY)),
        opened: tasks.filter((task) => weekOf(task.createdAt) === ago).length,
        closed: tasks.filter((task) => task.status === 'done' && weekOf(task.updatedAt) === ago).length,
      };
    });

    const value = {
      tasks: tasks.length,
      byStatus,
      byKind,
      byPriority,
      byAssignee,
      overdue,
      evidence: { covered, total: tasks.length },
      waves,
      weekly,
    };

    this.emit(value, (shown) => {
      const section = (title: string, bars: Bar[], total: number): string[] => [
        '',
        out.heading(title),
        ...bars.map((bar) => {
          const share = total > 0 ? bar.value / total : 0;
          return `  ${bar.label.padEnd(14)} ${String(bar.value).padStart(3)}  ${out.bar(share, 12)}`;
        }),
      ];
      const lines = [
        `${out.c.bold(String(shown.tasks))} tasks`,
        ...section('By status', shown.byStatus, shown.tasks),
        ...section('By kind', shown.byKind, shown.tasks),
        ...section('By priority', shown.byPriority, shown.tasks),
        ...section('By assignee', shown.byAssignee, shown.tasks),
      ];

      lines.push('', out.heading('Per-wave progress'));
      if (shown.waves.length === 0) {
        lines.push(out.note('  No waves yet.'));
      } else {
        for (const wave of shown.waves) {
          lines.push(
            `  W${String(wave.number).padEnd(3)} ${wave.name.padEnd(24)} ${String(wave.done).padStart(3)}/${String(wave.total).padEnd(3)} ${out.bar(wave.total > 0 ? wave.done / wave.total : 0, 10)} ${String(wave.percent).padStart(3)}%`,
          );
        }
      }

      lines.push(
        '',
        out.heading(`Throughput, last ${shown.weekly.length} weeks`),
        out.table(shown.weekly, [
          { key: 'week', label: 'week' },
          { key: 'opened', label: 'opened', align: 'right' },
          { key: 'closed', label: 'closed', align: 'right' },
        ]),
        out.note('  closed counts done tasks by their last update; the tracker keeps no completion time.'),
        '',
        out.keyValues([
          ['overdue', `${shown.overdue} of ${shown.tasks} past due and open`],
          ['evidence', `${shown.evidence.covered}/${shown.evidence.total} tasks cite a verified artefact`],
        ]),
      );
      return lines.join('\n');
    });
  }
}
