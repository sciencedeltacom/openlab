/**
 * Opening a systematic review from a question.
 *
 * The review is on the board from the first moment — its question and protocol filled in, its
 * records still to come — so `literature show` can open it while the search runs. Its records
 * are retrieved here, from the saved sources, and registered the way the app's background run
 * registers them: fetched now, never stored as a copy.
 *
 * A review with no sources is opened empty and says so; screening is `literature run`.
 */

import { Flags } from '@oclif/core';

import { databaseOperation, findOperation } from '@/components/databases/data';
import type { Database } from '@/components/databases/data';
import { findDatabase } from '@/components/databases/store';
import { addReviewRecords, beginReview } from '@/components/literature/store';
import { findSource, sourceIds } from '@/lib/catalog/sources';
import { PAPERS, PAPER_META, REVIEWS, REVIEW_CONTENT, findReview } from '@/components/literature/data';
import type { Review } from '@/components/literature/data';
import { operationUrl, parseBody } from '@/lib/catalog/request';
import {
  findArgs,
  parseIds,
  parseRecords,
  parseSummary,
  queryFromQuestion,
  type Source,
  type SourceFilters,
  type SourceRecord,
} from '@/lib/catalog/sources';
import { saveLiterature } from '@/lib/db/literature';
import { resolveSources, retrieveFromSources } from '@/lib/literature/pipeline';

import { LabCommand } from '../../lib/base';
import type { Lab } from '../../lib/lab';
import * as out from '../../lib/output';
import { cap, checkPublicUrl } from '../../lib/host/exec';
import { cancel, cancelled, interactive, prompts, withSpinner } from '../../lib/ui';

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
 * The literature store's diff writer keys on object identity, and `addReviewRecords` mutates the
 * review it finds in place — so the store's own persist would skip the row and the review would
 * come back without its records. A fresh object makes the write happen.
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

/** What the guided form collected. */
interface WizardAnswers {
  question: string;
  inclusion?: string;
  exclusion?: string;
  dateRange?: string;
  sourceIds: string[];
  maxRecords: number;
  depth: 'quick' | 'standard' | 'thorough';
}

/**
 * The guided form, for a reader who typed `openlab literature new` and nothing else.
 *
 * Flags stay the scriptable path; this is the same questions a person would be asked if they
 * wrote the protocol on paper, and every answer is still optional except the question.
 */
async function guidedForm(): Promise<WizardAnswers> {
  prompts.intro('openlab · a systematic review');

  const question = await prompts.text({
    message: 'What is the review question?',
    placeholder: 'Does chromatin accessibility improve off-target prediction?',
    validate: (value) => (value?.trim() ? undefined : 'A review needs a question.'),
  });
  if (cancelled(question)) cancel();

  const inclusion = await prompts.text({
    message: 'Inclusion criteria (optional)',
    placeholder: 'Human studies, 2015 or later, measured off-target rates',
  });
  if (cancelled(inclusion)) cancel();

  const exclusion = await prompts.text({
    message: 'Exclusion criteria (optional)',
    placeholder: 'Reviews, preprints, no measured outcome',
  });
  if (cancelled(exclusion)) cancel();

  const dateRange = await prompts.text({
    message: 'Date range (optional)',
    placeholder: '2015–2026',
  });
  if (cancelled(dateRange)) cancel();

  const saved = sourceIds();
  const chosen = saved.length
    ? await prompts.multiselect({
        message: 'Sources to search (space to select, enter to continue)',
        options: saved.map((id) => ({ value: id, label: findSource(id)?.name ?? id })),
        required: false,
      })
    : [];
  if (cancelled(chosen)) cancel();
  if (saved.length === 0) {
    prompts.note('No saved sources yet. The review opens empty; add one with `openlab sources new`.');
  }

  const limit = await prompts.text({
    message: 'How many records to retrieve?',
    placeholder: '25',
    initialValue: '25',
    validate: (value) => {
      const count = Number(value);
      return Number.isInteger(count) && count > 0 && count <= 1000
        ? undefined
        : 'Give a whole number between 1 and 1000.';
    },
  });
  if (cancelled(limit)) cancel();

  const depth = await prompts.select({
    message: 'How hard should it search?',
    options: [
      { value: 'quick', label: 'Quick: one pass per source' },
      { value: 'standard', label: 'Standard: paging and screening' },
      { value: 'thorough', label: 'Thorough: more pages, stricter screening' },
    ],
    initialValue: 'standard',
  });
  if (cancelled(depth)) cancel();

  prompts.outro('Opening the review and registering its records…');
  return {
    question: String(question).trim(),
    inclusion: String(inclusion ?? '').trim() || undefined,
    exclusion: String(exclusion ?? '').trim() || undefined,
    dateRange: String(dateRange ?? '').trim() || undefined,
    sourceIds: chosen as string[],
    maxRecords: Number(limit),
    depth: depth as WizardAnswers['depth'],
  };
}

