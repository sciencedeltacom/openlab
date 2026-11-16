/**
 * The screening review's record set.
 *
 * A review is one question, a protocol, and a table of extracted rows. The table and each
 * paper's page read the same objects, so a quote shown in a cell is the quote the page
 * shows: there is one source of truth rather than two views of a hand-copied list.
 *
 * Nothing here performs I/O. A review run in `lib/literature/pipeline` fills these tables;
 * until one does they are empty, so a surface with nothing yet says so rather than showing
 * a record the search never returned.
 */

/** A reviewer's recommendation for one record. */
export type Recommendation = 'include' | 'maybe' | 'exclude';

/** The five extraction columns, in table order. */
export type ExtractionKey = 'population' | 'intervention' | 'design' | 'outcomes' | 'health';

/** A claim pulled from a paper, with the sentence that supports it. */
export interface Extraction {
  /** The short value the table shows. */
  value: string;
  /** The sentence behind the value, absent when the claim is not yet supported. */
  quote?: { text: string; citation: string };
}

/** One record under screening. */
export interface Paper {
  id: string;
  title: string;
  authors: string[];
  venue: string;
  year: number;
  doi?: string;
  abstract: string;
  /** The decision the review starts with, so the workspace opens mid-screening. */
  seed: Recommendation | null;
  extraction: Record<ExtractionKey, Extraction>;
}

/** Where a review is in the screening loop. */
export type ReviewState = 'screening' | 'extracting' | 'complete';

/** The protocol fields every review states up front, in card order. */
export interface ProtocolFact {
  label: string;
  value: string;
}

/** One systematic review: a question, a protocol, and the records retrieved for it. */
export interface Review {
  id: string;
  /** The full question the table is answering. */
  question: string;
  /** A short label for lists and breadcrumbs. */
  short: string;
  state: ReviewState;
  /** Records the search retrieved, before screening narrows them. */
  total: number;
  protocol: ProtocolFact[];
  /** Unix ms; the index renders it as an age. */
  lastTouched: number;
  /** Ids into {@link PAPERS}; this is what makes each review a different table. */
  paperIds: string[];
  /** The decisions the workspace opens with, keyed by paper id. */
  seed: Record<string, Recommendation>;
}

/**
 * The reviews the workspace holds.
 *
 * Empty until a run creates one or SQLite restores one; the list is mutable so the create
 * page and the index have somewhere to put a review without a store of their own.
 */
export const REVIEWS: Review[] = [];

/** A review by id, or undefined when the link is stale. */
export function findReview(id: string): Review | undefined {
  return REVIEWS.find((review) => review.id === id);
}

