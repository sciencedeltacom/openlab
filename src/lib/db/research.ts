/**
 * The research topics, in and out of SQLite.
 *
 * App-level like the database catalogue: read whole at boot, written whole on change, with the
 * diffing syncer keeping the writes to the rows that actually changed.
 */

import type { ResearchTopic } from '../../components/autoresearch/data';

import type { Db } from './client';
import * as t from './schema';
import { TableSyncer } from './sync';

const topicSyncer = new TableSyncer<ResearchTopic>(t.researchTopics, (topic, position) => ({
  id: topic.id,
  position,
  question: topic.question,
  databaseIds: topic.databaseIds,
  agentIds: topic.agentIds,
  status: topic.status,
  findings: topic.findings,
  recordCount: topic.recordCount,
  updatedAt: topic.updatedAt,
}));

/** Every research topic, in order. */
export async function loadTopics(db: Db): Promise<ResearchTopic[]> {
  const rows = await db.select().from(t.researchTopics).orderBy(t.researchTopics.position);
  return rows.map(({ position: _position, ...topic }) => topic);
}

/** Write the topic list. */
export async function saveTopics(db: Db, items: readonly ResearchTopic[]): Promise<void> {
  await topicSyncer.sync(db, items);
}

/** Drop the write memory, so the next save rewrites everything. */
export function resetTopicSyncer(): void {
  topicSyncer.reset();
}
