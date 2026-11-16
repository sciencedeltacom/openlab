/**
 * Checks the literature review pipeline.
 *
 * Run with: `bun scripts/verify-literature.ts`
 *
 * A review is two model calls and a retrieval, and every one of them can go wrong quietly: a
 * source that answers nothing, a model that returns prose instead of JSON, a run abandoned
 * when the reader leaves the page. These checks drive the whole pipeline with a scripted model
 * and a fake fetch — no network — and pin what each phase must produce: the screened decisions,
 * the extracted cells, the written report, the failure when nothing was retrieved, and the
 * background runner's transitions.
 */

import {
  addSource,
  findSource,
  parseRecords,
  patchSource,
  queryFromQuestion,
} from '../src/lib/catalog/sources';
import { parseBody } from '../src/lib/catalog/request';
import {
  retrieveFromSources,
  resolveSources,
  runReview,
  type ReviewInputs,
  type ReviewRun,
} from '../src/lib/literature/pipeline';
import { reviewRun, startReview, type ReviewRunner } from '../src/lib/literature/runner';
import { services } from '../src/lib/container';
import type { SettledRun } from '../src/lib/services/reviews';
import { REVIEWS, collectCitations, findReview, type ReviewReport } from '../src/components/literature/data';
import { seedState } from '../src/store/seed';
import type { Paper } from '../src/components/literature/data';

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

const now = Date.now();

/** A source saved against the built-in OpenAlex database. */
addSource({
  id: 'src-test',
  name: 'OpenAlex test',
  databaseId: 'openalex',
  filters: { query: 'chromatin', types: ['article'], limit: 5 },
  preview: [],
  createdAt: now,
});

console.log('\n— editing a source —');
{
  patchSource('src-test', {
    name: 'OpenAlex chromatin',
    filters: { query: 'chromatin accessibility', types: ['article', 'review'], limit: 40 },
  });
  const edited = findSource('src-test');
  check('the name is changed', edited?.name, 'OpenAlex chromatin');
  check('the filters are changed', edited?.filters.query, 'chromatin accessibility');
  check('the types are changed', edited?.filters.types, ['article', 'review']);
  check('the limit is changed', edited?.filters.limit, 40);
  check('the database is kept', edited?.databaseId, 'openalex');
}

const inputs: ReviewInputs = {
  question: 'Does chromatin accessibility improve off-target prediction?',
  inclusion: 'Reports a predictor',
  exclusion: 'No human cells',
  dateRange: '2015 – 2026',
  sources: ['src-test'],
  maxRecords: 24,
  depth: 'standard',
  analysis: ['Narrative synthesis'],
  format: 'narrative',
};

/** One retrieved paper, as the pipeline builds it. */
function paper(id: string, title: string): Paper {
  return {
    id,
    title,
    authors: [],
    venue: 'OpenAlex',
    year: 2024,
    abstract: '',
    seed: null,
    extraction: {
      population: { value: '' },
      intervention: { value: '' },
      design: { value: '' },
      outcomes: { value: '' },
      health: { value: '' },
    },
  };
}

/* ================================================================================================
 * Retrieval
 * ============================================================================================== */

console.log('\n— retrieval —');
{
  check(
    'unknown source ids are dropped',
    resolveSources(['src-test', 'missing']).map((s) => s.id),
    ['src-test'],
  );

  const merged = await retrieveFromSources(['src-test'], 10, 1, async () => [
    { id: 'r1', title: 'First', year: 2020, venue: 'Nature' },
    { id: 'r2', title: 'Second' },
  ]);
  check(
    'records come back',
    merged.records.map((entry) => entry.paper.id),
    ['r1', 'r2'],
  );
  check('with the source named', merged.records[0]?.sourceName, 'OpenAlex chromatin');
  check('a record without a year gets one', typeof merged.records[1]?.paper.year, 'number');
  check('no failures on a clean run', merged.failures, []);

  const deduped = await retrieveFromSources(['src-test'], 10, 1, async () => [
    { id: 'r1', title: 'First' },
    { id: 'r1', title: 'First again' },
  ]);
  check(
    'duplicate ids collapse',
    deduped.records.map((entry) => entry.paper.id),
    ['r1'],
  );

  const limited = await retrieveFromSources(['src-test'], 1, 1, async () => [
    { id: 'r1', title: 'First' },
    { id: 'r2', title: 'Second' },
  ]);
  check('the limit is applied', limited.records.length, 1);

  const failed = await retrieveFromSources(['src-test'], 10, 1, async () => {
    throw new Error('api.openalex.org answered 400 Bad Request');
  });
  check('a failed source is reported, not swallowed', failed.failures, [
    'OpenAlex chromatin: api.openalex.org answered 400 Bad Request',
  ]);
  check('and yields no records', failed.records.length, 0);
}

