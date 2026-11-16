/**
 * The dashboard, one command deep.
 *
 * Everything the app's home screen would tell you about the folder it has open: what the lab
 * is, where its work stands, and what it can reach. It is the command to run when you have
 * been away from a project, and the one that proves the CLI found the same lab the app has.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { LabCommand } from '../lib/base';
import * as out from '../lib/output';
import { databasePath, shortPath } from '../lib/paths';
import { readLabConfig, readFigures, readPlan } from '../lib/workspace';
import { status as gitStatus } from '../lib/host/git';
import { withCatalog } from '../lib/models';

/** A page count for the wiki, or 0 when there is none. */
function wikiPages(root: string): number {
  const dir = join(root, 'openwiki');
  if (!existsSync(dir)) return 0;
  const glob = new Bun.Glob('**/*.md');
  return [...glob.scanSync({ cwd: dir, onlyFiles: true })].length;
}

export default class Status extends LabCommand {
  static description = 'Show the lab the CLI has open: its folder, its work and what it can reach';

  async run(): Promise<void> {
    const lab = await this.requireLab();
    const root = lab.root as string;
    const config = readLabConfig(root);
    const git = gitStatus(root);
    const plan = readPlan(root);
    const figures = readFigures(root);
    const state = withCatalog(lab.state);

    const counts = {
      sessions: state.sessions.length,
      tasks: state.tasks.length,
      waves: state.waves.length,
      openTasks: state.tasks.filter((task) => task.status !== 'done').length,
      jobs: state.jobs.length,
      targets: state.targets.length,
      figures: figures.figures.length,
      wikiPages: wikiPages(root),
      results: state.results.length,
    };
    const providers = state.customProviders.length + state.catalogProviders.length;

    const value = {
      root,
      name: config?.name ?? lab.project?.name ?? null,
      protocols: config?.protocols.map((protocol) => protocol.id) ?? [],
      git: git.info.isRepo
        ? { branch: git.info.branch, dirty: git.files.length, ahead: git.info.ahead, behind: git.info.behind }
        : null,
      plan: { waves: plan.waves.length, backlog: plan.backlog.length, files: plan.files.length },
      figures: { documents: figures.figures.length, problems: figures.problems.length },
      counts,
      model: state.modelRef,
      packs: state.enabledPacks,
      storage: { database: databasePath(), dataDir: shortPath(databasePath().replace(/\/[^/]+$/, '')) },
      catalogProviders: providers,
    };

    this.emit(value, (status) => {
      const lines = [
        out.brand(),
        '',
        out.keyValues([
          ['lab', `${out.c.bold(status.name ?? 'unnamed')}  ${out.c.grey(shortPath(status.root))}`],
          ['model', status.model],
          ['packs', status.packs.length > 0 ? status.packs.join(', ') : out.c.grey('none opened')],
          [
            'git',
            status.git
              ? `${status.git.branch ?? out.c.grey('detached')} ${status.git.dirty > 0 ? out.c.yellow(`${status.git.dirty} changed`) : out.c.green('clean')}`
              : out.c.grey('not a repository'),
          ],
        ]),
        '',
        out.heading('Work'),
        out.keyValues([
          ['sessions', String(status.counts.sessions)],
          ['tasks', `${status.counts.tasks} ${out.c.grey(`(${status.counts.openTasks} open)`)}`],
          ['waves', String(status.counts.waves)],
          ['jobs', `${status.counts.jobs} ${out.c.grey(`· ${status.counts.targets} targets`)}`],
          ['figures', `${status.counts.figures} ${out.c.grey(`· ${status.plan.files} plan files`)}`],
          ['wiki', `${status.counts.wikiPages} pages`],
        ]),
      ];
      if (status.protocols.length > 0) {
        lines.push('', out.heading('Protocols'), out.bullets(status.protocols));
      }
      return lines.join('\n');
    });
  }
}
