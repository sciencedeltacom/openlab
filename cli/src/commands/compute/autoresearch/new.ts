/**
 * Open a research topic.
 *
 * A topic is a question and the catalogue databases to search for it; the app's own store adds
 * it and persists it, so the Autoresearch page picks it up. The databases are checked against
 * the catalogue here rather than left to fail on the first run, because a topic with a
 * mistyped database is a run that cannot say anything.
 */

import { Flags } from '@oclif/core';

import { addTopic } from '@/components/autoresearch/store';
import { allDatabases, findDatabase } from '@/components/databases/store';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

export default class ComputeAutoresearchNew extends LabCommand {
  static description = 'Open a research topic: a question and the databases to search for it';

  static flags = {
    question: Flags.string({ description: 'The research question the run answers', required: true }),
    database: Flags.string({
      description: 'A catalogue database id to search; repeat for more',
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ComputeAutoresearchNew);
    const lab = await this.requireLab();

    const wanted = flags.database ?? [];
    const unknown = wanted.filter((id) => !findDatabase(id));
    if (unknown.length > 0) {
      const known = allDatabases()
        .map((database) => database.id)
        .join(', ');
      this.fail(`No database ${unknown.join(', ')} in the catalogue. Known: ${known || 'none'}.`);
    }

    const topic = addTopic({ question: flags.question, databaseIds: wanted });
    // The store queues its write; draining it here means the topic is in the database before
    // this process exits, so the next command reads it back.
    await lab.save();

    this.emit(topic, (opened) =>
      [
        `${out.mark.ok} Opened ${out.c.bold(opened.id)}`,
        out.keyValues([
          ['question', opened.question],
          ['databases', opened.databaseIds.join(', ') || out.c.grey('none. Assign one before running')],
          ['state', opened.status],
        ]),
        '',
        out.note('Run it from the app’s Autoresearch page; a run writes its findings back here.'),
      ].join('\n'),
    );
  }
}
