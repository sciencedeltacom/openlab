/**
 * Running a systematic review with the model.
 *
 * The model does the reading; the app does the plumbing. A review runs in three calls — retrieve
 * from the chosen sources, screen and extract the records, then write the report — and each call
 * answers with JSON so the result lands in the same tables the workspace already draws. Records
 * come from the saved sources (a database plus filters), fetched on demand, never from a stored
 * copy: the source is the question, and the database is asked again every run.
 */

import { activeModel, askOnce, firstJsonObject } from '@/lib/ai/oneshot';
import { fetchSourceRecords, findSource, queryFromQuestion } from '@/lib/catalog/sources';
import { findDatabase } from '@/components/databases/store';
import type { AppState } from '@/store/types';
import type {
  Criterion,
  ExtractionKey,
  Paper,
  PaperMeta,
  Recommendation,
  Review,
  ReviewContent,
} from '@/components/literature/data';

/** What the create page collects. */
export interface ReviewInputs {
  question: string;
  inclusion: string;
  exclusion: string;
  dateRange: string;
  /** Source ids — a saved question against a database. */
  sources: string[];
  maxRecords: number;
  depth: 'quick' | 'standard' | 'thorough';
  analysis: string[];
  format: string;
}

/** The pieces a finished run hands back for the store to keep. */
export interface ReviewRun {
  review: Review;
  papers: Paper[];
  content: ReviewContent;
  meta: Record<string, PaperMeta>;
}

/**
 * The pipeline's two outside dependencies, overridable for tests.
 *
 * `ask` is the one-shot model call; `retrieve` pulls records from the sources. Both default to
 * the real thing, so a caller only passes them when it wants to script a run.
 */
/**
 * The ids a run has already taken in.
 *
 * A plain `Set` is the default; a run started by the background service passes a **scoped**
 * buffer instead, so the dedupe state is released the moment the run finishes.
 */
export interface SeenBuffer {
  has(id: string): boolean;
  mark(id: string): void;
}

/** The default buffer: a `Set` that lives only as long as the run's own scope does. */
export class SetBuffer implements SeenBuffer {
  private readonly ids = new Set<string>();

  has(id: string): boolean {
    return this.ids.has(id);
  }

  mark(id: string): void {
    this.ids.add(id);
  }
}

export interface ReviewDeps {
  ask?: typeof askOnce;
  retrieve?: typeof retrieveFromSources;
  /** Where the run remembers which records it has seen; a scoped buffer when one is provided. */
  seen?: SeenBuffer;
  /** Called with the retrieved records before screening, so a page can show them early. */
  onRetrieved?: (papers: Paper[]) => void;
  /**
   * Called for every step worth watching — each retrieval, each model call, the reason an
   * answer could not be read. A run that went quiet is the hardest kind to debug, so the
   * pipeline narrates itself rather than leaving the reader with an empty review.
   */
  onLog?: (message: string) => void;
}

/** The first `max` characters of a model answer, on one line, for a log. */
function excerpt(text: string, max = 400): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * A record id without its URL scaffolding, for matching a model's answer to a record.
 *
 * A source hands back ids like `https://openalex.org/W3038568908` while the model, echoing the
 * prompt, tends to answer with just `W3038568908` — or with a `https://doi.org/…` it invented.
 * Matching on the bare key is what keeps a correct decision from being thrown away.
 */
function idKey(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/^doi:/, '')
    .replace(/\/+$/, '');
}

const EXTRACTION_KEYS: ExtractionKey[] = ['population', 'intervention', 'design', 'outcomes', 'health'];

/** How many pages a run will read before it accepts that the field is thin. */
const MAX_PAGES = 4;

/** A page this much excluded (or more) is followed by the next one. */
const EXCLUSION_LIMIT = 0.6;

/** Stop once this share of the record cap is included. */
const INCLUDED_TARGET = 0.25;

