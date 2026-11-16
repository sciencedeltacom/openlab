/**
 * One HTTP request to a cloud store.
 *
 * The shape is `lib/cloud/client.ts`': a URL, a method, headers and a body, with the store's
 * credential applied the way its provider declares — a bearer token, a named header, or a query
 * parameter. The app sends this through Rust so the secret never crosses the IPC boundary; the
 * terminal is the process, so it sends it itself, with `fetch`, and refuses a URL that is not
 * public through the same guard `exec` uses. Object stores sign with SigV4 in Rust, so an
 * S3-compatible store is named and left to the app.
 */

import { Flags } from '@oclif/core';

import { CLOUD_PROVIDERS, findProvider } from '@/lib/cloud/providers';
import { services } from '@/lib/container';

import { LabCommand } from '../../lib/base';
import { cap, checkPublicUrl } from '../../lib/host/exec';
import * as out from '../../lib/output';
import { cliCredential } from './providers';

/** A base URL for `--path`, from a stored connection that records one (object stores, Dataverse). */
function connectionBase(providerId: string): string | null {
  const connection = services.cloud.store.get().find((candidate) => candidate.providerId === providerId);
  return connection?.config.endpoint ?? connection?.config.server ?? null;
}

export default class CloudRequest extends LabCommand {
  static description = 'Send an HTTP request to a cloud provider, with its credential applied';

  static flags = {
    provider: Flags.string({
      required: true,
      options: CLOUD_PROVIDERS.map((provider) => provider.id),
      description: 'The provider to talk to',
    }),
    method: Flags.string({ description: 'The HTTP method', default: 'GET' }),
    url: Flags.string({ description: 'The request URL, or the base when --path is given' }),
    path: Flags.string({ description: 'A path appended to the base URL' }),
    header: Flags.string({ description: 'A header, name=value; repeat for more', multiple: true }),
    body: Flags.string({ description: 'The request body' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CloudRequest);
    const provider = findProvider(flags.provider);
    if (!provider) {
      this.fail(`No provider ${flags.provider}.`);
    }
    if (provider.auth === 'keys') {
      this.fail(
        `${provider.label} requests are signed with SigV4 by the app's Rust client; the CLI cannot sign one. Browse it in the openlab app.`,
      );
    }

    const base = flags.url ?? connectionBase(provider.id);
    if (!base) {
      this.fail('Give a URL with --url, or --url with --path.');
    }
    let url: URL;
    try {
      url = checkPublicUrl(flags.path ? new URL(flags.path, base).toString() : base);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }

    const headers: Record<string, string> = {};
    for (const raw of flags.header ?? []) {
      const eq = raw.indexOf('=');
      if (eq <= 0) {
        this.fail(`--header expects name=value, not “${raw}”.`);
      }
      headers[raw.slice(0, eq).trim()] = raw.slice(eq + 1).trim();
    }

    const secret = cliCredential(provider);
    const auth = provider.authSpec;
    if (secret && auth && auth.kind !== 'none') {
      if (auth.kind === 'bearer') {
        headers.Authorization = `Bearer ${secret.value}`;
      } else if (auth.kind === 'header') {
        headers[auth.name ?? 'Authorization'] = secret.value;
      } else if (auth.kind === 'query') {
        url.searchParams.set(auth.name ?? 'key', secret.value);
      }
    }

    const method = flags.method.toUpperCase();
    if (flags.body !== undefined && (method === 'GET' || method === 'HEAD')) {
      this.fail(`${method} cannot carry a body.`);
    }

    const response = await fetch(url, {
      method,
      headers,
      ...(flags.body !== undefined ? { body: flags.body } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const body = cap(await response.text());

    const value = {
      url: url.toString(),
      method,
      status: response.status,
      ok: response.ok,
      auth: secret ? `via ${secret.field}` : 'none',
      body,
    };
    this.emit(value, (result) =>
      [
        `${result.ok ? out.mark.ok : out.mark.bad} ${result.status} ${result.method} ${result.url}`,
        out.keyValues([['auth', result.auth]]),
        '',
        result.body,
      ].join('\n'),
    );
    if (!response.ok) {
      process.exitCode = 1;
    }
  }
}
