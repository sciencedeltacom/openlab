/**
 * Reaching a model from the terminal.
 *
 * The app hands the AI SDK a `fetch` that posts through Rust, because the webview is
 * cross-origin and the key lives in the OS store. Neither is true here: the CLI is the process,
 * so it builds the model directly, with the key it found in the environment or its own vault.
 * Everything else is the app's own code — the same provider registry, the same protocol-to-SDK
 * mapping, the same system prompt and run loop.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, type LanguageModel } from 'ai';

import { providerHeaders } from '@/lib/ai/transport';
import type { Provider } from '@/lib/providers';
import { allProviders, type AppState } from '@/store/types';

import { catalogProviders, envFor } from './catalog';
import { keyHint, providerKey } from './host/secrets';

/** The provider and model a turn runs against, with the credential already resolved. */
export interface ModelTarget {
  provider: Provider;
  modelId: string;
  baseUrl: string;
  /** `null` only for a server that takes no credential. */
  key: string | null;
}

/** Fill in the models.dev catalogue, so a provider that is not a built-in can be named. */
export function withCatalog(state: AppState): AppState {
  if (state.catalogProviders.length === 0) {
    state.catalogProviders = catalogProviders();
  }
  return state;
}

/** Resolve `provider/model-id` (or the workbench's own selection) to something reachable. */
export function resolveModel(state: AppState, ref?: string): ModelTarget {
  const reference = ref ?? state.modelRef;
  const slash = reference.indexOf('/');
  const providerId = slash === -1 ? reference : reference.slice(0, slash);
  const modelId = slash === -1 ? '' : reference.slice(slash + 1);

  const provider = allProviders(withCatalog(state)).find((candidate) => candidate.id === providerId);
  if (!provider) {
    throw new Error(`No provider is registered for “${providerId}”. See \`openlab providers list\`.`);
  }
  if (!modelId) {
    throw new Error(`No model is named in “${reference}”. Use provider/model-id.`);
  }
  const baseUrl = state.providerBaseUrls[provider.id] ?? provider.defaultBaseUrl ?? '';
  if (!baseUrl) {
    throw new Error(`${provider.label} has no base URL. Set one with \`openlab providers base-url\`.`);
  }

  const names = envFor(provider.id);
  const key = provider.requiresKey ? providerKey(provider.id, names) : null;
  if (provider.requiresKey && !key) {
    throw new Error(`No credential for ${provider.label}: ${keyHint(provider.id, names)}.`);
  }
  return { provider, modelId, baseUrl, key };
}

/** Whether the catalogue says this model exposes a reasoning control. */
export function supportsReasoning(target: ModelTarget): boolean {
  return target.provider.models.find((model) => model.id === target.modelId)?.supportsReasoning ?? false;
}

/** Build the AI SDK model, straight over the network. */
export function createDirectModel(target: ModelTarget): LanguageModel {
  const { provider, modelId, baseUrl, key } = target;
  // OpenCode's endpoints ask a client to name itself and to carry a stable session id.
  const headers = providerHeaders(baseUrl, crypto.randomUUID());
  const fetchImpl =
    headers.length === 0
      ? undefined
      : (((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          const merged = new Headers(init?.headers);
          for (const [name, value] of headers) {
            merged.set(name, value);
          }
          return fetch(input, { ...init, headers: merged });
        }) as typeof fetch);

  switch (provider.protocol) {
    case 'anthropic':
      return createAnthropic({ baseURL: baseUrl, apiKey: key ?? 'openlab', fetch: fetchImpl })(modelId);
    case 'google':
      return createGoogleGenerativeAI({ baseURL: baseUrl, apiKey: key ?? 'openlab', fetch: fetchImpl })(
        modelId,
      );
    default:
      return createOpenAICompatible({
        name: provider.id,
        baseURL: baseUrl,
        apiKey: key ?? undefined,
        includeUsage: true,
        fetch: fetchImpl,
      })(modelId);
  }
}

/** A streaming one-shot call: the text as it arrives, and the whole answer at the end. */
export interface AskStream {
  textStream: AsyncIterable<string>;
  text: Promise<string>;
}

/** Ask the selected model one question, with no session and no tools. */
export function streamAsk(
  state: AppState,
  prompt: string,
  options: { system?: string; modelRef?: string; signal?: AbortSignal } = {},
): AskStream {
  const target = resolveModel(state, options.modelRef);
  const result = streamText({
    model: createDirectModel(target),
    system: options.system,
    prompt,
    ...(options.signal ? { abortSignal: options.signal } : {}),
  });
  return { textStream: result.textStream, text: Promise.resolve(result.text).then((text) => text.trim()) };
}

/** Ask the selected model one question and wait for the whole answer. */
export async function ask(
  state: AppState,
  prompt: string,
  options: { system?: string; modelRef?: string; signal?: AbortSignal } = {},
): Promise<string> {
  return streamAsk(state, prompt, options).text;
}