/* ================================================================================================
 * The pipeline
 * ============================================================================================== */

console.log('\n— the proxy body —');
{
  // `proxy_request` answers with the body as text. Reading `.results` off a string is what made
  // every review retrieve nothing; the body has to be parsed first.
  const body =
    '{"meta":{"count":2},"results":[{"id":"https://openalex.org/W1","title":"A work","publication_year":2023}]}';
  const parsed = parseRecords(parseBody(body));
  check(
    'a JSON body is parsed before its records are read',
    parsed.map((record) => record.title),
    ['A work'],
  );
  check('and the year survives', parsed[0]?.year, 2023);
  check('a text body stays text', parseBody('not json'), 'not json');
  check('a decoded body is left alone', parseBody([{ id: 'x' }]), [{ id: 'x' }]);
}

console.log('\n— the pipeline —');
{
  const answers = [
    JSON.stringify({
      criteria: [{ id: 'human', label: 'Human cells', question: 'Studies human cells' }],
      records: [
        {
          id: 'r1',
          decision: 'include',
          score: 5,
          rationale: 'Directly answers it',
          extraction: { population: 'Human cells' },
        },
        { id: 'r2', decision: 'exclude', score: 2, rationale: 'No chromatin term' },
      ],
    }),
    JSON.stringify({
      markdown: 'The predictor improved ranking @record:R1.',
    }),
  ];
  let call = 0;
  const ask = async () => answers[Math.min(call++, answers.length - 1)];
  const retrieve = async () => ({
    records: [
      { paper: paper('r1', 'A chromatin-aware predictor'), sourceName: 'OpenAlex test' },
      { paper: paper('r2', 'A sequence-only benchmark'), sourceName: 'OpenAlex test' },
    ],
    failures: [],
  });

  const progress: string[] = [];
  const early: string[] = [];
  const run = await runReview(seedState(), inputs, 'review-test', (message) => progress.push(message), {
    ask,
    retrieve,
    onRetrieved: (papers) => early.push(...papers.map((paper) => paper.id)),
  });

  check('the records are handed over before screening', early, ['r1', 'r2']);

  check('the review counts what was retrieved', run.review.total, 2);
  check('the decisions land on the review', run.review.seed, { r1: 'include', r2: 'exclude' });
  check(
    'and on the papers',
    run.papers.map((entry) => [entry.id, entry.seed]),
    [
      ['r1', 'include'],
      ['r2', 'exclude'],
    ],
  );
  check('extraction is written onto the paper', run.papers[0]?.extraction.population.value, 'Human cells');
  check(
    'the meta carries the score and rationale',
    [run.meta.r1?.score, run.meta.r1?.rationale],
    [5, 'Directly answers it'],
  );
  check('and the source that answered', run.meta.r1?.source, 'OpenAlex test');
  check(
    'the criteria come from the model',
    run.content.criteria.map((c) => c.label),
    ['Human cells'],
  );
  check(
    'the report is written as markdown',
    (run.content.report.body ?? '').includes('improved ranking'),
    true,
  );
  check('and the report cites by record key', (run.content.report.body ?? '').includes('@record:R1'), true);
  check('the review lists its records', run.review.paperIds, ['r1', 'r2']);
  check('and its protocol', run.review.protocol.length, 7);
  checkTruthy('progress was announced', progress.length >= 3);

  // A model that answers with prose rather than JSON is a failed run, not an empty "complete"
  // review: the reader must see why, and the log must carry what the model actually said.
  let proseError = '';
  const proseLog: string[] = [];
  try {
    await runReview(seedState(), inputs, 'review-prose', () => {}, {
      ask: async () => 'I could not produce JSON.',
      retrieve,
      onLog: (message) => proseLog.push(message),
    });
    check('a non-JSON screening answer is refused', 'resolved', 'rejected');
  } catch (error) {
    proseError = error instanceof Error ? error.message : String(error);
  }
  checkTruthy('the failure names the missing JSON', proseError.includes('did not return screening JSON'));
  checkTruthy(
    'and the raw answer is in the log',
    proseLog.some((line) => line.includes('I could not produce JSON')),
  );
  checkTruthy(
    'and the retry was attempted',
    proseLog.some((line) => line.includes('asking again')),
  );

  // One prose answer, then JSON: the retry saves the run.
  const retryLog: string[] = [];
  let attempt = 0;
  const retried = await runReview(seedState(), inputs, 'review-retry', () => {}, {
    ask: async () => {
      attempt += 1;
      return attempt === 1
        ? 'Here is my analysis, in prose.'
        : JSON.stringify({ records: [{ id: 'r1', decision: 'include', score: 5 }] });
    },
    retrieve,
    onLog: (message) => retryLog.push(message),
  });
  check('a retried screening still screens', retried.review.seed, { r1: 'include' });
  checkTruthy(
    'and the log shows the retry',
    retryLog.some((line) => line.includes('asking again')),
  );
}

