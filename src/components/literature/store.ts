/**
 * The reviews and the records they screen.
 *
 * A tiny external store, not the app reducer: reviews are self-contained and only the
 * literature screens read them. It mutates the module tables in `data.ts` — so `findReview`,
 * `findPaper` and `contentOf` keep working unchanged — and bumps a revision so subscribed
 * screens re-render. Everything is stored in the app's SQLite database, so a review started
 * today is there next launch.
 */

import { useSyncExternalStore } from 'react';

import { getDb, serialized } from '@/lib/db/client';
import { loadLiterature, saveLiterature } from '@/lib/db/literature';
import {
  PAPERS,
  PAPER_META,
  REVIEWS,
  REVIEW_CONTENT,
  type Paper,
  type PaperMeta,
  type Review,
  type ReviewContent,
} from './data';

/** Restore the saved reviews into the module tables. Called once, by `bootStorage`. */
export async function hydrateLiterature(): Promise<void> {
  const db = getDb();
  if (!db) {
    return;
  }
  const saved = await loadLiterature(db);
  if (saved.reviews.length === 0 && saved.papers.length === 0) {
    return;
  }
  REVIEWS.push(...saved.reviews);
  PAPERS.push(...saved.papers);
  Object.assign(REVIEW_CONTENT, saved.content);
  Object.assign(PAPER_META, saved.meta);
  emit();
}

let revision = 0;
const listeners = new Set<() => void>();

function emit(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

function persist(): void {
  const db = getDb();
  if (!db) {
    return;
  }
  void serialized(() =>
    saveLiterature(db, { reviews: REVIEWS, papers: PAPERS, content: REVIEW_CONTENT, meta: PAPER_META }),
  ).catch((error) => {
    console.error('openlab could not write the literature reviews', error);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe to review changes; the returned number changes when they do. */
export function useReviews(): number {
  return useSyncExternalStore(subscribe, () => revision);
}

/**
 * Put a review on the board before its run finishes.
 *
 * A run is long enough that the reader should be able to open it while it works, so the review
 * exists from the first moment — its question and protocol filled in, its records still to
 * come. It is not given content; `contentOf` returns nothing until the run writes the real
 * criteria and report.
 */
export function beginReview(review: Review): void {
  if (REVIEWS.some((candidate) => candidate.id === review.id)) {
    return;
  }
  REVIEWS.push(review);
  persist();
  emit();
}

/** Add the records a run has retrieved, while it is still screening them. */
export function addReviewRecords(id: string, records: Paper[]): void {
  const known = new Set(PAPERS.map((paper) => paper.id));
  for (const record of records) {
    if (!known.has(record.id)) {
      PAPERS.push(record);
      known.add(record.id);
    }
  }
  const review = REVIEWS.find((candidate) => candidate.id === id);
  if (review) {
    review.paperIds = records.map((record) => record.id);
    review.total = records.length;
  }
  persist();
  emit();
}

/** Write the finished run over the review that was started for it. */
export function finishReview(
  review: Review,
  records: Paper[],
  content: ReviewContent,
  meta: Record<string, PaperMeta>,
): void {
  const index = REVIEWS.findIndex((candidate) => candidate.id === review.id);
  if (index >= 0) {
    REVIEWS.splice(index, 1);
  }
  REVIEWS.push(review);
  const known = new Set(PAPERS.map((paper) => paper.id));
  for (const record of records) {
    if (!known.has(record.id)) {
      PAPERS.push(record);
      known.add(record.id);
    }
  }
  REVIEW_CONTENT[review.id] = content;
  Object.assign(PAPER_META, meta);
  persist();
  emit();
}

/** Record that a run failed, on the review that was started for it. */
export function failReview(id: string, message: string): void {
  const review = REVIEWS.find((candidate) => candidate.id === id);
  if (review) {
    review.protocol = [...review.protocol, { label: 'Run failed', value: message }];
    review.lastTouched = Date.now();
  }
  persist();
  emit();
}

/** Change a review in place — its state, its report, its protocol. */
export function patchReview(id: string, patch: Partial<Review>): void {
  const review = REVIEWS.find((candidate) => candidate.id === id);
  if (review) Object.assign(review, patch);
  persist();
  emit();
}

/** Remove a review and the content that belonged to it. */
export function removeReview(id: string): void {
  const index = REVIEWS.findIndex((candidate) => candidate.id === id);
  if (index < 0) return;
  REVIEWS.splice(index, 1);
  delete REVIEW_CONTENT[id];
  persist();
  emit();
}

/** Replace a review's content (its criteria and report). */
export function patchReviewContent(id: string, content: ReviewContent): void {
  REVIEW_CONTENT[id] = content;
  persist();
  emit();
}
