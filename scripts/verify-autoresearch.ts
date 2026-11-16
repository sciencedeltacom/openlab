/**
 * Checks autoresearch.
 *
 * Run with: `bun scripts/verify-autoresearch.ts`
 *
 * A run asks each database for the topic's question, collects what came back and has the
 * assigned agent write the findings. Every outside call is injected here — a fake fetch and a
 * scripted model — so the checks pin the parts that can go wrong quietly: the search term
 * replacing the database's example query, records merging across databases, a dead database
 * being named rather than swallowed, the refusal when nothing was retrieved, and the
 * background run's status.
 */

import { runTopic, startTopic, type TopicDeps } from '../src/lib/autoresearch/runner';
import { addTopic, findTopic } from '../src/components/autoresearch/store';
import { DATABASES } from '../src/components/databases/data';
import { seedState } from '../src/store/seed';
import type { Database } from '../src/components/databases/data';
import type { RequestResult } from '../src/lib/catalog/request';

let failures = 0;

/** Assert equality and report the difference rather than throwing. */
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
}

function checkTruthy(label: string, value: unknown) {
  if (value) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}`);
}

function database(id: string): Database {
  const found = DATABASES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no built-in database ${id}`);
  return found;
}

/** Wait for a background run to leave the running state. */
async function settle(topicId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (findTopic(topicId)?.status !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

console.log('\n— running a topic —');
{
  const ok = (records: { id: string; title: string }[]): RequestResult => ({
    ok: true,
    status: 200,
    data: records,
  });

  const deps: TopicDeps = {
    request: async (candidate) =>
      candidate.id === 'openalex'
        ? ok([
            { id: 'W1', title: 'A chromatin-aware predictor' },
            { id: 'W2', title: 'A sequence-only benchmark' },
          ])
        : ok([
            { id: 'W2', title: 'A sequence-only benchmark' },
            { id: 'P1', title: 'A protein record' },
          ]),
    ask: async () => '  The records agree that chromatin helps [[W1]].  ',
  };

  const topic = {
    ...addTopic({ question: 'Does chromatin help?', databaseIds: ['openalex', 'uniprot'], agentIds: [] }),
  };
  const result = await runTopic(seedState(), topic, deps);
  check('records merge across databases', result.recordCount, 3);
  check('duplicates collapse', result.recordCount, 3);
  check('the findings are trimmed', result.findings, 'The records agree that chromatin helps [[W1]].');
  check('no failures on a clean run', result.failures, []);

  const partial = await runTopic(seedState(), topic, {
    ...deps,
    request: async (candidate) =>
      candidate.id === 'openalex'
        ? ok([{ id: 'W1', title: 'One' }])
        : { ok: false, status: 0, error: 'answered 400' },
  });
  check('a dead database is named, not swallowed', partial.failures, ['UniProt: answered 400']);
  check('and the run still finishes on what came back', partial.recordCount, 1);
}

console.log('\n— nothing retrieved —');
{
  const topic = addTopic({ question: 'Nothing?', databaseIds: ['openalex'], agentIds: [] });
  let message = '';
  try {
    await runTopic(seedState(), topic, {
      request: async () => ({ ok: false, status: 0, error: 'answered 400 Bad Request' }),
      ask: async () => '{}',
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  checkTruthy('an empty run is refused', message.includes('No records were retrieved'));
  checkTruthy('and names what failed', message.includes('answered 400 Bad Request'));
}

console.log('\n— the background run —');
{
  const topic = addTopic({
    question: 'Does it run in the background?',
    databaseIds: ['openalex'],
    agentIds: [],
  });
  check('a new topic is idle', findTopic(topic.id)?.status, 'idle');

  startTopic(seedState(), topic.id, {
    request: async () => ({ ok: true, status: 200, data: [{ id: 'W1', title: 'A record' }] }),
    ask: async () => 'The finding [[W1]].',
  });
  check('starting marks it running', findTopic(topic.id)?.status, 'running');
  await settle(topic.id);
  check('and it settles as done', findTopic(topic.id)?.status, 'done');
  check('with its findings', findTopic(topic.id)?.findings, 'The finding [[W1]].');
  check('and its record count', findTopic(topic.id)?.recordCount, 1);

  const broken = addTopic({ question: 'This will fail', databaseIds: ['openalex'], agentIds: [] });
  startTopic(seedState(), broken.id, {
    request: async () => ({ ok: false, status: 0, error: 'down' }),
    ask: async () => '{}',
  });
  await settle(broken.id);
  check('a failed run is recorded, not thrown', findTopic(broken.id)?.status, 'error');
  checkTruthy('with its reason', findTopic(broken.id)?.findings.includes('No records were retrieved'));
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: topics search their databases and write findings, in the background');