console.log('\n— tolerant id matching —');
{
  // OpenAlex stores ids as full URLs; the model echoes them as bare work ids. A correct
  // decision must not be dropped just because the spellings differ.
  const openalexPaper = paper('https://openalex.org/W3038568908', 'A gut microbiome study');
  const run = await runReview(seedState(), inputs, 'review-ids', () => {}, {
    ask: async () => JSON.stringify({ records: [{ id: 'W3038568908', decision: 'include', score: 4 }] }),
    retrieve: async () => ({
      records: [{ paper: openalexPaper, sourceName: 'OpenAlex' }],
      failures: [],
    }),
  });
  check('a bare id matches its stored URL form', run.review.seed, {
    'https://openalex.org/W3038568908': 'include',
  });
  check('and the paper itself is marked', run.papers[0]?.seed, 'include');
}

console.log('\n— searching the question —');
{
  check('wildcards are stripped from the query', queryFromQuestion('How much? *damage*'), 'How much damage');
  check('whitespace collapses', queryFromQuestion('  a   b '), 'a b');

  const [record] = parseRecords([
    {
      id: 'https://openalex.org/W1',
      title: 'A work',
      publication_year: 2023,
      cited_by_count: 42,
      authorships: [{ author: { display_name: 'A. Author' } }, { author: { display_name: 'B. Author' } }],
      abstract_inverted_index: { Gut: [0], microbiome: [1], matters: [2] },
    },
  ]);
  check('the abstract is rebuilt from the inverted index', record?.abstract, 'Gut microbiome matters');
  check('authors come from authorships', record?.authors, ['A. Author', 'B. Author']);
  check('citations are carried', record?.citations, 42);

  // The question is what reaches the database, and the abstract is what the model reads.
  let seenQuery = '';
  const seenPrompts: string[] = [];
  await runReview(seedState(), inputs, 'review-query', () => {}, {
    retrieve: async (_ids, _limit, _page, _fetch, query) => {
      seenQuery = query ?? '';
      return {
        records: [
          {
            paper: { ...paper('r1', 'A chromatin predictor'), abstract: 'Accessibility improves ranking.' },
            sourceName: 'OpenAlex',
          },
        ],
        failures: [],
      };
    },
    ask: async (_state, prompt) => {
      seenPrompts.push(prompt);
      return JSON.stringify({ records: [{ id: 'r1', decision: 'include', score: 5 }] });
    },
  });
  check('the question drives the search', seenQuery, queryFromQuestion(inputs.question));
  checkTruthy(
    'and the abstract reaches the screening prompt',
    seenPrompts.some((prompt) => prompt.includes('Accessibility improves ranking.')),
  );
}

console.log('\n— looking further —');
{
  // Page one is all excluded; the run should fetch page two and screen it too.
  const pages: number[] = [];
  const retrieve = async (_sources: readonly string[], _limit: number, page = 1) => {
    pages.push(page);
    return page === 1
      ? {
          records: [{ paper: paper('x1', 'An unrelated battery paper'), sourceName: 'OpenAlex test' }],
          failures: [],
        }
      : {
          records: [{ paper: paper('x2', 'A chromatin-aware predictor'), sourceName: 'OpenAlex test' }],
          failures: [],
        };
  };
  let call = 0;
  const ask = async () => {
    call += 1;
    if (call === 1) {
      return JSON.stringify({ records: [{ id: 'x1', decision: 'exclude', score: 1 }] });
    }
    if (call === 2) {
      return JSON.stringify({
        records: [{ id: 'x2', decision: 'include', score: 5, rationale: 'Answers it' }],
      });
    }
    return JSON.stringify({ markdown: 'One record answered it.' });
  };

  const run = await runReview(seedState(), inputs, 'review-pages', () => {}, { ask, retrieve });
  check('the run reads a second page when the first is all excluded', pages, [1, 2]);
  check('and the included record is kept', run.review.seed.x2, 'include');
  check('with both pages on the board', run.review.total, 2);
  check('and the protocol says how many pages were read', run.review.protocol.at(-2), {
    label: 'Pages searched',
    value: '2',
  });
}