/** A relative age for a review's last edit, in the words a card wants. */
export function touchedLabel(review: Review): string {
  const minutes = Math.max(1, Math.round((Date.now() - review.lastTouched) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** How a review's seed decisions break down, for its card and its header. */
export function reviewProgress(review: Review): { screened: number; included: number; excluded: number } {
  const keys = Object.keys(review.seed);
  return {
    screened: keys.length,
    included: keys.filter((id) => review.seed[id] === 'include').length,
    excluded: keys.filter((id) => review.seed[id] === 'exclude').length,
  };
}

/** The reviews a paper has been screened for, for its own page. */
export function reviewsWithPaper(paperId: string): Review[] {
  return REVIEWS.filter((review) => review.paperIds.includes(paperId));
}

/** The labels and order of the extraction columns. */
export const EXTRACTION_FIELDS: { key: ExtractionKey; label: string }[] = [
  { key: 'population', label: 'Study population' },
  { key: 'intervention', label: 'Intervention' },
  { key: 'design', label: 'Study design' },
  { key: 'outcomes', label: 'Outcome measures' },
  { key: 'health', label: 'Population health' },
];

/** The recommendation values, in the order the row control shows them. */
export const RECOMMENDATIONS: Recommendation[] = ['include', 'maybe', 'exclude'];

/** Sentence-case label for a recommendation. */
export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  include: 'Include',
  maybe: 'Maybe',
  exclude: 'Exclude',
};

/**
 * The records retrieved for screening.
 *
 * Empty until a run retrieves records; changes made in the workspace are local to the screen.
 */
export const PAPERS: Paper[] = [];

/** A paper by id, or undefined when the link is stale. */
export function findPaper(id: string): Paper | undefined {
  return PAPERS.find((paper) => paper.id === id);
}

/* ================================================================================================
 * The stepped workspace's record set
 *
 * Everything the six steps need beyond the screening table that already existed: where a record
 * came from, how it scored, the criteria a review is judged against, and the report written from
 * the included records. It is keyed by id rather than folded into {@link Paper} and {@link Review}
 * so the original record set stays one shape and the additions stay in one place.
 * ============================================================================================== */

/** How a pilot reviewer marked one criterion for one record. */
export type PilotVerdict = 'yes' | 'no' | 'maybe';

/** What the search layer would know about a record, beyond what the paper itself says. */
export interface PaperMeta {
  /** The service that returned the record. */
  source: string;
  /** The database the record came from, e.g. `OpenAlex`; the record's provenance. */
  database?: string;
  /** The record's own id inside that database, e.g. an OpenAlex work id. */
  originId?: string;
  /** Canonical landing page, when the service reported one. */
  url?: string;
  /** An open-access PDF link, when the service reported one. */
  pdf?: string;
  /** The system-assigned key the report cites: `@record:{key}`. */
  key?: string;
  /** Citations the service reports, as a proxy for how settled the record is. */
  citations: number;
  /** The screeners' score out of five; higher means more clearly eligible. */
  score: number;
  /** The note behind the seed decision, shown in the screening table. */
  rationale: string;
  /** The model's verdict per criterion, with the reason it gave for it. */
  criteria?: Record<string, { verdict: PilotVerdict; reason?: string }>;
}

/** The paper id a system record key names, or undefined when the key is stale. */
export function paperIdByKey(key: string): string | undefined {
  return Object.keys(PAPER_META).find((id) => PAPER_META[id]?.key === key);
}

/**
 * The search metadata every run writes for its records.
 *
 * Empty until a run fills it: the citations, score and rationale shown beside a record are
 * the ones the retrieved metadata and the screening model reported, never a default.
 */
export const PAPER_META: Record<string, PaperMeta> = {};

/** The search metadata for a record, or undefined when no run has written any. */
export function paperMeta(id: string): PaperMeta | undefined {
  return PAPER_META[id];
}

/** One eligibility criterion a review screens against. */
export interface Criterion {
  id: string;
  /** The short column heading. */
  label: string;
  /** The full criterion, shown in the pilot's column list. */
  question: string;
}

/** One titled block of the written report. */
export interface ReportSection {
  id: string;
  heading: string;
  /** Paragraphs separated by a blank line; citations are `[[paperId]]` markers. */
  body: string;
}

/** The report a review ends on. */
export interface ReviewReport {
  /** ISO date the report was generated. */
  date: string;
  /** The whole report as a Markdown document, written by the model. */
  body?: string;
  /** Legacy: a plain-text lede, from reports written before the Markdown body. */
  summary?: string;
  /** Legacy: titled blocks, from reports written before the Markdown body. */
  sections?: ReportSection[];
}

/** The criteria and the report a review carries, keyed by review id. */
export interface ReviewContent {
  criteria: Criterion[];
  report: ReviewReport;
}

/**
 * The criteria and report every run writes for its review.
 *
 * Empty until a run fills it: a review with no content has no criteria to screen against and
 * no report to read, which is why `contentOf` returns nothing rather than an invented default.
 */
export const REVIEW_CONTENT: Record<string, ReviewContent> = {};

/** The criteria and report a run wrote for a review, or undefined before one has. */
export function contentOf(review: Review): ReviewContent | undefined {
  return REVIEW_CONTENT[review.id];
}

/** Every record key cited in a report, in order of first appearance, for numbering. */
export function collectCitations(report: ReviewReport): string[] {
  const seen: string[] = [];
  // A report saved before the sections carried a body, or one a run left half-written, must not
  // throw on the way in: a missing body is nothing to cite, not a crash.
  const bodies: unknown[] = [
    report.body,
    report.summary,
    ...(report.sections ?? []).map((section) => section.body),
  ];
  for (const body of bodies) {
    if (typeof body !== 'string') {
      continue;
    }
    // `@record:KEY` is the current form; `[[KEY]]` is kept for reports written before it.
    for (const match of body.matchAll(/(?:@record:|\[\[)([^\s\])]+)/g)) {
      // A citation ends a sentence often enough that trailing punctuation is not part of the key.
      const key = match[1]?.replace(/[.,;:]+$/, '');
      if (key && !seen.includes(key)) {
        seen.push(key);
      }
    }
  }
  return seen;
}

/** The services a review can search, for the Sources step's source control. */
export const SOURCES = ['PubMed', 'Europe PMC', 'Crossref', 'arXiv', 'bioRxiv'] as const;
