/**
 * One wave: its window, its goal, the work inside it and the compute it spent.
 *
 * The wave's page without the page, plus the one thing the page shows only as a path: the jobs
 * that ran for the tasks in this wave. `jobsOfWave` links them the app's way — a job carries the
 * task keys it was run for, so a wave owns its tasks' jobs.
 */

import { Args } from '@oclif/core';

import { jobsOfWave, wavePath } from '@/lib/plan/format';
import { PRIORITY_META, STATUS_META, waveDaysLeft, type Wave } from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** The wave a value names: an id, `W3`, `3`, or its name. */
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

/** `12 days left`, or how far over it is once it has passed. */
function daysLeftLabel(days: number): string {
  if (days > 1) return `${days} days left`;
  if (days === 1) return '1 day left';
  if (days === 0) return 'Last day';
  return `${-days} days over`;
}

export default class WaveShow extends LabCommand {
  static description = 'Show one wave: its tasks, its jobs and the plan file it lives in';

  static args = {
    wave: Args.string({ description: 'The wave’s id, W3, 3 or name', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(WaveShow);
    const lab = await this.requireLab();
    const state = lab.state;

    const wave = waveNamed(state.waves, args.wave);
    if (!wave) this.fail(`No wave matches “${args.wave}”.`);

    const tasks = state.tasks.filter((task) => task.waveId === wave.id);
    const jobs = jobsOfWave(state.jobs, tasks);
    const done = tasks.filter((task) => task.status === 'done').length;
    const left = waveDaysLeft(wave);
    const file = wavePath(wave);

    const value = {
      id: wave.id,
      number: wave.number,
      name: wave.name,
      startDate: wave.startDate,
      endDate: wave.endDate,
      goal: wave.goal,
      daysLeft: left,
      tasks: tasks.map((task) => ({
        id: task.id,
        key: task.key,
        title: task.title,
        status: task.status,
        priority: task.priority,
      })),
      jobs: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        state: job.state,
        cpuHours: job.cpuHours,
        gpuHours: job.gpuHours,
        taskKeys: job.taskKeys,
      })),
      planFile: file,
    };

    this.emit(value, (shown) => {
      const lines = [
        out.c.bold(`W${shown.number} · ${shown.name}`),
        out.keyValues([
          ['id', shown.id],
          ['window', `${shown.startDate} → ${shown.endDate}`],
          ['time', left < 0 ? out.c.red(daysLeftLabel(left)) : daysLeftLabel(left)],
          ['tasks', `${shown.tasks.length} ${out.c.grey(`(${done} done)`)}`],
          ['plan file', shown.planFile],
        ]),
      ];
      if (shown.goal) {
        lines.push('', out.heading('Goal'), shown.goal);
      }
      lines.push(
        '',
        out.heading('Tasks'),
        shown.tasks.length > 0
          ? out.bullets(
              shown.tasks.map(
                (task) =>
                  `${task.key} ${task.title} ${out.c.grey(`· ${STATUS_META[task.status].label} · ${PRIORITY_META[task.priority]?.short ?? '—'}`)}`,
              ),
            )
          : out.note('No task planned into this wave.'),
      );
      if (shown.jobs.length > 0) {
        lines.push(
          '',
          out.heading('Compute'),
          out.bullets(
            shown.jobs.map(
              (job) =>
                `${job.id} · ${job.name} · ${job.gpuHours !== null ? `${job.gpuHours} GPU-h` : job.cpuHours !== null ? `${job.cpuHours} CPU-h` : '—'} · ${job.state}`,
            ),
          ),
        );
      }
      return lines.join('\n');
    });
  }
}