console.log('\n— nothing retrieved —');
{
  let message = '';
  try {
    await runReview(seedState(), inputs, 'review-empty', () => {}, {
      ask: async () => '{}',
      retrieve: async () => ({
        records: [],
        failures: ['OpenAlex test: api.openalex.org answered 400 Bad Request'],
      }),
    });
    check('an empty review is refused', 'resolved', 'rejected');
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  checkTruthy('the failure says nothing was retrieved', message.includes('No records were retrieved'));
  checkTruthy(
    'and names the source that failed',
    message.includes('api.openalex.org answered 400 Bad Request'),
  );
}

/* ================================================================================================
 * The background runner
 * ============================================================================================== */

console.log('\n— the runner —');
{
  const result: ReviewRun = {
    review: {
      id: 'placeholder',
      question: inputs.question,
      short: 'Chromatin',
      state: 'complete',
      total: 1,
      protocol: [],
      lastTouched: now,
      paperIds: ['r1'],
      seed: { r1: 'include' },
    },
    papers: [],
    content: { criteria: [], report: { date: '2026-10-11', summary: 'done', sections: [] } },
    meta: {},
  };

  const runner: ReviewRunner = async (_state, _inputs, id, onProgress) => {
    onProgress('Screening 1 records…');
    return { ...result, review: { ...result.review, id } };
  };

  // A run that comes back while the reader is elsewhere has to be reported, which is how it
  // reaches the inbox.
  const reported: SettledRun[] = [];
  services.reviewRuns.report = (run) => reported.push(run);

  const before = REVIEWS.length;
  const started = startReview(seedState(), inputs, runner);
  check('a run starts as running', reviewRun(started.id)?.status, 'running');
  check('and reports nothing while it works', reported.length, 0);
  await started.done;
  check('and settles as done', reviewRun(started.id)?.status, 'done');
  check('a finished run is reported once', reported.length, 1);
  check('with what it was asked', reported[0]?.question, inputs.question);
  check('and how much it screened', reported[0]?.records, 1);
  check('and no error', reported[0]?.error, null);
  check('the review landed in the store', REVIEWS.length, before + 1);
  check(
    'under the run id',
    REVIEWS.some((review) => review.id === started.id),
    true,
  );

  const failing: ReviewRunner = async () => {
    throw new Error('No records were retrieved.');
  };
  const failedRun = startReview(seedState(), inputs, failing);
  await failedRun.done;
  check('a failure is recorded, not thrown', reviewRun(failedRun.id)?.status, 'error');
  check('with its reason', reviewRun(failedRun.id)?.error, 'No records were retrieved.');
  check('and a failed run is reported too', reported.length, 2);
  check(
    'as an error, with the reason',
    [reported[1]?.status, reported[1]?.error],
    ['error', 'No records were retrieved.'],
  );
  services.reviewRuns.report = () => {};
  check('the review stays, marked with the failure', findReview(failedRun.id)?.protocol.at(-1), {
    label: 'Run failed',
    value: 'No records were retrieved.',
  });
}

console.log('\n— a half-written report —');
{
  // A section saved without a body used to crash the report page; a missing body is nothing
  // to cite, not a failure.
  const ids = collectCitations({
    date: '2026-01-01',
    summary: 'See [[W1]].',
    sections: [{ id: 's', heading: 'Results', body: undefined as unknown as string }],
  });
  check('a section without a body does not throw', ids, ['W1']);
  check(
    'a report without sections does not throw',
    collectCitations({ date: 'x', summary: '', sections: undefined as unknown as ReviewReport['sections'] }),
    [],
  );
  check(
    'an @record citation is collected, without its trailing punctuation',
    collectCitations({ date: 'x', body: 'See @record:R1, and @record:R2.' }),
    ['R1', 'R2'],
  );
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('OK: reviews retrieve, screen, report and run in the background');
