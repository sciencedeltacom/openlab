/**
 * The tunnel transport.
 *
 * The AI SDK speaks HTTP with `fetch`. This app cannot call a provider directly: the webview
 * is cross-origin to every provider, and the API key lives in the operating system's
 * credential store rather than in the webview. So the SDK is handed a `fetch` that posts
 * through the Rust command `chat_stream`, which applies the credential out of the keyring and
 * streams the server-sent events back. The SDK's own provider package then parses those events
 * exactly as it would a direct call, which is what lets the app use the SDK's loop, tools and
 * usage accounting without moving the secret into the webview.
 */

import { invokeCommand, isDesktop } from '@/lib/ipc';

/** How the credential is presented. The secret itself is applied by the Rust side. */
export type AuthSpec =
  { kind: 'none' } | { kind: 'bearer' } | { kind: 'header'; name: string } | { kind: 'query'; name: string };

/** The client name openlab sends to providers that ask who is calling. */
export const OPENLAB_USER_AGENT = 'openlab/1.0 (research workbench)';

/**
 * Headers the SDK sets that carry the credential.
 *
 * They are stripped before the request reaches Rust, which sets the real one from the
 * keyring. The SDK still needs *a* key to build a request at all, so it is given a placeholder
 * that never leaves this function.
 */
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
  'x-api-token',
]);

/** Query parameters that carry a credential, for endpoints the SDK encodes into the URL. */
const CREDENTIAL_PARAMS = new Set(['key', 'api_key', 'api-key', 'access_token']);

/** The `fetch` shape the SDK expects. */
export type TunnelFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Headers the OpenCode Zen and Go endpoints expect beyond the credential.
 *
 * Go asks a client to name itself and to send a stable session id so requests from one
 * conversation route and cache together; without it the endpoint answers 400
 * `MissingSessionID`. Any endpoint on opencode.ai gets them, including a user's override.
 */
export function providerHeaders(baseUrl: string, sessionId: string): [string, string][] {
  if (!/opencode\.ai/i.test(baseUrl)) {
    return [];
  }
  return [
    ['User-Agent', OPENLAB_USER_AGENT],
    ['x-opencode-session', sessionId],
  ];
}

/** Read `init.headers`, whichever of the three shapes it takes, as entries. */
function headerEntries(init: RequestInit | undefined): [string, string][] {
  const headers = init?.headers;
  if (!headers) {
    return [];
  }
  if (headers instanceof Headers) {
    return [...headers.entries()];
  }
  if (Array.isArray(headers)) {
    return headers.map(([name, value]) => [name, value]);
  }
  return Object.entries(headers as Record<string, string>);
}

/** Drop the SDK's placeholder credential; Rust sets the real one. */
function stripCredentialHeaders(entries: readonly [string, string][]): [string, string][] {
  return entries.filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase()));
}

/** Drop a credential query parameter the SDK appended to the URL. */
function stripCredentialParams(raw: string): string {
  const [path, query] = raw.split('?');
  if (!query) {
    return raw;
  }
  const kept = new URLSearchParams(query);
  for (const name of [...kept.keys()]) {
    if (CREDENTIAL_PARAMS.has(name.toLowerCase())) {
      kept.delete(name);
    }
  }
  const rest = kept.toString();
  return rest.length > 0 ? `${path}?${rest}` : (path ?? raw);
}

/** The request body as text; the SDK sends a JSON string for a streaming completion. */
function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') {
    return body;
  }
  return body == null ? '' : String(body);
}

/**
 * Build a `fetch` that forwards through the Rust tunnel.
 *
 * The returned function resolves as soon as the provider answered; the response body is a
 * stream fed by `chat://chunk` events, so the SDK can parse the server-sent events as they
 * arrive. A provider failure errors the body, which the SDK reports like any transport error.
 */
export function createTunnelFetch(options: {
  /** Keyring entry the Rust side reads the credential from. */
  provider: string;
  auth: AuthSpec;
  /** Extra headers the provider expects beside the credential, e.g. `anthropic-version`. */
  headers?: readonly [string, string][];
}): TunnelFetch {
  return async (input, init) => {
    if (!isDesktop()) {
      throw new Error(
        'The desktop runtime is not attached, so a provider cannot be reached. Run `bun run dev:openlab` from the repository root.',
      );
    }

    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = stripCredentialParams(rawUrl);
    const body = bodyText(init?.body);
    const headers: [string, string][] = [
      ...stripCredentialHeaders(headerEntries(init)),
      ...(options.headers ?? []),
    ];

    const [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);

    const id = `ai-${crypto.randomUUID()}`;
    const encoder = new TextEncoder();
    let settled = false;
    // `start` runs synchronously; the controller is captured before any event can arrive.
    let controller!: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel() {
        void invoke('chat_cancel', { id }).catch(() => undefined);
      },
    });

    const fail = (message: string) => {
      if (settled) {
        return;
      }
      settled = true;
      controller.error(new Error(message));
    };

    const offs = await Promise.all([
      listen<{ id: string; line: string }>('chat://chunk', (event) => {
        if (event.payload.id !== id || settled) {
          return;
        }
        // The Rust side forwards whole server-sent-event lines; re-framing them as bytes is
        // all the SDK's parser needs.
        controller.enqueue(encoder.encode(`${event.payload.line}\n`));
      }),
      listen<{ id: string; message: string }>('chat://error', (event) => {
        if (event.payload.id === id) {
          fail(event.payload.message);
        }
      }),
      listen<{ id: string }>('chat://end', (event) => {
        if (event.payload.id !== id || settled) {
          return;
        }
        settled = true;
        controller.close();
      }),
    ]);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        controller.error(new DOMException('aborted', 'AbortError'));
      }
      void invoke('chat_cancel', { id }).catch(() => undefined);
    };
    init?.signal?.addEventListener('abort', onAbort, { once: true });

    void invokeCommand('chat_stream', {
      request: { id, provider: options.provider, url, body, headers, auth: options.auth },
    })
      .then((result) => {
        // A rejected command is a setup failure — no key, a malformed URL — and carries the
        // message the Rust side produced. The stream has already reported a provider error by
        // the time a streaming failure lands, so only an unsettled stream is failed here.
        if (!result.ok) {
          fail(result.error.message);
        }
      })
      .finally(() => {
        init?.signal?.removeEventListener('abort', onAbort);
        for (const off of offs) {
          off();
        }
      });

    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
}
