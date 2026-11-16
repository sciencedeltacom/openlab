/**
 * Queue a job.
 *
 * A job is a command and the machine it should reach, recorded in the ledger before anything
 * runs — the app's own `newJob`, so the record has the same shape the ledger and the agent read.
 * A wave is resolved the way the tracker resolves one (`3`, `W3`, an id or a name), and the
 * run carries the keys of that wave's tasks, which is how a run is tied back to the work it
 * serves.
 */

import { Flags } from '@oclif/core';

import { newJob } from '@/store/compute';
import { firstLine } from '@/lib/format';
import type { Wave } from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

/** The wave a reference names, by number (`3`, `W3`), by id, or by name. */
function waveFor(ref: string, waves: readonly Wave[]): Wave | undefined {
  const text = ref.trim();
  const number = text.replace(/^w/i, '');
  const wanted = text.toLowerCase();
  return (
    waves.find((wave) => wave.id.toLowerCase() === wanted) ??
    waves.find((wave) => String(wave.number) === number) ??
    waves.find((wave) => wave.name.toLowerCase() === wanted)
  );
}

export default class ComputeJobsNew extends LabCommand {
  static description = 'Queue a job on a target: a command and where it should run';

  static flags = {
    target: Flags.string({ description: 'The target to run on, by id or name', required: true }),
    command: Flags.string({ description: 'The exact command the run should execute', required: true }),
    name: Flags.string({ description: 'What the run is called (default: the command’s first line)' }),
    wave: Flags.string({ description: 'Attach the run to a wave’s tasks, by number, id or name' }),
    note: Flags.string({ description: 'One line on why the run exists, kept as its objective' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ComputeJobsNew);
    const lab = await this.requireLab();

    const wanted = flags.target;
    const target = lab.state.targets.find(
      (candidate) => candidate.id === wanted || candidate.name.toLowerCase() === wanted.toLowerCase(),
    );
    if (!target) {
      this.fail(`No target “${wanted}”. See \`openlab compute targets list\`.`);
    }

    let taskKeys: string[] = [];
    if (flags.wave) {
      const wave = waveFor(flags.wave, lab.state.waves);
      if (!wave) {
        const open = lab.state.waves.map((candidate) => `W${candidate.number} ${candidate.name}`).join('; ');
        this.fail(`No wave matches “${flags.wave}”. Open waves: ${open || 'none'}.`);
      }
      taskKeys = lab.state.tasks.filter((task) => task.waveId === wave.id).map((task) => task.key);
    }

    const job = newJob({
      name: flags.name?.trim() || firstLine(flags.command, 60),
      command: flags.command,
      targetId: target.id,
      objective: flags.note,
      taskKeys,
    });
    lab.state.jobs = [job, ...lab.state.jobs];
    await lab.save();

    this.emit(job, (queued) =>
      [
        `${out.mark.ok} Queued ${out.c.bold(queued.id)} “${queued.name}” on ${target.name}`,
        out.note(
          target.kind === 'local'
            ? `Run it with \`openlab compute run ${queued.id}\`.`
            : `Submitting to ${target.kind} needs the app; see \`openlab compute run --help\`.`,
        ),
      ].join('\n'),
    );
  }
}
