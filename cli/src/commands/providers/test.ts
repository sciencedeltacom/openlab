/**
 * Asking a provider whether it answers.
 *
 * A real request to the provider's own model list, with the credential presented the way the
 * app presents it (`authFor` in `lib/ai/models`). It proves two things at once — the URL
 * resolves and the key is accepted — and it is the check the app's target screen runs for a
 * compute CLI, pointed at a model endpoint instead.
 */

import { Args } from '@oclif/core';

import { authFor } from '@/lib/ai/models';
import { mergeProviders } from '@/lib/providers';

import { LabCommand } from '../../lib/base';
import { catalogProviders, envFor } from '../../lib/catalog';
import { checkPublicUrl } from '../../lib/host/exec';
import { providerKey } from '../../lib/host/secrets';
import * as out from '../../lib/output';

export default class ProvidersTest extends LabCommand {
  static description = 'Ask a provider whether it answers, and whether the key is accepted';

  static args = { id: Args.string({ description: 'The provider id', required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(ProvidersTest);
    const lab = await this.lab({ root: null });
    const provider = mergeProviders([...catalogProviders(), ...lab.state.customProviders]).find(
      (candidate) => candidate.id === args.id,
    );
    if (!provider) {
      this.fail(`No provider “${args.id}”. \`openlab providers list\` shows the ids.`);
    }
    const baseUrl = lab.state.providerBaseUrls[provider.id] ?? provider.defaultBaseUrl ?? '';
    if (!baseUrl) {
      this.fail(
        `${provider.label} has no base URL. Set one with \`openlab providers base-url ${provider.id} --url …\`.`,
      );
    }
    const key = provider.requiresKey ? providerKey(provider.id, envFor(provider.id)) : null;
    if (provider.requiresKey && !key) {
      this.fail(
        `No credential for ${provider.label}. Set ${envFor(provider.id)[0] ?? `${provider.id.toUpperCase()}_API_KEY`} or store one with \`openlab secrets set ${provider.id}\`.`,
      );
    }

    const auth = authFor(provider);
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/models`);
    const headers: Record<string, string> = { 'User-Agent': 'openlab/1.0 (research workbench)' };
    if (key) {
      if (auth.kind === 'bearer') headers.Authorization = `Bearer ${key}`;
      else if (auth.kind === 'header') headers[auth.name] = key;
      else if (auth.kind === 'query') url.searchParams.set(auth.name, key);
    }
    if (provider.protocol === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
    }

    checkPublicUrl(url.toString());
    const started = Date.now();
    let status = 0;
    let count: number | null = null;
    let detail = '';
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      status = response.status;
      const text = await response.text();
      try {
        const parsed = JSON.parse(text) as { data?: unknown[]; models?: unknown[] };
        count = (parsed.data ?? parsed.models ?? []).length || null;
      } catch {
        detail = text.slice(0, 200);
      }
    } catch (error) {
      this.fail(`Could not reach ${url.host}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const ok = status >= 200 && status < 300;
    const value = {
      provider: provider.id,
      url: url.toString(),
      status,
      ok,
      models: count,
      elapsedMs: Date.now() - started,
    };

    this.emit(value, () =>
      [
        `${ok ? out.mark.ok : out.mark.bad} ${out.c.bold(provider.label)} answered ${out.c.bold(String(status))} in ${value.elapsedMs} ms`,
        out.keyValues([
          ['endpoint', url.toString()],
          ['credential', provider.requiresKey ? 'sent' : 'none needed'],
          ['models', count === null ? out.c.grey('not listed') : String(count)],
        ]),
        ...(detail ? ['', out.note(detail)] : []),
      ].join('\n'),
    );
    if (!ok) {
      process.exitCode = 1;
    }
  }
}
