/**
 * Running a review's pipeline.
 *
 * The app's pipeline reaches the model through its Rust tunnel and its sources through the Rust
 * proxy, because the webview cannot do either. The terminal can do both itself, so this command
 * drives the same `runReview` with the same prompt discipline, swapping in the CLI's direct
 * model call and its own fetch — the pure stages (screen, extract, report) are the app's own.
 *
 * With no `--source`, it screens the records the review already registered (see
 * `literature new`), so a review opened earlier can be run without searching again.
 */

import { Args, Flags } from '@oclif/core';

import { databaseOperation, findOperation } from '@/components/databases/data';
import type { Database } from '@/components/databases/data';
import { addReviewRecords, failReview, finishReview } from '@/components/literature/store';
import {
  PAPERS,
  PAPER_META,
  REVIEWS,
  REVIEW_CONTENT,
  findPaper,
  findReview,
  paperMeta,
  reviewProgress,
} from '@/components/literature/data';
import type { Paper, Review } from '@/components/literature/data';
import { operationUrl, parseBody } from '@/lib/catalog/request';
import {
  findArgs,
  parseIds,
  parseRecords,
  parseSummary,
  type Source,
  type SourceFilters,
  type SourceRecord,
} from '@/lib/catalog/sources';
import { saveLiterature } from '@/lib/db/literature';
import {
  retrieveFromSources,
  runReview,
  type RetrievalResult,
  type ReviewDeps,
  type ReviewInputs,
} from '@/lib/literature/pipeline';

import { LabCommand } from '../../lib/base';
import type { Lab } from '../../lib/lab';
import { ask, withCatalog } from '../../lib/models';
import * as out from '../../lib/output';
import { cap, checkPublicUrl } from '../../lib/host/exec';
import { interactive, spinner } from '../../lib/ui';

/** Response bodies past this are cut, at the app's proxy cap rather than the terminal's 50 KB. */
const RESPONSE_CAP = 2 * 1024 * 1024;

/**
 * Fetch a URL and parse its body, under the same public-host guard the app's proxy uses.
 *
 * `fetchUrl` caps at the terminal's 50 KB, which truncates a JSON API's body and makes it
 * unparseable, so a body here is capped at the proxy's own 2 MB instead.
 */
