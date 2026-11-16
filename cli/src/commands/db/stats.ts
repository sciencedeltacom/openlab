/**
 * The store at a glance.
 *
 * The counts a person asks for first — projects, sessions, messages, tasks, waves, jobs,
 * sources, reviews — and how big the file is.
 */

import { existsSync, statSync } from 'node:fs';

import { formatBytes } from '@/lib/format';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { databasePath, shortPath } from '../../lib/paths';

export default class DbStats extends LabCommand {
  static description = 'Show the store at a glance';

  async run(): Promise<void> {
    const lab = await this.lab({ root: null });
    const count = (table: string): number =>
      (lab.sqlite.query(`select count(*) as n from "${table}"`).get() as { n: number }).n;

    const database = databasePath();
    const size = existsSync(database) ? statSync(database).size : 0;
    const value = {
      projects: count('projects'),
      sessions: count('sessions'),
      messages: count('messages'),
      tasks: count('tasks'),
      waves: count('waves'),
      jobs: count('jobs'),
      sources: count('sources'),
      reviews: count('reviews'),
      database,
      size,
    };

    this.emit(value, (stats) =>
      [
        out.heading('Store'),
        out.keyValues([
          ['projects', String(stats.projects)],
          ['sessions', String(stats.sessions)],
          ['messages', String(stats.messages)],
          ['tasks', String(stats.tasks)],
          ['waves', String(stats.waves)],
          ['jobs', String(stats.jobs)],
          ['sources', String(stats.sources)],
          ['reviews', String(stats.reviews)],
          ['database', `${formatBytes(stats.size)}  ${out.c.grey(shortPath(stats.database))}`],
        ]),
      ].join('\n'),
    );
  }
}
