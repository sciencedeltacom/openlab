/**
 * Storage health.
 *
 * Persistence failures used to be logged and forgotten: the app kept running in memory and a
 * full day's work vanished on restart. This is the one place they are recorded, so a surface
 * can say so out loud. It is deliberately module state rather than app state — a failure can
 * happen before the store exists (boot) and while it is being replaced (a save).
 */

/** What went wrong: opening the database, or writing to it. */
export type StorageIssueKind = 'open' | 'write';

export interface StorageIssue {
  kind: StorageIssueKind;
  message: string;
}

let issue: StorageIssue | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** The current failure, or `null` when storage is healthy. */
export function storageIssue(): StorageIssue | null {
  return issue;
}

/** Subscribe to changes; returns the unsubscribe function. */
export function subscribeStorage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Record a failure. A repeated identical failure does not re-render. */
export function reportStorageIssue(kind: StorageIssueKind, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (issue?.kind === kind && issue.message === message) return;
  issue = { kind, message };
  emit();
}

/** Clear a failure after the same path succeeded again. */
export function clearStorageIssue(kind: StorageIssueKind): void {
  if (issue?.kind !== kind) return;
  issue = null;
  emit();
}
