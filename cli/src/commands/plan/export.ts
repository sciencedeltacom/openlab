/**
 * Writing the plan to disk.
 *
 * The plan lives inside the app; `.openlab/plan/` is the same plan as files, so git carries it
 * and a reader without the app can open it. This writes the files through the app's own
 * renderer, so what lands here is byte-for-byte what the app would have written.
 */

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { writePlan } from '../../lib/workspace';

export default class PlanExport extends LabCommand {
  static description = 'Write .openlab/plan/ from the tracker';

  async run(): Promise<void> {
    const lab = await this.requireLab();
    const root = lab.root as string;
    const { waves, tasks, members, jobs } = lab.state;

    // `writePlan` answers with the workspace-relative paths it wrote.
    const files = writePlan(root, { waves, tasks, members, jobs });

    this.emit({ root, files, waves: waves.length, tasks: tasks.length }, (plan) => {
      if (plan.files.length === 0) {
        return out.note('Nothing to write: the plan is empty.');
      }
      return [
        `${out.mark.ok} Wrote ${plan.files.length} plan files`,
        out.keyValues([
          ['folder', '.openlab/plan/'],
          ['waves', String(plan.waves)],
          ['tasks', String(plan.tasks)],
        ]),
        '',
        out.bullets(plan.files),
      ].join('\n');
    });
  }
}
