/**
 * Reviews that run in the background — the public surface.
 *
 * The runs themselves live in {@link ReviewRunsService}, built by the composition root. These
 * functions are what the screens and the verification scripts import, so moving the state into
 * the container did not change a single call site.
 */

import { useSyncExternalStore } from 'react';

import { services } from '@/lib/container';
import type { AppState } from '@/store/types';
import type { ReviewInputs } from './pipeline';
import type { ReviewRunState, ReviewRunner } from '@/lib/services/reviews';

export type { ReviewRunState, ReviewRunner } from '@/lib/services/reviews';

/** The runs, live. Newest first. */
export function useReviewRuns(): ReviewRunState[] {
  const { store } = services.reviewRuns;
  return useSyncExternalStore(store.subscribe, store.get);
}

/** One run by id, or undefined. */
export function reviewRun(id: string): ReviewRunState | undefined {
  return services.reviewRuns.find(id);
}

/** Drop a finished run from the list. */
export function dismissReviewRun(id: string): void {
  services.reviewRuns.dismiss(id);
}

/** Start a review and return at once. */
export function startReview(
  state: AppState,
  inputs: ReviewInputs,
  runner?: ReviewRunner,
): { id: string; done: Promise<void> } {
  return services.reviewRuns.start(state, inputs, runner);
}

/** Wait for a run to settle; resolves immediately when it already has. */
export function whenReviewSettled(id: string): Promise<void> {
  return services.reviewRuns.settledFor(id);
}
