/**
 * The workspace's research topics.
 *
 * A topic is a question, the databases to search for it and what the last run found. The rows
 * come from the same table the app's Autoresearch page reads, so a topic opened here is one the
 * page shows and can run.
 */

import { loadTopics } from '@/lib/db/research';
import { findDatabase } from '@/components/databases/store';

import { LabCommand } from '../../../lib/base';

export default class ComputeAutoresearchList extends LabCommand {
  static description = 'List the workspace’s research topics and what came of them';

  async run(): Promise<void> {
    await this.parse(ComputeAutoresearchList);
    const lab = await this.requireLab();
    const topics = await loadTopics(lab.db);
    const rows = topics.map((topic) => ({
      id: topic.id,
      question: topic.question,
      databases: topic.databaseIds.map((id) => findDatabase(id)?.name ?? id).join(', '),
      records: topic.recordCount,
      state: topic.status,
    }));

    this.list(
      rows,
      [
        { key: 'id', label: 'id' },
        { key: 'question', label: 'question', truncate: true, width: 52 },
        { key: 'databases', label: 'databases', truncate: true, width: 28 },
        { key: 'records', label: 'records', align: 'right' },
        { key: 'state', label: 'state' },
      ],
      'No topics yet. `openlab compute autoresearch new` opens one.',
    );
  }
}
