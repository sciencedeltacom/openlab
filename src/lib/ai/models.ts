/**
 * Building a language model for a provider.
 *
 * A provider is still data (see `lib/providers`): where it lives, how it authenticates, which
 * protocol it speaks. This module is the one place that turns that data into an AI SDK
 * `LanguageModel` — picking the SDK's provider package for the protocol, giving it the base
 * URL, and handing it the {@link createTunnelFetch} transport so the request goes through Rust
 * and the key stays in the keyring.
 *
 * The SDK is given a placeholder key so its provider packages will build a request at all; the
 * tunnel strips it and Rust applies the real one.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

import type { Provider, Protocol } from '@/lib/providers';
import { createTunnelFetch, providerHeaders, type AuthSpec } from './transport';

/** The key the SDK sees; the real secret is applied by the Rust side. */
const PLACEHOLDER_KEY = 'openlab';

/** How the credential is presented to a provider speaking this protocol. */
export function authFor(provider: Provider): AuthSpec {
  switch (provider.protocol) {
    case 'anthropic':
      return { kind: 'header', name: 'x-api-key' };
    case 'google':
      return { kind: 'query', name: 'key' };
    case 'local':
      return { kind: 'none' };
    default:
      // A local server, or a user's custom no-key endpoint, takes no credential.
      return provider.requiresKey ? { kind: 'bearer' } : { kind: 'none' };
  }
}

/** Everything needed to reach one model. */
export interface LanguageModelInput {
  provider: Provider;
  modelId: string;
  baseUrl: string;
  /** Stable per conversation; OpenCode's endpoints use it to route and cache. */
  sessionId: string;
}

/**
 * Build the AI SDK model for a provider.
 *
 * Three packages cover nearly everything: OpenAI's chat completions dialected by every vendor
 * and local server, Anthropic's messages API, and Google's generative language API. The
 * protocol a provider declares picks the one, so a vendor that speaks the OpenAI dialect —
 * OpenRouter, Groq, a lab gateway, Ollama — needs no code of its own.
 */
export function createLanguageModel(input: LanguageModelInput): LanguageModel {
  const { provider, modelId, baseUrl, sessionId } = input;
  // The SDK's option type is the runtime's own `fetch`, which under Bun also carries a
  // `preconnect` helper. The tunnel is a fetch in every way the SDK uses it, and it cannot
  // preconnect — the request is made by Rust — so it is asserted rather than implemented.
  const tunnelFetch = createTunnelFetch({
    provider: provider.id,
    auth: authFor(provider),
    headers: providerHeaders(baseUrl, sessionId),
  }) as typeof fetch;

  const apiKey = provider.requiresKey ? PLACEHOLDER_KEY : undefined;

  switch (provider.protocol) {
    case 'anthropic':
      return createAnthropic({ baseURL: baseUrl, apiKey: PLACEHOLDER_KEY, fetch: tunnelFetch })(modelId);
    case 'google':
      return createGoogleGenerativeAI({ baseURL: baseUrl, apiKey: PLACEHOLDER_KEY, fetch: tunnelFetch })(
        modelId,
      );
    default:
      return createOpenAICompatible({
        name: provider.id,
        baseURL: baseUrl,
        apiKey,
        // Ask for the final usage frame; providers that do not support it ignore it.
        includeUsage: true,
        fetch: tunnelFetch,
      })(modelId);
  }
}

/** The AI SDK package each protocol is served by, for display and diagnostics. */
export const PROTOCOL_PACKAGE: Record<Protocol, string> = {
  anthropic: '@ai-sdk/anthropic',
  google: '@ai-sdk/google',
  openai: '@ai-sdk/openai-compatible',
  local: '@ai-sdk/openai-compatible',
};
