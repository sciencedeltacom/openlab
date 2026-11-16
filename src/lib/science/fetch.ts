/**
 * Transport for connector requests.
 *
 * The webview cannot reach most research APIs directly: they either omit CORS headers or
 * the Tauri webview blocks the cross-origin request. So requests go through the Tauri
 * proxy when it is available and the host is allowlisted (see
 * `src-tauri/src/commands/proxy.rs`), and fall back to `fetch` otherwise — which is what
 * makes the browser preview usable.
 */

import type { ConnectorStep } from './connectors';

/** Raised when a connector request cannot be completed. */
export class ScienceFetchError extends Error {
  /** The request that failed. */
  readonly url: string;

  constructor(message: string, url: string, cause?: unknown) {
    super(message);
    this.url = url;
    this.name = 'ScienceFetchError';
  }
}

let proxyUnavailable = false;

/** Plain-string copy of a step's headers. */
function headersOf(step: ConnectorStep): Record<string, string> {
  return { ...(step.headers ?? {}) };
}

/** Ask the Rust backend for the URL. Returns `undefined` when the command is not usable. */
async function viaProxy(step: ConnectorStep): Promise<string | undefined> {
  if (proxyUnavailable || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return undefined;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('proxy_request', {
      url: step.url,
      method: 'GET',
      headers: headersOf(step),
      body: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A rejected host means the allowlist needs the host added; stop trying for the session.
    if (/not allowed|unknown command|not found/i.test(message)) {
      proxyUnavailable = true;
      return undefined;
    }
    throw new ScienceFetchError(`Proxy request failed: ${message}`, step.url, error);
  }
}

/** Fetch one step, preferring the Tauri proxy. Returns raw text. */
export async function fetchStep(step: ConnectorStep): Promise<string> {
  const proxied = await viaProxy(step);
  if (proxied !== undefined) {
    return proxied;
  }
  try {
    const response = await fetch(step.url, { headers: headersOf(step) });
    if (!response.ok) {
      throw new ScienceFetchError(`${response.status} ${response.statusText}`, step.url);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof ScienceFetchError) {
      throw error;
    }
    throw new ScienceFetchError(
      `Could not reach ${new URL(step.url).host}. Add the host to the Tauri proxy allowlist, or search from a source the environment allows.`,
      step.url,
      error,
    );
  }
}

/** Decode a step response, tolerating both JSON and raw text (arXiv returns Atom XML). */
function decode(text: string): unknown {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Run a connector plan.
 *
 * @param steps Steps from `ScienceConnector.plan`.
 * @param resolveIds Fills the `{ids}` placeholder used by two-step connectors such as
 * PubMed, from the payloads collected so far.
 */
export async function runPlan(
  steps: readonly ConnectorStep[],
  resolveIds?: (payloads: readonly unknown[]) => string,
): Promise<unknown[]> {
  const payloads: unknown[] = [];
  for (const step of steps) {
    let url = step.url;
    if (url.includes('{ids}')) {
      const ids = resolveIds?.(payloads);
      if (!ids) {
        throw new ScienceFetchError('This source needs identifiers from its first request.', step.url);
      }
      url = url.replace('{ids}', encodeURIComponent(ids));
    }
    payloads.push(decode(await fetchStep({ ...step, url })));
  }
  return payloads;
}

/** Sniff the identifier list out of a payload so `{ids}` placeholders can be filled. */
export function extractIds(payload: unknown): string {
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const search = record['esearchresult'] as { idlist?: unknown[] } | undefined;
  return search?.idlist?.length ? search.idlist.map(String).join(',') : '';
}
