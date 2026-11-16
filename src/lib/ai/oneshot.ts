/**
 * One-shot model calls.
 *
 * Not every use of the model is a conversation. Generating an API definition from a docs page
 * or drafting a review protocol is a single question with a single answer, so it does not need
 * a session, a transcript or tools — just the model the workbench is set to, the tunnel
 * transport, and the text back. This is that path.
 */

import { streamText } from 'ai';

import { createLanguageModel } from './models';
import type { Provider } from '@/lib/providers';
import { isLoopbackUrl, localOnlyEnabled } from '@/lib/settings';
import { allProviders, type AppState } from '@/store/types';

/** The provider and model the workbench is set to, ready to instantiate. */
export interface ActiveModel {
  provider: Provider;
  modelId: string;
  baseUrl: string;
}

/** Resolve the active model from the store, or `null` when nothing usable is selected. */
export function activeModel(state: AppState): ActiveModel | null {
  const ref = state.modelRef;
  const slash = ref.indexOf('/');
  const providerId = slash === -1 ? ref : ref.slice(0, slash);
  const modelId = slash === -1 ? '' : ref.slice(slash + 1);
  const provider = allProviders(state).find((candidate) => candidate.id === providerId);
  if (!provider || !modelId) {
    return null;
  }
  const baseUrl = state.providerBaseUrls[provider.id] ?? provider.defaultBaseUrl ?? '';
  return baseUrl ? { provider, modelId, baseUrl } : null;
}

/** Ask the active model one question and return its answer. */
export async function askOnce(
  state: AppState,
  prompt: string,
  options: { system?: string; signal?: AbortSignal; maxTokens?: number } = {},
): Promise<string> {
  const target = activeModel(state);
  if (!target) {
    throw new Error('No model is ready. Choose one in Settings → Models and add its key.');
  }
  if (
    localOnlyEnabled(state.preferences) &&
    target.provider.protocol !== 'local' &&
    !isLoopbackUrl(target.baseUrl)
  ) {
    throw new Error(
      'Local-only mode is on, so the model was not called. Turn it off in Settings → Privacy, or choose a provider on this machine.',
    );
  }
  const model = createLanguageModel({
    provider: target.provider,
    modelId: target.modelId,
    baseUrl: target.baseUrl,
    sessionId: crypto.randomUUID(),
  });
  const result = streamText({
    model,
    system: options.system,
    prompt,
    // A one-shot answer is a bounded answer: without a cap a chatty model bills the whole
    // model maximum for a title or a screening decision.
    maxOutputTokens: options.maxTokens ?? 4_096,
    ...(options.signal ? { abortSignal: options.signal } : {}),
  });
  return (await result.text).trim();
}

/**
 * Pull the first JSON object out of a model's answer.
 *
 * Models wrap JSON in prose or a code fence however they like; this takes the first balanced
 * `{…}` and parses it, returning `null` rather than throwing when there is nothing usable.
 */
export function firstJsonObject<T>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf('{');
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
