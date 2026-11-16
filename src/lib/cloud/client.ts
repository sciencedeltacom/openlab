/**
 * Talking to a connected cloud store.
 *
 * The credential never crosses into the webview: each request carries the vault key the store's
 * secret lives under (`cloud-<id>`), and Rust applies it. So the browser side deals in URLs and
 * JSON, and the secret stays where it belongs. Everything here is by reference — `importFile`
 * is the one call that writes to disk, and only when the reader asks for it.
 */

import { parseBody } from '@/lib/catalog/request';
import { invokeCommand } from '@/lib/ipc';
import { findProvider } from './providers';
import type { CloudConnection, CloudContext, RemoteEntry, UploadPlan } from './types';

/** The vault key a connection's credential is stored under. */
export function secretKey(connectionId: string): string {
  return `cloud-${connectionId}`;
}

/** The auth the Rust side should apply, from the provider's declared shape. */
function authFor(connection: CloudConnection): { kind: string; name?: string } | null {
  const provider = findProvider(connection.providerId);
  if (!provider?.authSpec || provider.authSpec.kind === 'none') {
    return null;
  }
  return { kind: provider.authSpec.kind, name: provider.authSpec.name };
}

/**
 * The origin a connection's credential belongs to.
 *
 * An object store and Dataverse name their own endpoint in their config; everything else
 * declares one.
 */
export function apiBaseFor(connection: CloudConnection): string {
  if (connection.providerId === 's3') {
    return connection.config.endpoint ?? '';
  }
  if (connection.providerId === 'dataverse') {
    return connection.config.server ?? '';
  }
  return findProvider(connection.providerId)?.apiBase ?? '';
}

/** Store a connection's credential. An empty token clears it, so a public repo is not sent one. */
export async function saveCredential(
  connection: CloudConnection,
  values: Record<string, string>,
): Promise<void> {
  const provider = findProvider(connection.providerId);
  if (!provider) {
    return;
  }
  const providerKey = secretKey(connection.id);
  const filled = provider.credentialFields
    .map((field) => [field.key, values[field.key] ?? ''] as const)
    .filter(([, value]) => value.trim().length > 0);
  if (filled.length === 0) {
    await invokeCommand('secret_delete', { provider: providerKey });
    return;
  }
  const secret =
    provider.credentialShape === 'pair' ? JSON.stringify(Object.fromEntries(filled)) : filled[0]![1].trim();
  await invokeCommand('secret_set', { provider: providerKey, value: secret });
}

/** Forget a connection's credential. */
export async function clearCredential(connectionId: string): Promise<void> {
  await invokeCommand('secret_delete', { provider: secretKey(connectionId) });
}

/** Whether a connection has a credential stored. */
export async function hasCredential(connectionId: string): Promise<boolean> {
  const result = await invokeCommand<boolean>('secrets_status', {
    providers: [secretKey(connectionId)],
  });
  // `secrets_status` answers one row per provider when asked with a list.
  if (result.ok && Array.isArray(result.value)) {
    return (result.value as unknown as { provider: string; hasKey: boolean }[]).some((row) => row.hasKey);
  }
  return false;
}

/** The call surface one connection hands a provider, at `path` inside the store. */
export function contextFor(connection: CloudConnection, path?: string): CloudContext {
  const provider = findProvider(connection.providerId);
  const secretProvider = secretKey(connection.id);
  const account = provider?.accountProvider ?? null;
  const auth = authFor(connection);
  const numbers = () => ({
    endpoint: connection.config.endpoint ?? '',
    region: connection.config.region ?? 'us-east-1',
    bucket: connection.config.bucket ?? '',
  });

  // The origin the credential belongs to. Rust refuses a credential-attached request to any
  // other host, so a compromised renderer cannot forward a stored token somewhere else.
  const apiBase = apiBaseFor(connection);

  const request = async (
    url: string,
    init?: { headers?: Record<string, string>; method?: string; body?: string },
  ) => {
    const result = await invokeCommand<string>('api_request', {
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body ?? null,
      secretProvider,
      account,
      auth,
      baseUrl: apiBase || null,
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.value;
  };

  return {
    connection,
    path,
    json: async (url, init) => parseBody(await request(url, init)),
    text: request,
    async s3List(prefix, delimiter) {
      const result = await invokeCommand<{
        objects: { key: string; size: number; modified?: string | null }[];
        prefixes: string[];
      }>('s3_list', {
        secretProvider,
        ...numbers(),
        prefix,
        delimiter: delimiter ?? null,
        continuationToken: null,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
    async s3Presign(key) {
      const result = await invokeCommand<string>('s3_presign', {
        secretProvider,
        ...numbers(),
        key,
        expires: 3600,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
  };
}

/** List a connection's files, through its provider. */
export async function listRemote(connection: CloudConnection, path?: string): Promise<RemoteEntry[]> {
  const provider = findProvider(connection.providerId);
  if (!provider) {
    throw new Error('This store has no provider.');
  }
  return provider.list(contextFor(connection, path));
}

/** Search a connection's whole store, when its provider can search. */
export async function searchRemote(connection: CloudConnection, query: string): Promise<RemoteEntry[]> {
  const provider = findProvider(connection.providerId);
  if (!provider?.search) {
    throw new Error('This store cannot be searched.');
  }
  return provider.search(contextFor(connection), query);
}

/** Whether a connection's store can be searched. */
export function canSearch(connection: CloudConnection): boolean {
  return Boolean(findProvider(connection.providerId)?.search);
}

/** A link the OS can open for one entry, when the store can mint one. */
export async function openRemote(
  connection: CloudConnection,
  entry: RemoteEntry,
): Promise<string | undefined> {
  const provider = findProvider(connection.providerId);
  if (!provider) {
    return entry.url;
  }
  if (provider.open) {
    return provider.open(contextFor(connection), entry);
  }
  return entry.url;
}

/** The URL an import should fetch — an API media endpoint when it differs from the viewer link. */
export async function downloadRemote(
  connection: CloudConnection,
  entry: RemoteEntry,
): Promise<string | undefined> {
  const provider = findProvider(connection.providerId);
  if (!provider) {
    return entry.url;
  }
  if (provider.download) {
    return provider.download(contextFor(connection), entry);
  }
  return openRemote(connection, entry);
}

/**
 * Import one remote file into the workspace.
 *
 * The only write. `dest` is relative to the workspace root, and Rust refuses anything that would
 * escape it. The credential — the account's token or the store's own secret — travels with the
 * request so a private object downloads.
 */
export async function importFile(
  connection: CloudConnection,
  url: string,
  dest: string,
  root: string,
): Promise<number> {
  const provider = findProvider(connection.providerId);
  const result = await invokeCommand<number>('download_url', {
    url,
    dest,
    root,
    secretProvider: secretKey(connection.id),
    account: provider?.accountProvider ?? null,
    auth: authFor(connection),
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

/**
 * Write one workspace file into a store.
 *
 * The other direction of {@link importFile}: the bytes are read by Rust, so the webview never
 * holds them, and the same credential travels with the request.
 */
export async function uploadLocal(
  connection: CloudConnection,
  plan: UploadPlan,
  path: string,
  root: string,
): Promise<string> {
  const provider = findProvider(connection.providerId);
  const result = await invokeCommand<string>('upload_file', {
    url: plan.url,
    method: plan.method,
    path,
    root,
    mime: plan.mime ?? null,
    metadata: plan.metadata ?? null,
    secretProvider: secretKey(connection.id),
    account: provider?.accountProvider ?? null,
    auth: authFor(connection),
    baseUrl: apiBaseFor(connection) || null,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}
