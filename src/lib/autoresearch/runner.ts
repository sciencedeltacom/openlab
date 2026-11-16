/**
 * Running a research topic.
 *
 * A topic is a question, the databases to search for it and the agents assigned to it. A run
 * asks each database, collects what came back, and has the assigned agent's model write the
 * findings from those records — a small, checkable account of what was looked at.
 *
 * The request and the model call are injectable, so the whole run can be driven by a scripted
 * model and a fake fetch in the verification script.
 */

import { askOnce } from '@/lib/ai/oneshot';
import { runOperation, type RequestResult } from '@/lib/catalog/request';
import { parseRecords } from '@/lib/catalog/sources';
import { findAgent } from '@/components/agents/store';
import { findDatabase } from '@/components/databases/store';
import { findOperation } from '@/components/databases/data';
import { findTopic, patchTopic } from '@/components/autoresearch/store';
import type { ResearchTopic } from '@/components/autoresearch/data';
import type { Database } from '@/components/databases/data';
import type { AppState } from '@/store/types';

const RESEARCH_SYSTEM = [
  'You are the research agent of openlab. Given a question and the records a set of databases',
  'returned for it, write the findings a reader can act on: what the records agree on, where',
  'they disagree, and what is missing. Cite a claim with the record id inline as [[id]].',
  'Do not invent records, and say plainly when the records do not answer the question.',
].join('\n');

/** One record the databases returned, flattened for the prompt. */
interface Found {
  id: string;
  title: string;
  year?: number;
  venue?: string;
  database: string;
}

/** What a run produced. */
export interface TopicResult {
  findings: string;
  recordCount: number;
  failures: string[];
}

/** The two outside calls a run makes, overridable for tests. */
export interface TopicDeps {
  request?: (
    database: Database,
    operationId: string,
    args: Record<string, unknown>,
  ) => Promise<RequestResult>;
  ask?: typeof askOnce;
}

/** Run one topic end to end: search every database, then write the findings. */
export async function runTopic(
  state: AppState,
  topic: ResearchTopic,
  deps: TopicDeps = {},
): Promise<TopicResult> {
  const request =
    deps.request ?? ((database, operationId, args) => runOperation(database, operationId, args));
  const ask = deps.ask ?? askOnce;

  const seen = new Set<string>();
  const records: Found[] = [];
  const failures: string[] = [];
  for (const id of topic.databaseIds) {
    const database = findDatabase(id);
    if (!database) {
      failures.push(`${id}: no longer in the catalogue`);
      continue;
    }
    const find = findOperation(database);
    if (!find) {
      failures.push(`${database.name}: no operation to search with`);
      continue;
    }
    try {
      const result = await request(database, find.id, { query: topic.question, limit: 20 });
      if (!result.ok) {
        failures.push(`${database.name}: ${result.error}`);
        continue;
      }
      for (const record of parseRecords(result.data)) {
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        records.push({
          id: record.id,
          title: record.title,
          ...(record.year ? { year: record.year } : {}),
          ...(record.venue ? { venue: record.venue } : {}),
          database: database.name,
        });
      }
    } catch (error) {
      failures.push(`${database.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (records.length === 0) {
    throw new Error(
      failures.length > 0
        ? `No records were retrieved. ${failures.join('; ')}`
        : 'No records were retrieved. Assign a database whose path takes a search term.',
    );
  }

  // The assigned agent decides the model and adds its own instructions.
  const agent = topic.agentIds.map((id) => findAgent(id)).find((candidate) => Boolean(candidate));
  const system = agent?.instructions.trim()
    ? `${RESEARCH_SYSTEM}\n\n${agent.instructions.trim()}`
    : RESEARCH_SYSTEM;
  const modelState = agent?.modelRef ? { ...state, modelRef: agent.modelRef } : state;

  const findings = await ask(
    modelState,
    [
      `Research question: ${topic.question}`,
      `Databases searched: ${topic.databaseIds.join(', ') || 'none'}`,
      '',
      'Records:',
      records
        .slice(0, 40)
        .map(
          (record) =>
            `- id: ${record.id}\n  ${record.title}${record.year ? ` (${record.year}${record.venue ? `, ${record.venue}` : ''})` : ''} [${record.database}]`,
        )
        .join('\n'),
    ].join('\n'),
    { system },
  );

  return { findings: findings.trim(), recordCount: records.length, failures };
}

/** Start a topic's run in the background; the topic's status is the progress. */
export function startTopic(state: AppState, topicId: string, deps: TopicDeps = {}): void {
  const topic = findTopic(topicId);
  if (!topic || topic.status === 'running') {
    return;
  }
  patchTopic(topicId, { status: 'running', findings: '', recordCount: 0 });
  void (async () => {
    try {
      const result = await runTopic(state, topic, deps);
      patchTopic(topicId, { status: 'done', findings: result.findings, recordCount: result.recordCount });
    } catch (error) {
      patchTopic(topicId, {
        status: 'error',
        findings: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}