async function get(url: string): Promise<unknown> {
  const target = checkPublicUrl(url);
  const response = await fetch(target, {
    headers: { 'User-Agent': 'openlab/1.0 (research workbench)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`the server answered ${response.status} for ${url}`);
  }
  return parseBody(cap(await response.text(), RESPONSE_CAP));
}

/** One request the catalogue defines, sent over the CLI's own fetch. */
async function send(
  database: Database,
  operationId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const operation = databaseOperation(database, operationId);
  if (!operation) {
    throw new Error(`${database.name} has no \`${operationId}\` operation.`);
  }
  if (database.authorization !== 'none') {
    throw new Error(
      `${database.name} needs a credential the terminal does not carry: run \`openlab secrets set database-${database.id}\`, or use it from the app.`,
    );
  }
  if (operation.method !== 'GET') {
    throw new Error(
      `${database.name}'s ${operation.label} is a ${operation.method}; the terminal's fetch sends GET only. Run it from the app.`,
    );
  }
  return get(operationUrl(database, operation.id, args));
}

/**
 * The arguments a search sends, with an empty document-type list dropped.
 *
 * The catalogue writes a clause for every value it is handed, so an empty `types` array becomes a
 * bare `type:` filter — which OpenAlex answers with a 400.
 */
function searchArgs(filters: SourceFilters, page: number): Record<string, unknown> {
  const args = findArgs(filters, page);
  if (Array.isArray(args.types) && args.types.length === 0) {
    delete args.types;
  }
  return args;
}

/** One page of a source, headless — the same two requests the app's retrieval makes. */
async function pageRecords(
  source: Source,
  database: Database,
  page = 1,
  query?: string,
): Promise<SourceRecord[]> {
  const find = findOperation(database);
  if (!find) {
    throw new Error(`${database.name} has no operation to search with.`);
  }
  const filters = query && query.trim() ? { ...source.filters, query } : source.filters;
  const data = await send(database, find.id, searchArgs(filters, page));
  if (find.records === 'ids') {
    const ids = parseIds(data).slice(0, source.filters.limit);
    const fetch = databaseOperation(database, 'fetch');
    if (ids.length === 0 || !fetch) {
      return [];
    }
    return parseSummary(await send(database, fetch.id, { id: ids.join(',') })).slice(0, source.filters.limit);
  }
  return parseRecords(data).slice(0, source.filters.limit);
}

/**
 * Write one review back after the store has changed it.
 *
 * The literature store's diff writer keys on object identity, and `failReview` mutates the review
 * in place — so the store's own persist would skip the row and the failure would not be recorded.
 * A fresh object makes the write happen.
 */
async function persistReview(lab: Lab, id: string): Promise<void> {
  await lab.save();
  if (!findReview(id)) {
    return;
  }
  await saveLiterature(lab.db, {
    reviews: REVIEWS.map((candidate) => (candidate.id === id ? { ...candidate } : candidate)),
    papers: PAPERS,
    content: REVIEW_CONTENT,
    meta: PAPER_META,
  });
}

/** The records a review already holds, as a retrieval result — what `literature new` registered. */
function boardRecords(review: Review): RetrievalResult {
  const records = review.paperIds
    .map((id) => findPaper(id))
    .filter((paper): paper is Paper => Boolean(paper))
    .map((paper) => {
      const meta = paperMeta(paper.id);
      return {
        paper,
        sourceName: meta?.source ?? 'Workspace',
        database: meta?.database ?? '',
        url: meta?.url,
        pdf: meta?.pdf,
        citations: meta?.citations ?? 0,
      };
    });
  return { records, failures: [] };
}

export default class LiteratureRun extends LabCommand {
  static description = 'Screen, extract and report a review, with the CLI’s own model and fetch';

  static args = {
    id: Args.string({ description: 'The review id', required: true }),
  };

  static flags = {
    source: Flags.string({ description: 'A saved source to search; repeat for more', multiple: true }),
    inclusion: Flags.string({ description: 'The inclusion criteria (default: the review’s protocol)' }),
    exclusion: Flags.string({ description: 'The exclusion criteria (default: the review’s protocol)' }),
    'date-range': Flags.string({ description: 'The date range (default: the review’s protocol)' }),
    'max-records': Flags.integer({ description: 'How many records to retrieve' }),
    depth: Flags.string({
      description: 'How hard the review searches',
      options: ['quick', 'standard', 'thorough'],
    }),
    analysis: Flags.string({ description: 'An analysis to include; repeat for more', multiple: true }),
    format: Flags.string({ description: 'The report’s preferred format', default: 'Markdown' }),
    verbose: Flags.boolean({ description: 'Print the run’s log as it works' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiteratureRun);
    const lab = await this.lab();
    const state = withCatalog(lab.state);

    const review = findReview(args.id);
    if (!review) {
      this.fail(`No review “${args.id}”. See \`openlab literature list\`.`);
    }
    if (!state.modelRef) {
      this.fail(
        'No model is set for the workbench. Choose one in the app (Settings → Models), then run again.',
      );
    }

    // The review's protocol is where a run's inputs live; a flag overrides one for this run.
    const fact = (label: string): string =>
      review.protocol.find((entry) => entry.label === label)?.value ?? '';
    const stated = (label: string): string => {
      const value = fact(label);
      return value === 'Not stated yet' || value === 'Any' ? '' : value;
    };
    const sourceIds = flags.source ?? [];

    const inputs: ReviewInputs = {
      question: review.question,
      inclusion: flags.inclusion?.trim() || stated('Inclusion criteria'),
      exclusion: flags.exclusion?.trim() || stated('Exclusion criteria'),
      dateRange: flags['date-range']?.trim() || stated('Date range'),
      sources: sourceIds,
      maxRecords: flags['max-records'] ?? (Number(fact('Record limit')) || 25),
      depth: (flags.depth ?? fact('Depth') ?? 'standard') as ReviewInputs['depth'],
      analysis: flags.analysis ?? [],
      format: flags.format,
    };

    const retrieve: typeof retrieveFromSources = (ids, limit, page = 1, _fetch, query) =>
      ids.length > 0
        ? retrieveFromSources(ids, limit, page, pageRecords, query)
        : Promise.resolve(boardRecords(review));

    const deps: ReviewDeps = {
      ask: (target, prompt, options) => ask(target, prompt, options),
      retrieve,
      onRetrieved: (papers) => addReviewRecords(review.id, papers),
      ...(flags.verbose
        ? {
            onLog: (message: string) => {
              if (!this.json) this.log(out.c.grey(message));
            },
          }
        : {}),
    };

    // A screening run takes a while; a spinner on stderr says what stage it is at without
    // mixing into stdout or a --json body. Without a terminal it stays a plain log line.
    const spin = spinner('Screening records…', interactive && !this.json);
    const onProgress = (message: string): void => {
      if (spin.isSpinning) {
        spin.text = message;
        return;
      }
      if (!this.json) this.log(out.c.grey(`· ${message}`));
    };
    const spinning = interactive && !this.json;
    if (spinning) spin.start();

    try {
      const result = await runReview(state, inputs, review.id, onProgress, deps);
      if (spinning) spin.succeed('Review complete');
      finishReview(result.review, result.papers, result.content, result.meta);
      await persistReview(lab, review.id);

      const progress = reviewProgress(result.review);
      this.emit(
        {
          id: review.id,
          question: review.question,
          records: result.review.total,
          screened: progress.screened,
          included: progress.included,
          report: result.content.report.body ?? null,
        },
        (value) =>
          [
            `${out.mark.ok} ${out.c.bold(review.short || review.question)}`,
            out.keyValues([
              ['records', String(value.records)],
              ['screened', String(value.screened)],
              ['included', String(value.included)],
            ]),
            '',
            out.note(`Read it with \`openlab literature show ${review.id}\`.`),
          ].join('\n'),
      );
    } catch (error) {
      if (spinning) spin.fail('Review failed');
      const message = error instanceof Error ? error.message : String(error);
      failReview(review.id, message);
      await persistReview(lab, review.id);
      this.fail(message);
    }
  }
}
