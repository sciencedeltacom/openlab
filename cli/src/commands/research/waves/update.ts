/**
 * Changing a wave.
 *
 * The wave page's own edits: rename it, move its window, restate its goal. Only the flags that
 * were passed change, so setting an end date leaves the name alone.
 */

import { Args, Flags } from '@oclif/core';

import type { Wave } from '@/store/research';

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

export default class WaveUpdate extends LabCommand {
  static description = 'Change a wave: its name, its dates or its goal';

  static args = {
    wave: Args.string({ description: 'The wave’s id, W3, 3 or name', required: true }),
  };

  static flags = {
    name: Flags.string({ char: 'n', description: 'A new name' }),
    start: Flags.string({ description: 'A new start date, YYYY-MM-DD' }),
    end: Flags.string({ description: 'A new end date, YYYY-MM-DD' }),
    goal: Flags.string({ char: 'g', description: 'A new goal' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WaveUpdate);
    const lab = await this.requireLab();

    const wave = waveNamed(lab.state.waves, args.wave);
    if (!wave) this.fail(`No wave matches “${args.wave}”.`);

    const changed: string[] = [];
    if (flags.name) {
      wave.name = flags.name;
      changed.push('name');
    }
    if (flags.goal !== undefined) {
      wave.goal = flags.goal;
      changed.push('goal');
    }
    for (const [label, value] of [
      ['start', flags.start],
      ['end', flags.end],
    ] as const) {
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
        this.fail(`“${value}” is not a YYYY-MM-DD ${label} date.`);
    }
    if (flags.start) {
      wave.startDate = flags.start;
      changed.push('start');
    }
    if (flags.end) {
      wave.endDate = flags.end;
      changed.push('end');
    }

    if (changed.length === 0) {
      this.fail('Nothing to change. Pass --name, --start, --end or --goal.');
    }

    await lab.save();

    this.emit(
      {
        id: wave.id,
        number: wave.number,
        name: wave.name,
        startDate: wave.startDate,
        endDate: wave.endDate,
        goal: wave.goal,
        changed,
      },
      (updated) =>
        [
          `${out.mark.ok} ${out.c.bold(`W${updated.number} · ${updated.name}`)} updated`,
          out.keyValues([
            ['changed', updated.changed.join(', ')],
            ['window', `${updated.startDate} → ${updated.endDate}`],
          ]),
        ].join('\n'),
    );
  }
}
