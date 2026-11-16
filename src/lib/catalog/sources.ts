/**
 * Sources: a saved question against a database.
 *
 * A source is not a copy of the data. It is one database, one set of filters — what to look for,
 * which kinds of document, over which years — and a small preview of what the first request
 * returned. The filters stay filters: when a review or the agent needs the records, they are
 * fetched from the database then, through the database's own `find` operation, rather than
 * being stored.
 *
 * Kept in a small external store behind {@link useSources}, the way databases are kept, so the
 * screens that read them stay in step without threading a slice through the whole app store.
 * The list is stored in the app's SQLite database, so a source saved today is there next launch.
 */

import { useSyncExternalStore } from 'react';

import { services } from '@/lib/container';
import { operationUrl, runOperation } from './request';
import { getDb, serialized } from '@/lib/db/client';
import { loadSources, saveSources } from '@/lib/db/catalog';
import { findDatabase } from '@/components/databases/store';
import { databaseOperation, findOperation, type Database } from '@/components/databases/data';

/** The document kinds a source can ask for. */
export const SOURCE_TYPES = ['article', 'review', 'preprint', 'report', 'dataset', 'chapter'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** The questions a source saves. */
export interface SourceFilters {
  /** Topic or keywords. */
  query: string;
  /** Document kinds to keep. */
  types: SourceType[];
  yearFrom?: number;
  yearTo?: number;
  /** How many records to fetch when the source is used. */
  limit: number;
}

/** One record the preview showed. */
export interface SourceRecord {
  id: string;
  title: string;
  year?: number;
  venue?: string;
  url?: string;
  doi?: string;
  /** Author names, when the service reported them; screening reads them. */
  authors?: string[];
  /** The abstract, when the service reported one; screening reads it in place of a PDF. */
  abstract?: string;
  /** An open-access PDF link, when the service reported one. */
  pdf?: string;
  /** Citations the service reports, when it reports one. */
  citations?: number;
}

/** A saved search against one database. */
export interface Source {
  id: string;
  name: string;
  databaseId: string;
  filters: SourceFilters;
  /** The first page, kept only so the source can show what it looks like. */
  preview: SourceRecord[];
  createdAt: number;
}

/** The sources, live. */
export function useSources(): Source[] {
  const { store } = services.sources;
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Fill the list from the database. Called once, by `bootStorage`. */
export async function hydrateSources(): Promise<void> {
  await services.sources.hydrate();
}

/** A source by id, or undefined when the link is stale. */
export function findSource(id: string): Source | undefined {
  return services.sources.find(id);
}

/** Every source id, for a reader that only needs the keys. */
export function sourceIds(): string[] {
  return services.sources.ids();
}

/** Add a source to the front of the list. */
export function addSource(source: Source): void {
  services.sources.add(source);
}

/** Remove a source. */
export function removeSource(id: string): void {
  services.sources.remove(id);
}

/** Change a source in place — its name, its database, its filters, its preview. */
export function patchSource(id: string, patch: Partial<Source>): void {
  services.sources.patch(id, patch);
}

/** OpenAlex reports an abstract as `{ word: [positions] }`; put the words back in order. */
function invertedAbstract(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const placed: [number, string][] = [];
  for (const [word, positions] of Object.entries(value as Record<string, number[]>)) {
    if (Array.isArray(positions)) {
      for (const position of positions) {
        placed.push([position, word]);
      }
    }
  }
  if (placed.length === 0) {
    return undefined;
  }
  return placed
    .sort((a, b) => a[0] - b[0])
    .map(([, word]) => word)
    .join(' ');
}

/** Author names from whichever shape the service used. */
function recordAuthors(item: Record<string, unknown>): string[] | undefined {
  const authorships = Array.isArray(item.authorships) ? item.authorships : [];
  const names = authorships
    .map((entry) => (entry as { author?: { display_name?: string } }).author?.display_name)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names : undefined;
}

/** Pull the records out of whatever JSON an API returned. */
export function parseRecords(data: unknown): SourceRecord[] {
  const list = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { results?: unknown[] }).results)
      ? (data as { results: unknown[] }).results
      : [];
  return list.map((raw, index) => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const location = item.primary_location as { source?: { display_name?: string } } | undefined;
    const abstract =
      invertedAbstract(item.abstract_inverted_index) ??
      (typeof item.abstract === 'string' ? item.abstract : undefined);
    const authors = recordAuthors(item);
    const bestOa = item.best_oa_location as { pdf_url?: string } | undefined;
    const openAccess = item.open_access as { oa_url?: string } | undefined;
    const pdf =
      (typeof bestOa?.pdf_url === 'string' ? bestOa.pdf_url : undefined) ??
      (typeof openAccess?.oa_url === 'string' ? openAccess.oa_url : undefined);
    return {
      id: String(item.id ?? item.doi ?? item.pmid ?? index),
      title: String(item.title ?? item.display_name ?? item.name ?? 'Untitled'),
      ...(typeof item.publication_year === 'number'
        ? { year: item.publication_year }
        : typeof item.year === 'number'
          ? { year: item.year }
          : {}),
      venue: String(location?.source?.display_name ?? item.venue ?? item.journal ?? '') || undefined,
      url: typeof item.id === 'string' ? item.id : typeof item.url === 'string' ? item.url : undefined,
      doi: typeof item.doi === 'string' ? item.doi : undefined,
      ...(authors ? { authors } : {}),
      ...(abstract ? { abstract } : {}),
      ...(pdf?.startsWith('http') ? { pdf } : {}),
      ...(typeof item.cited_by_count === 'number' ? { citations: item.cited_by_count } : {}),
    };
  });
}