const SCREEN_SYSTEM = [
  'You are the screening engine of a systematic review. You are given the review question, the',
  'inclusion and exclusion criteria, and records with their titles and abstracts. Judge each',
  'record from the title and abstract alone, because the full text is not available. Answer with one',
  'JSON object and nothing else:',
  '{ "criteria": [{ "id": short-slug, "label": short label, "question": the criterion }],',
  '  "records": [{ "id": the record id, "decision": "include" | "maybe" | "exclude",',
  '    "score": 1-5 (how clearly it meets the criteria), "rationale": one sentence naming the',
  '    evidence in the abstract,',
  '    "verdicts": { "<criterion id>": { "verdict": "yes" | "no" | "maybe",',
  '      "reason": the one clause from the abstract that decided it } },',
  '    "extraction": { "population": "", "intervention": "", "design": "", "outcomes": "", "health": "" } }] }.',
  "State 3-5 criteria derived from the reviewer's own words, and decide every record you are given.",
  'Prefer "maybe" over "exclude" when the abstract is silent on a criterion; reserve "exclude" for',
  'records the abstract clearly rules out.',
].join('\n');

const REPORT_SYSTEM = [
  'You are the report writer of a systematic review. Given the question, the criteria and the',
  'included records (each with a record key), write the whole review as ONE Markdown document:',
  'a short introduction, a synthesis of what the included records show, the contradictions and',
  'gaps, and a closing summary. Use headings, short paragraphs and a table where it helps.',
  'Answer with one JSON object and nothing else:',
  '{ "markdown": "the review, in Markdown" }.',
  'Cite a claim inline as @record:KEY using the key given for the record (for example @record:R3).',
  'Do not invent records or keys, and do not write a separate references section. One is added.',
].join('\n');

/** One retrieved record, with the source that answered it. */
interface Retrieved {
  paper: Paper;
  sourceName: string;
  /** The database the record came from, e.g. `OpenAlex`. */
  database: string;
  /** The record's canonical landing page, when the service reported one. */
  url?: string;
  /** An open-access PDF link, when the service reported one. */
  pdf?: string;
  /** Citations the service reported, carried into the record's meta. */
  citations?: number;
}

/** What a retrieval produced: the records, and why any source that failed did. */
export interface RetrievalResult {
  records: Retrieved[];
  failures: string[];
}

/** Filter the sources and records to only those that still exist. */
export function resolveSources(ids: readonly string[]): { id: string; name: string }[] {
  return ids
    .map((id) => findSource(id))
    .filter((source): source is NonNullable<typeof source> => Boolean(source))
    .map((source) => ({ id: source.id, name: source.name }));
}

/**
 * Pull records from every chosen source, deduplicated by record id.
 *
 * A source that fails is named in `failures` rather than swallowed: a review that retrieved
 * nothing must be able to say which source was unreachable, because the alternative is a
 * silently empty table. `fetchRecords` is injectable so the pipeline can be tested without a
 * network.
 */
