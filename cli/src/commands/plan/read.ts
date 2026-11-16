/**
 * Reading the plan back.
 *
 * The mirror of `plan export`: the files under `.openlab/plan/` as the workspace would open
 * them — the waves, the backlog, and any file that could not be read. A file that fails to
 * parse is reported rather than guessed at, because a half-read plan is worse than none.
 */

import { realpathSync } from 'node:fs';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { readPlan } from '../../lib/workspace';

export default class PlanRead extends LabCommand {
  static description = 'Read the plan back from .openlab/plan/';

  async run(): Promise<void> {
    const lab = await this.requireLab();
    const root = lab.root as string;
    // `readPlan` proves every path stays inside the folder by comparing against the folder's
    // real path, so it must be handed the real path — on macOS `/tmp` is a symlink to
    // `/private/tmp` and the raw root would read as "outside the workspace".
    const plan = readPlan(realpathSync(root));

    const value = {
      root,
      files: plan.files,
      waves: plan.waves.map((wave) => ({
        id: wave.id,
        number: wave.number,
        name: wave.name,
        start: wave.start,
        end: wave.end,
        goal: wave.goal,
        path: wave.path,
        items: wave.items,
      })),
      backlog: plan.backlog,
      problems: plan.problems,
    };

    this.emit(value, (read) => {
      if (read.files.length === 0) {
        return out.note('No plan files under .openlab/plan/. Run `openlab plan export` to write them.');
      }
      const lines = [
        `${out.mark.ok} Read ${read.files.length} plan files`,
        '',
        out.heading(`Waves (${read.waves.length})`),
      ];
      if (read.waves.length === 0) {
        lines.push(out.note('  none'));
      }
      for (const wave of read.waves) {
        lines.push(
          `  W${wave.number} · ${wave.name}  ${out.c.grey(`${wave.start} → ${wave.end}`)}  ${out.c.grey(wave.path)}`,
        );
        if (wave.goal) lines.push(`      ${wave.goal}`);
        for (const item of wave.items) {
          lines.push(
            `      ${out.c.grey('•')} ${item.key} ${item.title} ${out.c.grey(`· ${item.status} · ${item.kind} · p${item.priority} · @${item.assignee ?? 'none'}`)}`,
          );
        }
      }
      lines.push('', out.heading(`Backlog (${read.backlog.length})`));
      if (read.backlog.length === 0) {
        lines.push(out.note('  nothing in the backlog'));
      }
      for (const item of read.backlog) {
        lines.push(
          `  ${out.c.grey('•')} ${item.key} ${item.title} ${out.c.grey(`· ${item.status} · ${item.kind} · p${item.priority} · @${item.assignee ?? 'none'}`)}`,
        );
      }
      if (read.problems.length > 0) {
        lines.push(
          '',
          out.heading('Could not be read'),
          out.bullets(read.problems.map((problem) => out.c.red(problem))),
        );
      }
      return lines.join('\n');
    });
  }
}
