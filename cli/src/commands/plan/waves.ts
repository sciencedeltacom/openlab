/**
 * The planned waves, as the files describe them.
 *
 * Where `plan read` reports everything the folder holds, this is only the waves: each one's
 * front matter and the task lines under it, read back from the markdown a person would open.
 */

import { realpathSync } from 'node:fs';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { readPlan } from '../../lib/workspace';

export default class PlanWaves extends LabCommand {
  static description = 'Show the planned waves with the task lines their files carry';

  async run(): Promise<void> {
    const lab = await this.requireLab();
    const root = lab.root as string;
    // The real path, so `readPlan`'s containment check agrees with itself (see `plan read`).
    const plan = readPlan(realpathSync(root));

    const waves = plan.waves
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((wave) => ({
        id: wave.id,
        number: wave.number,
        name: wave.name,
        start: wave.start,
        end: wave.end,
        goal: wave.goal,
        path: wave.path,
        items: wave.items,
      }));

    this.emit({ root, waves, problems: plan.problems }, (read) => {
      if (read.waves.length === 0) {
        return out.note('No wave files under .openlab/plan/waves/. Run `openlab plan export`.');
      }
      const lines: string[] = [];
      for (const wave of read.waves) {
        lines.push(
          out.c.bold(`W${wave.number} · ${wave.name}`),
          out.keyValues([
            ['window', `${wave.start} → ${wave.end}`],
            ['file', wave.path],
            ['items', String(wave.items.length)],
          ]),
        );
        if (wave.goal) lines.push('', wave.goal);
        if (wave.items.length > 0) {
          lines.push(
            '',
            out.bullets(
              wave.items.map(
                (item) =>
                  `${item.key} ${item.title} ${out.c.grey(`· ${item.status} · ${item.kind} · p${item.priority} · @${item.assignee ?? 'none'}`)}`,
              ),
            ),
          );
        }
        lines.push('');
      }
      if (read.problems.length > 0) {
        lines.push(
          out.heading('Could not be read'),
          out.bullets(read.problems.map((problem) => out.c.red(problem))),
        );
      }
      return lines.join('\n');
    });
  }
}
