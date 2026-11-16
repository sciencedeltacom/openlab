/**
 * The catalogue domain: databases, sources, and the requests they run.
 *
 * Databases and sources are the same kind of thing — a connection, and a saved question against
 * it — so they live together behind hooks rather than in the screens that read them. A request
 * is always an **operation** with its arguments: `runOperation` builds the URL from the
 * database's own definition and sends it through the desktop proxy, so the key stays in the OS
 * store and no screen has to know how the tunnel works.
 */

import { buildOperation, databaseOperation, type Database } from '@/components/databases/data';
import { invokeCommand } from '@/lib/ipc';

/** What a request came back with, narrowed to what a preview needs. */
export interface RequestResult {
  ok: boolean;
  status: number;
  data?: unknown;
  text?: string;
  error?: string;
}

/**
 * Parse the body the proxy returned.
 *
 * `proxy_request` answers with the response body as text; a JSON API's body has to be parsed
 * before anything can read `.results` from it. A body that is not JSON (an XML or text API)
 * comes back as the text it is.
 */
export function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') {
    return body;
  }
  const text = body.trim();
  if (text.length === 0) {
    return '';
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Run one of a database's operations.
 *
 * The URL, the method and the body all come from the database's own definition — `limit`,
 * `page` and the filters are declared there — so this is the same request the interface would
 * send from its request panel.
 */
export async function runOperation(
  database: Database,
  operationId: string,
  args: Record<string, unknown> = {},
  options: { headers?: Record<string, string> } = {},
): Promise<RequestResult> {
  const operation = databaseOperation(database, operationId);
  if (!operation) {
    return { ok: false, status: 0, error: `${database.name} has no \`${operationId}\` operation.` };
  }

  const built = buildOperation(database, operation, args);
  const headers: Record<string, string> = {};
  for (const header of database.defaultHeaders) {
    if (header.name) headers[header.name] = header.value;
  }
  Object.assign(headers, options.headers ?? {});

  const result = await invokeCommand<unknown>('proxy_request', {
    url: built.url,
    method: built.method,
    headers,
    body: built.body,
    secretProvider: database.authorization === 'none' ? null : `database-${database.id}`,
  });

  if (result.ok) {
    return { ok: true, status: 200, data: parseBody(result.value) };
  }
  return { ok: false, status: 0, error: result.error.message };
}

/** The URL one operation would call, for a preview that shows the request before sending it. */
export function operationUrl(
  database: Database,
  operationId: string,
  args: Record<string, unknown> = {},
): string {
  const operation = databaseOperation(database, operationId);
  return operation ? buildOperation(database, operation, args).url : database.endpoint;
}