export async function retrieveFromSources(
  sourceIds: readonly string[],
  limit: number,
  page = 1,
  fetchRecords: typeof fetchSourceRecords = fetchSourceRecords,
  query?: string,
): Promise<RetrievalResult> {
  const found = new Map<string, Retrieved>();
  const failures: string[] = [];
  for (const id of sourceIds) {
    const source = findSource(id);
    if (!source) continue;
    const database = findDatabase(source.databaseId);
    if (!database) {
      failures.push(`${source.name}: its database is no longer in the catalogue`);
      continue;
    }
    try {
      const records = await fetchRecords(source, database, page, query);
      for (const record of records) {
        if (found.has(record.id)) continue;
        found.set(record.id, {
          sourceName: source.name,
          database: database.name,
          url: record.url,
          pdf: record.pdf,
          citations: record.citations,
          paper: {
            id: record.id,
            title: record.title,
            authors: record.authors ?? [],
            venue: record.venue ?? source.name,
            year: record.year ?? new Date().getFullYear(),
            ...(record.doi ? { doi: record.doi } : {}),
            abstract: record.abstract ?? '',
            seed: null,
            extraction: Object.fromEntries(
              EXTRACTION_KEYS.map((key) => [key, { value: '' }]),
            ) as Paper['extraction'],
          },
        });
      }
    } catch (error) {
      failures.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { records: [...found.values()].slice(0, limit), failures };
}

/** The record list, as the screening prompt sees it — title and abstract, the way a screener reads. */
function paperDigest(papers: readonly Paper[]): string {
  return papers
    .map((paper) => {
      const abstract = paper.abstract.trim();
      const body = abstract.length > 900 ? `${abstract.slice(0, 899)}…` : abstract;
      return [
        `- id: ${paper.id}`,
        `  title: ${paper.title}`,
        `  ${paper.year} · ${paper.venue}`,
        `  abstract: ${body || '(no abstract available; judge from the title)'}`,
      ].join('\n');
    })
    .join('\n');
}

interface ScreenAnswer {
  criteria?: { id?: string; label?: string; question?: string }[];
  records?: {
    id?: string;
    decision?: string;
    score?: number;
    rationale?: string;
    /** The model's verdict per criterion id, with the reason it gave. */
    verdicts?: Record<string, { verdict?: string; reason?: string } | string>;
    extraction?: Record<string, string>;
  }[];
}

interface ReportAnswer {
  markdown?: string;
}

/**
 * Run a review end to end, paging while the screening keeps excluding.
 *
 * One page of records is rarely the whole answer: a narrow question can exclude most of what a
 * database returns, and stopping there would leave a review with three included papers and a
 * report about nothing. So a page that comes back mostly excluded is followed by the next one —
 * up to {@link MAX_PAGES} — until enough records are included or the exclusion rate settles.
 * `onProgress` says which page it is on, so the reader can see the search widening.
 *
 * The model calls and the retrieval are injectable (`deps`), which is what lets the
 * verification script drive the whole pipeline with a scripted model and no network.
 */
export async function runReview(
  state: AppState,
  inputs: ReviewInputs,
  id: string,
  onProgress: (message: string) => void,
  deps: ReviewDeps = {},
): Promise<ReviewRun> {
  const ask = deps.ask ?? askOnce;
  const retrieve = deps.retrieve ?? retrieveFromSources;

  const log = (message: string) => deps.onLog?.(message);
  const model = activeModel(state);
  const modelName = model ? `${model.provider.id}/${model.modelId}` : 'no model';

  /** One model call, narrated: the prompt it sent, how long it took, and what came back. */
  const askLogged = async (label: string, prompt: string, system: string): Promise<string> => {
    const started = Date.now();
    log(`${label}: asking ${modelName}…`);
    try {
      const answer = await ask(state, prompt, { system });
      log(`${label}: ${answer.length} chars in ${Date.now() - started}ms`);
      log(`${label} answer: ${excerpt(answer)}`);
      return answer;
    } catch (error) {
      log(`${label}: the call failed, ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  };

  /**
   * Ask for JSON, retrying once when the answer carries none.
   *
   * A model that rambles once usually complies when asked again, so one retry saves the run;
   * the raw answer comes back with the parse so the caller can say what it actually got.
   */
  const askJson = async <T>(
    label: string,
    prompt: string,
    system: string,
  ): Promise<{ parsed: T | null; answer: string }> => {
    let answer = await askLogged(label, prompt, system);
    let parsed = firstJsonObject<T>(answer);
    if (parsed) {
      return { parsed, answer };
    }
    log(`${label}: no JSON in the answer; asking again for JSON only`);
    answer = await askLogged(
      `${label} (retry)`,
      `${prompt}\n\nAnswer with one JSON object and nothing else.`,
      `${system}\n\nReturn only the JSON object. No prose, no code fence.`,
    );
    parsed = firstJsonObject<T>(answer);
    if (!parsed) {
      log(`${label}: still no JSON`);
    }
    return { parsed, answer };
  };

  const seen = deps.seen ?? new SetBuffer();
  const papers: Paper[] = [];
  const seed: Record<string, Recommendation> = {};
  const meta: Record<string, PaperMeta> = {};
  const failures: string[] = [];
  let criteria: Criterion[] = [];
  let pages = 0;
  let recordSeq = 0;

  // The review question is the search. A source names the database and its type/year filters;
  // without this the query would be whatever (often nothing) the source was saved with.
  const query = queryFromQuestion(inputs.question);
  log(`search query: ${query || '(empty)'}`);

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    onProgress(
      page === 1 ? 'Retrieving from the sources…' : `Too much excluded, looking further (page ${page})…`,
    );
    const retrieval = await retrieve(inputs.sources, inputs.maxRecords, page, fetchSourceRecords, query);
    failures.push(...retrieval.failures);
    log(
      `retrieve page ${page}: ${retrieval.records.length} record(s) from ${inputs.sources.length} source(s)${
        retrieval.failures.length > 0 ? `, ${retrieval.failures.length} failed` : ''
      }`,
    );
    for (const failure of retrieval.failures) {
      log(`retrieve: ${failure}`);
    }

    const fresh = retrieval.records.filter((entry) => !seen.has(entry.paper.id));
    if (fresh.length === 0) {
      break;
    }
    for (const entry of fresh) {
      seen.mark(entry.paper.id);
    }
    const batch = fresh.map((entry) => entry.paper);
    papers.push(...batch);
    pages = page;
    // The records are on the board before screening starts, so an open review shows them.
    deps.onRetrieved?.(batch);

    onProgress(`Screening ${batch.length} records (page ${page})…`);
    const { parsed: screened, answer: screenAnswer } = await askJson<ScreenAnswer>(
      `screen page ${page}`,
      [
        `Question: ${inputs.question}`,
        `Inclusion criteria: ${inputs.inclusion || 'Not stated'}`,
        `Exclusion criteria: ${inputs.exclusion || 'Not stated'}`,
        `Date range: ${inputs.dateRange || 'Any'}`,
        '',
        'Records:',
        paperDigest(batch),
      ].join('\n'),
      SCREEN_SYSTEM,
    );
    // A model that answers with prose produced no decisions: fail the run and say what it
    // actually said, rather than writing a "complete" review with nothing screened.
    if (!screened) {
      throw new Error(
        `The model did not return screening JSON. Its answer began: “${excerpt(screenAnswer, 200)}”.`,
      );
    }
    log(
      `screen page ${page}: ${screened.records?.length ?? 0} decision(s), ${
        screened.criteria?.length ?? 0
      } criteria`,
    );

    if (criteria.length === 0) {
      criteria = (screened?.criteria ?? [])
        .filter((criterion) => criterion.label)
        .slice(0, 6)
        .map((criterion, index) => ({
          id: criterion.id || `criterion-${index + 1}`,
          label: criterion.label ?? `Criterion ${index + 1}`,
          question: criterion.question ?? criterion.label ?? '',
        }));
    }

    const sourceNameById = new Map(fresh.map((entry) => [entry.paper.id, entry.sourceName]));
    const databaseNameById = new Map(fresh.map((entry) => [entry.paper.id, entry.database]));
    const urlById = new Map(fresh.map((entry) => [entry.paper.id, entry.url]));
    const pdfById = new Map(fresh.map((entry) => [entry.paper.id, entry.pdf]));
    const citationsById = new Map(fresh.map((entry) => [entry.paper.id, entry.citations ?? 0]));
    const byKey = new Map(batch.map((paper) => [idKey(paper.id), paper]));
    let matched = 0;
    for (const result of screened?.records ?? []) {
      if (!result.id) continue;
      const paper = byKey.get(idKey(result.id));
      // Keep the decision under the record's own id, so the workspace's `seed[paper.id]` finds
      // it — the model's spelling of the id is only how it was looked up.
      const id = paper?.id ?? result.id;
      const decision: Recommendation =
        result.decision === 'include' || result.decision === 'exclude' ? result.decision : 'maybe';
      if (paper) {
        matched += 1;
        paper.seed = decision;
        for (const key of EXTRACTION_KEYS) {
          const value = result.extraction?.[key];
          if (typeof value === 'string' && value.trim()) paper.extraction[key] = { value: value.trim() };
        }
      }
      const judged: Record<string, { verdict: 'yes' | 'no' | 'maybe'; reason?: string }> = {};
      for (const [criterionId, entry] of Object.entries(result.verdicts ?? {})) {
        const verdict = typeof entry === 'string' ? entry : entry.verdict;
        const reason = typeof entry === 'string' ? undefined : entry.reason?.trim();
        if (paper && (verdict === 'yes' || verdict === 'no' || verdict === 'maybe')) {
          judged[criterionId] = { verdict, ...(reason ? { reason } : {}) };
        }
      }
      seed[id] = decision;
      meta[id] = {
        source: sourceNameById.get(id) ?? 'Source',
        database: databaseNameById.get(id),
        originId: id,
        url: urlById.get(id),
        pdf: pdfById.get(id),
        ...(paper ? { key: `R${++recordSeq}` } : {}),
        citations: citationsById.get(id) ?? 0,
        score: typeof result.score === 'number' ? Math.max(1, Math.min(5, Math.round(result.score))) : 3,
        ...(Object.keys(judged).length > 0 ? { criteria: judged } : {}),
        rationale: result.rationale?.trim() || 'Screened by the model.',
      };
    }
    log(`screen page ${page}: ${matched} of ${batch.length} record(s) matched by id`);

    // The stopping rule: enough included, or this page was not mostly excluded, or nothing
    // on it was decided at all.
    const includedNow = papers.filter((paper) => seed[paper.id] === 'include').length;
    const target = Math.max(1, Math.ceil(inputs.maxRecords * INCLUDED_TARGET));
    const decided = batch.filter((paper) => paper.id in seed);
    const excluded = decided.filter((paper) => seed[paper.id] === 'exclude').length;
    if (includedNow >= target || decided.length === 0 || excluded / decided.length < EXCLUSION_LIMIT) {
      break;
    }
  }

  if (papers.length === 0) {
    // An empty review is a dead end; fail with what went wrong instead of writing one.
    throw new Error(
      failures.length > 0
        ? `No records were retrieved. ${failures.join('; ')}`
        : 'No records were retrieved from the chosen sources. Check the source’s database and path.',
    );
  }

  // A review with records but no decisions is the "0 of 24 screened / Complete" dead end the
  // model's prose left behind. Refuse to write it: a run that screened nothing is a failure.
  const scored = papers.filter((paper) => paper.id in seed);
  if (scored.length === 0) {
    throw new Error(
      `Screening produced no decisions for ${papers.length} retrieved record(s); the model returned no record ids that matched.`,
    );
  }
  log(`screened ${scored.length} of ${papers.length} record(s)`);

  const included = papers.filter((paper) => seed[paper.id] === 'include' || seed[paper.id] === 'maybe');

  onProgress('Writing the report…');
  const { parsed: report } = await askJson<ReportAnswer>(
    'report',
    [
      `Question: ${inputs.question}`,
      `Criteria: ${criteria.map((criterion) => criterion.label).join('; ') || 'none stated'}`,
      `Analysis to include: ${inputs.analysis.join(', ') || 'synthesis'}`,
      `Preferred format: ${inputs.format}`,
      '',
      'Included records:',
      included
        .map((paper) => {
          const entry = meta[paper.id];
          const key = entry?.key ?? paper.id;
          return [
            `- @record:${key} = “${paper.title}” (${paper.year}, ${paper.venue}; ${
              entry?.database ?? entry?.source ?? 'source'
            })`,
            `  ${(paper.abstract || '').slice(0, 500)}`,
          ].join('\n');
        })
        .join('\n'),
    ].join('\n'),
    REPORT_SYSTEM,
  );
  if (!report) {
    log('report: no JSON; falling back to a summary of the counts');
  }

  const includedCount = papers.filter((paper) => seed[paper.id] === 'include').length;
  const sourceNames = resolveSources(inputs.sources).map((source) => source.name);
  const content: ReviewContent = {
    criteria:
      criteria.length > 0
        ? criteria
        : [{ id: 'eligibility', label: 'Eligibility', question: 'Meets the stated criteria' }],
    report: {
      date: new Date().toISOString().slice(0, 10),
      body:
        report?.markdown?.trim() ||
        `${includedCount} of ${papers.length} retrieved records met the criteria, across ${pages} page${
          pages === 1 ? '' : 's'
        }.`,
    },
  };

  const review: Review = {
    id,
    question: inputs.question.trim(),
    short: inputs.question.trim().slice(0, 48),
    state: 'complete',
    total: papers.length,
    protocol: [
      { label: 'Inclusion criteria', value: inputs.inclusion.trim() || 'Not stated yet' },
      { label: 'Exclusion criteria', value: inputs.exclusion.trim() || 'Not stated yet' },
      { label: 'Date range', value: inputs.dateRange.trim() || 'Any' },
      { label: 'Sources', value: sourceNames.join(' · ') || 'Not chosen yet' },
      { label: 'Record limit', value: String(inputs.maxRecords) },
      { label: 'Pages searched', value: String(pages) },
      { label: 'Depth', value: inputs.depth },
    ],
    lastTouched: Date.now(),
    paperIds: papers.map((paper) => paper.id),
    seed,
  };

  return { review, papers, content, meta };
}
