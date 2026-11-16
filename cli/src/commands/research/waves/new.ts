/**
 * Opening a wave.
 *
 * `newWave` numbers it after the highest already in use and gives it a fortnight starting
 * today; the flags override what a person knows better. Dates are checked here because a wave
 * with a malformed window would only fail later, in the plan file.
 */

import { Flags } from '@oclif/core';

import { wavePath } from '@/lib/plan/format';
import { newWave } from '@/store/research';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

export default class WaveNew extends LabCommand {
  static description = 'Open a wave: a bounded stretch of experiment time';

  static flags = {
    name: Flags.string({ char: 'n', description: 'What the wave is called' }),
    start: Flags.string({ description: 'Start date, YYYY-MM-DD (default: today)' }),
    end: Flags.string({ description: 'End date, YYYY-MM-DD (default: a fortnight out)' }),
    goal: Flags.string({ char: 'g', description: 'What the wave is for' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WaveNew);
    const lab = await this.requireLab();
    const state = lab.state;

    const wave = newWave(state.waves);
    if (flags.name) wave.name = flags.name;
    if (flags.goal) wave.goal = flags.goal;
    for (const [label, value] of [
      ['start', flags.start],
      ['end', flags.end],
    ] as const) {
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
        this.fail(`“${value}” is not a YYYY-MM-DD ${label} date.`);
    }
    if (flags.start) wave.startDate = flags.start;
    if (flags.end) wave.endDate = flags.end;

    // The store's own `wave/create` puts the newest first.
    state.waves = [wave, ...state.waves];
    await lab.save();

    this.emit(
      { id: wave.id, number: wave.number, name: wave.name, startDate: wave.startDate, endDate: wave.endDate },
      (created) =>
        [
          `${out.mark.ok} ${out.c.bold(`W${created.number} · ${created.name}`)} opened`,
          out.keyValues([
            ['window', `${created.startDate} → ${created.endDate}`],
            ['plan file', wavePath(wave)],
          ]),
          '',
          out.note('Next: `openlab plan export` writes the wave to `.openlab/plan/`.'),
        ].join('\n'),
    );
  }
}
