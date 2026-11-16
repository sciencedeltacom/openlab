/**
 * The working tree.
 *
 * The app's own git read: `--porcelain=v1 -z`, so a path with a space or a newline survives
 * intact, and the same letters the Git panel shows — index first, then work tree.
 */

import { LabCommand } from '../../lib/base';
import { status } from '../../lib/host/git';
import * as out from '../../lib/output';

export default class GitStatus extends LabCommand {
  static description = 'Show the branch, ahead/behind and every changed path';

  async run(): Promise<void> {
    const lab = await this.requireLab();
    const root = lab.root as string;
    const { info, files } = status(root);

    const value = { isRepo: info.isRepo, branch: info.branch, ahead: info.ahead, behind: info.behind, files };

    this.emit(value, (state) => {
      if (!state.isRepo) {
        return `${out.mark.warn} ${this.short(root)} is not a git repository`;
      }
      const marks = [
        state.branch ? out.c.bold(state.branch) : out.c.grey('detached HEAD'),
        state.ahead > 0 ? out.c.green(`↑${state.ahead}`) : '',
        state.behind > 0 ? out.c.red(`↓${state.behind}`) : '',
      ]
        .filter(Boolean)
        .join(' ');

      if (state.files.length === 0) {
        return `${marks}\n${out.note('clean, nothing changed')}`;
      }
      const rows = state.files.map((file) => ({
        status: `${file.index}${file.worktree}`,
        path: file.originalPath ? `${file.path} ← ${file.originalPath}` : file.path,
      }));
      return [
        marks,
        out.table(rows, [
          { key: 'status', label: 'st' },
          { key: 'path', label: 'path' },
        ]),
      ].join('\n');
    });
  }
}