/**
 * The arguments a source's filters become for one page of a database's `find` operation.
 *
 * The names are semantic — `query`, `types`, `yearFrom`, `limit`, `page` — and the operation
 * says where each one goes and what the API calls it, so one set of filters works against any
 * database that declares those parameters.
 */
export function findArgs(filters: SourceFilters, page = 1): Record<string, unknown> {
  return {
    query: filters.query,
    types: filters.types,
    yearFrom: filters.yearFrom,
    yearTo: filters.yearTo,
    limit: filters.limit,
    page,
  };
}

/** The URL a source's page request becomes, for a preview that shows it before sending. */
export function sourceUrl(database: Database, filters: SourceFilters, page = 1): string {
  const operation = findOperation(database);
  return operation ? operationUrl(database, operation.id, findArgs(filters, page)) : database.endpoint;
}

/**
 * The search string a review question becomes.
 *
 * Several APIs (OpenAlex, Crossref) treat `?` and `*` as wildcards and answer with an error, so
 * they are dropped; the rest of the question is a usable full-text query. This is what makes a
 * review search the thing it asked about rather than an empty query's front page of famous work.
 */
export function queryFromQuestion(question: string): string {
  return question.replace(/[?*]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The ids an id-only search returned (PubMed's esearch, or a plain id list). */
export function parseIds(data: unknown): string[] {
  const shaped = data as
    { esearchresult?: { idlist?: unknown[] }; result?: { uids?: unknown[] } } | undefined;
  const list = shaped?.esearchresult?.idlist ?? shaped?.result?.uids;
  if (Array.isArray(list)) {
    return list.map(String);
  }
  return parseRecords(data)
    .map((record) => record.id)
    .filter((id) => /^\d+$/.test(id));
}

/** PubMed's esummary shape, where the records are keyed by uid under `result`. */
export function parseSummary(data: unknown): SourceRecord[] {
  const result = (data as { result?: Record<string, unknown> } | undefined)?.result;
  const uids = result?.uids;
  if (!Array.isArray(uids) || !result) {
    return parseRecords(data);
  }
  return uids.map((uid) => {
    const entry = (result[String(uid)] ?? {}) as Record<string, unknown>;
    const authors = Array.isArray(entry.authors)
      ? (entry.authors as { name?: string }[])
          .map((author) => author.name)
          .filter((name): name is string => Boolean(name))
      : [];
    return {
      id: String(uid),
      title: String(entry.title ?? `PubMed ${uid}`),
      ...(Number(String(entry.pubdate ?? '').slice(0, 4))
        ? { year: Number(String(entry.pubdate).slice(0, 4)) }
        : {}),
      venue: String(entry.fulljournalname ?? entry.source ?? '') || undefined,
      url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      ...(typeof entry.doi === 'string' ? { doi: entry.doi } : {}),
      ...(authors.length > 0 ? { authors } : {}),
    };
  });
}

/**
 * Run one page of a source and return the records it answers with.
 *
 * An API that answers with ids only (PubMed's search) gets one more call — its `fetch`
 * operation — for the records themselves, so the review screens titles rather than numbers.
 */
export async function fetchSourceRecords(
  source: Source,
  database: Database,
  page = 1,
  query?: string,
): Promise<SourceRecord[]> {
  const find = findOperation(database);
  if (!find) {
    throw new Error(`${database.name} has no operation to search with.`);
  }
  // A review supplies its own question as the query; a source preview uses its saved filters.
  const filters = query && query.trim() ? { ...source.filters, query } : source.filters;
  const result = await runOperation(database, find.id, findArgs(filters, page));
  if (!result.ok) {
    throw new Error(result.error ?? 'The request failed.');
  }

  if (find.records === 'ids') {
    const ids = parseIds(result.data).slice(0, source.filters.limit);
    const fetch = databaseOperation(database, 'fetch');
    if (ids.length === 0 || !fetch) {
      return [];
    }
    const details = await runOperation(database, fetch.id, { id: ids.join(',') });
    if (!details.ok) {
      throw new Error(details.error ?? 'The records could not be fetched.');
    }
    return parseSummary(details.data).slice(0, source.filters.limit);
  }

  return parseRecords(result.data).slice(0, source.filters.limit);
}

/** Run a source as a preview, from a draft that is not saved yet. */
export async function previewSource(databaseId: string, filters: SourceFilters): Promise<SourceRecord[]> {
  const database = findDatabase(databaseId);
  if (!database) {
    throw new Error('Choose a database for this source.');
  }
  return fetchSourceRecords(
    { id: 'preview', name: 'preview', databaseId, filters, preview: [], createdAt: Date.now() },
    database,
  );
}
