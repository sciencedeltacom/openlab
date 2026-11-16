/**
 * The literature reviews, in and out of SQLite.
 *
 * Reviews, their papers, criteria and search metadata used to be restored by pushing saved
 * arrays into the tables in `components/literature/data.ts`, and that is still what loading
 * does — the surfaces keep reading the same module tables. Writing diffs the four
 * collections: reviews and papers by reference, criteria and metadata by serialised value
 * (both are keyed records whose entries change whole).
 */

import type { Paper, PaperMeta, Review, ReviewContent } from '../../components/literature/data';

import type { Db } from './client';
import * as t from './schema';
import { MapSyncer, TableSyncer } from './sync';

/** Everything the literature screens persist. */
export interface LiteratureData {
  reviews: Review[];
  papers: Paper[];
  content: Record<string, ReviewContent>;
  meta: Record<string, PaperMeta>;
}

const reviewSyncer = new TableSyncer<Review>(t.reviews, (review, position) => ({
  id: review.id,
  position,
  question: review.question,
  short: review.short,
  state: review.state,
  total: review.total,
  protocol: review.protocol,
  lastTouched: review.lastTouched,
  paperIds: review.paperIds,
  seed: review.seed,
}));

const paperSyncer = new TableSyncer<Paper>(t.papers, (paper, position) => ({
  id: paper.id,
  position,
  title: paper.title,
  authors: paper.authors,
  venue: paper.venue,
  year: paper.year,
  doi: paper.doi ?? null,
  abstract: paper.abstract,
  seed: paper.seed,
  extraction: paper.extraction,
}));

const contentSyncer = new MapSyncer<ReviewContent>(t.reviewContent, 'reviewId', (reviewId, content) => ({
  reviewId,
  content,
}));

const metaSyncer = new MapSyncer<PaperMeta>(t.paperMeta, 'paperId', (paperId, meta) => ({ paperId, meta }));

/** Read every review and its records. */
export async function loadLiterature(db: Db): Promise<LiteratureData> {
  const [reviewRows, paperRows, contentRows, metaRows] = await Promise.all([
    db.select().from(t.reviews).orderBy(t.reviews.position),
    db.select().from(t.papers).orderBy(t.papers.position),
    db.select().from(t.reviewContent),
    db.select().from(t.paperMeta),
  ]);

  return {
    reviews: reviewRows.map(({ position: _position, ...review }) => review),
    papers: paperRows.map(({ position: _position, doi, ...paper }) => ({ ...paper, doi: doi ?? undefined })),
    content: Object.fromEntries(contentRows.map((row) => [row.reviewId, row.content])),
    meta: Object.fromEntries(metaRows.map((row) => [row.paperId, row.meta])),
  };
}

/** Write every review and its records. */
export async function saveLiterature(db: Db, data: LiteratureData): Promise<void> {
  await reviewSyncer.sync(db, data.reviews);
  await paperSyncer.sync(db, data.papers);
  await contentSyncer.sync(db, data.content);
  await metaSyncer.sync(db, data.meta);
}

/** Drop the write memories, so the next save rewrites everything. */
export function resetLiteratureSyncers(): void {
  reviewSyncer.reset();
  paperSyncer.reset();
  contentSyncer.reset();
  metaSyncer.reset();
}