export default class LiteratureNew extends LabCommand {
  static description = 'Open a systematic review from a question and register its records';

  static flags = {
    question: Flags.string({
      description: 'The review question. Omit it on a terminal for the guided form.',
    }),
    source: Flags.string({ description: 'A saved source to search; repeat for more', multiple: true }),
    inclusion: Flags.string({ description: 'The inclusion criteria' }),
    exclusion: Flags.string({ description: 'The exclusion criteria' }),
    'date-range': Flags.string({ description: 'The date range, in words' }),
    'max-records': Flags.integer({ description: 'How many records to retrieve (default: 25)' }),
    depth: Flags.string({
      description: 'How hard the review searches (default: standard)',
      options: ['quick', 'standard', 'thorough'],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LiteratureNew);
    const lab = await this.lab();

    if (!flags.question?.trim() && !interactive) {
      this.fail('Give --question, or run this on a terminal for the guided form.');
    }
    const guided = !flags.question?.trim() ? await guidedForm() : undefined;

    const question = (flags.question ?? guided?.question ?? '').trim();
    const sourceIds = flags.source ?? guided?.sourceIds ?? [];
    const inclusion = flags.inclusion ?? guided?.inclusion;
    const exclusion = flags.exclusion ?? guided?.exclusion;
    const dateRange = flags['date-range'] ?? guided?.dateRange;
    const maxRecords = flags['max-records'] ?? guided?.maxRecords ?? 25;
    const depth = flags.depth ?? guided?.depth ?? 'standard';
    const id = `review-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`;
    const names = resolveSources(sourceIds).map((source) => source.name);

    const review: Review = {
      id,
      question,
      short: question.slice(0, 48),
      state: 'screening',
      total: 0,
      protocol: [
        { label: 'Inclusion criteria', value: inclusion?.trim() || 'Not stated yet' },
        { label: 'Exclusion criteria', value: exclusion?.trim() || 'Not stated yet' },
        { label: 'Date range', value: dateRange?.trim() || 'Any' },
        { label: 'Sources', value: names.join(' · ') || 'Not chosen yet' },
        { label: 'Record limit', value: String(maxRecords) },
        { label: 'Depth', value: depth },
      ],
      lastTouched: Date.now(),
      paperIds: [],
      seed: {},
    };
    beginReview(review);

    const failures: string[] = [];
    let records = 0;
    if (sourceIds.length > 0) {
      const search = async () => {
        const retrieval = await retrieveFromSources(
          sourceIds,
          maxRecords,
          1,
          pageRecords,
          queryFromQuestion(question),
        );
        failures.push(...retrieval.failures);
        records = retrieval.records.length;
        addReviewRecords(
          id,
          retrieval.records.map((entry) => entry.paper),
        );
        return retrieval;
      };
      try {
        if (interactive && !this.json) {
          await withSpinner(
            `Searching ${names.length || sourceIds.length} source${sourceIds.length === 1 ? '' : 's'}…`,
            search,
            (retrieval) =>
              `Retrieved ${retrieval.records.length} record${retrieval.records.length === 1 ? '' : 's'}`,
          );
        } else {
          await search();
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    await persistReview(lab, id);

    this.emit({ review: { ...review, total: records }, sources: names, records, failures }, () => {
      const lines = [
        `${out.mark.ok} ${out.c.bold(review.short)}`,
        out.keyValues([
          ['review', id],
          ['sources', names.join(', ') || out.c.grey('none. Add --source to retrieve')],
          ['records', String(records)],
        ]),
      ];
      if (failures.length > 0) {
        lines.push('', out.heading('Failures'), out.bullets(failures));
      }
      lines.push('', out.note(`Next: \`openlab literature run ${id} --source <id>\` screens and reports.`));
      return lines.join('\n');
    });
  }
}
