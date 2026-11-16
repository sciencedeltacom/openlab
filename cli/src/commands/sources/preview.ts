/**
 * Running a source's search for real, and printing what comes back.
 *
 * The app sends a database's `find` operation through its Rust proxy, because the webview is
 * cross-origin and the key lives in the OS store. Neither is true here: the CLI builds the same
 * URL from the catalogue's own definition and fetches it directly, then parses the response the
 * way the review does. A database that answers with ids (PubMed) gets its `fetch` call too.
 *
 * A database that declares a credential is refused rather than faked: the terminal's fetch
 * carries none, so the message says how to set one instead of sending a request that cannot work.
 */

import { Args, Flags } from '@oclif/core';

import { databaseOperation, findOperation } from '@/components/databases/data';
import type { Database } from '@/components/databases/data';
import { findDatabase } from '@/components/databases/store';
import { operationUrl, parseBody } from '@/lib/catalog/request';
import { findArgs, findSource, parseIds, parseRecords, parseSummary } from '@/lib/catalog/sources';
import type { Source, SourceFilters, SourceRecord } from '@/lib/catalog/sources';

import { LabCommand } from '../../lib/base';
import * as out from '../../lib/output';
import { cap, checkPublicUrl } from '../../lib/host/exec';

/** Response bodies past this are cut, at the app's proxy cap rather than the terminal's 50 KB. */
const RESPONSE_CAP = 2 * 1024 * 1024;

/**
 * The arguments a search sends, with an empty document-type list dropped.
 *
 * The catalogue writes a clause for every value it is handed, so an empty `types` array becomes
 * a bare `type:` filter — which OpenAlex answers with a 400. Dropping it is what "no type
 * filter" has to mean on the wire.
 */
function searchArgs(filters: SourceFilters, page: number): Record<string, unknown> {
  const args = findArgs(filters, page);
  if (Array.isArray(args.types) && args.types.length === 0) {
    delete args.types;
  }
  return args;
}

/**
 * Fetch a URL and parse its body, under the same public-host guard the app's proxy uses.
 *
 * `fetchUrl` caps at the terminal's 50 KB, which truncates a JSON API's body and makes it
 * unparseable — an OpenAlex page of five works with abstracts is already past it — so a body
 * here is capped at the proxy's own 2 MB instead.
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

/** One page of a source, headless — the same two requests the app's preview makes. */
async function previewRecords(
  source: Source,
  database: Database,
  page: number,
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

export default class SourcesPreview extends LabCommand {
  static description = 'Run a source’s search and print the first records';

  static args = {
    id: Args.string({ description: 'The source id', required: true }),
  };

  static flags = {
    page: Flags.integer({ description: 'The page to fetch', default: 1 }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SourcesPreview);
    await this.lab();

    const source = findSource(args.id);
    if (!source) {
      this.fail(`No source “${args.id}”. See \`openlab sources list\`.`);
    }
    const database = findDatabase(source.databaseId);
    if (!database) {
      this.fail(`${source.name} searches “${source.databaseId}”, which is no longer in the catalogue.`);
    }

    const find = findOperation(database);
    const url = find
      ? operationUrl(database, find.id, searchArgs(source.filters, flags.page))
      : database.endpoint;
    let records: SourceRecord[];
    try {
      records = await previewRecords(source, database, flags.page);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }

    this.emit({ source: source.id, url, count: records.length, records }, () => {
      const lines = [
        out.heading(`Preview · ${source.name}`),
        out.keyValues([
          ['database', database.name],
          ['url', url],
          ['records', String(records.length)],
        ]),
      ];
      if (records.length === 0) {
        lines.push('', out.note('No records came back. Check the source’s filters.'));
        return lines.join('\n');
      }
      lines.push(
        '',
        out.table(records, [
          { key: 'id', label: 'id', width: 26, truncate: true },
          { key: 'title', label: 'title', width: 64, truncate: true },
          { key: 'year', label: 'year', align: 'right' },
          { key: 'venue', label: 'venue', width: 28, truncate: true },
          { key: 'citations', label: 'cites', align: 'right' },
        ]),
      );
      return lines.join('\n');
    });
  }
}
