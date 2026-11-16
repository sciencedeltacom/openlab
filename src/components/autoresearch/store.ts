/**
 * The research topics, live.
 *
 * A small external store, the way the agent bar and the database catalogue are: the page and
 * the background runner both read and write it, and neither should re-render anything else.
 * Topics are stored in the app's SQLite database, so a topic started today is there next
 * launch; in a plain browser it lives in memory for the session.
 */

import { useSyncExternalStore } from 'react';

import { getDb, serialized } from '@/lib/db/client';
import { loadTopics, saveTopics } from '@/lib/db/research';
import { newTopic, type ResearchTopic } from './data';

let items: ResearchTopic[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Fill the list from the database. Called once, by `bootStorage`. */
export async function hydrateTopics(): Promise<void> {
  const db = getDb();
  if (!db) {
    return;
  }
  items = await loadTopics(db);
  emit();
}

function persist(): void {
  const db = getDb();
  if (!db) {
    return;
  }
  void serialized(() => saveTopics(db, items)).catch((error) => {
    console.error('openlab could not write the research topics', error);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The topics, live. */
export function useTopics(): ResearchTopic[] {
  return useSyncExternalStore(subscribe, () => items);
}

/** A topic by id. */
export function findTopic(id: string): ResearchTopic | undefined {
  return items.find((topic) => topic.id === id);
}

/** Add a topic to the front of the list. */
export function addTopic(input: {
  question: string;
  databaseIds?: string[];
  agentIds?: string[];
}): ResearchTopic {
  const topic = newTopic(input);
  items = [topic, ...items];
  persist();
  emit();
  return topic;
}

/** Change a topic in place. */
export function patchTopic(id: string, patch: Partial<ResearchTopic>): void {
  items = items.map((topic) => (topic.id === id ? { ...topic, ...patch, updatedAt: Date.now() } : topic));
  persist();
  emit();
}

/** Remove a topic. */
export function removeTopic(id: string): void {
  items = items.filter((topic) => topic.id !== id);
  persist();
  emit();
}
