/**
 * The models.dev catalog.
 *
 * models.dev is an open catalog of providers and their models. openlab ships a trimmed
 * snapshot at `public/models-dev.json` (regenerate with `bun scripts/models-dev.ts`) and
 * loads it once at startup, so every provider on models.dev is a ready-made entry in the
 * registry rather than something the user types in.
 *
 * The snapshot keeps the fields a picker needs; the mapping to a {@link Provider} happens
 * here, reusing the built-ins' base URLs where models.dev does not carry one (the AI SDK
 * knows its own defaults, openlab needs an explicit URL).
 */

import { PROVIDERS, type ModelDescriptor, type Protocol, type Provider } from './providers';

/** One provider in the snapshot. */
export interface CatalogProvider {
  id: string;
  name: string;
  doc?: string | null;
  api?: string | null;
  npm?: string | null;
  env?: string[];
  models: CatalogModel[];
}

/** One model in the snapshot. Absent capability flags mean "no". */
export interface CatalogModel {
  id: string;
  name: string;
  context?: number;
  tools?: boolean;
  reasoning?: boolean;
  vision?: boolean;
}

/** The snapshot file. */
interface CatalogFile {
  source: string;
  providers: CatalogProvider[];
}

/**
 * models.dev ids that name a built-in under a different id.
 *
 * Used only to recover a base URL; the catalog keeps its own id so a user can address the
 * exact provider they meant.
 */
const BASE_URL_ALIASES: Record<string, string> = {
  moonshotai: 'moonshot',
  zhipuai: 'zhipu',
  zai: 'zhipu',
  togetherai: 'together',
  'fireworks-ai': 'fireworks',
};

/** Servers that listen on the machine and need no key. */
const LOCAL_IDS = new Set(['ollama', 'lmstudio', 'llamacpp', 'llama', 'vllm']);

/** Which wire protocol a provider's AI SDK package speaks. */
export function protocolFor(npm?: string | null): Protocol {
  if (npm === '@ai-sdk/anthropic' || npm === '@ai-sdk/google-vertex/anthropic') return 'anthropic';
  if (npm === '@ai-sdk/google' || npm === '@ai-sdk/google-vertex') return 'google';
  return 'openai';
}

/**
 * The built-in this catalog entry names, if any.
 *
 * models.dev sometimes omits a base URL (the AI SDK knows its own default) or gives one
 * without the version path openlab needs, so a curated entry wins on the URL and protocol.
 * The catalog still contributes its model list.
 */
function builtinFor(entry: CatalogProvider): Provider | undefined {
  const direct = PROVIDERS.find((provider) => provider.id === entry.id);
  if (direct) return direct;
  const alias = BASE_URL_ALIASES[entry.id];
  return alias ? PROVIDERS.find((provider) => provider.id === alias) : undefined;
}

/** The base URL to reach a provider: a built-in's, models.dev's, or nothing. */
function baseUrlFor(entry: CatalogProvider, builtin?: Provider): string | undefined {
  return builtin?.defaultBaseUrl ?? entry.api ?? undefined;
}

/** True for a host on this machine, whether or not the catalog id says so. */
function isLocal(entry: CatalogProvider): boolean {
  if (LOCAL_IDS.has(entry.id)) return true;
  const url = entry.api ?? '';
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url);
}

/** One catalog entry as a provider the app can reach. */
export function catalogToProvider(entry: CatalogProvider): Provider {
  const builtin = builtinFor(entry);
  const protocol = builtin?.protocol ?? (isLocal(entry) ? 'local' : protocolFor(entry.npm));
  const baseUrl = baseUrlFor(entry, builtin);
  const requiresKey = protocol !== 'local' && (entry.env?.length ?? 0) > 0;
  const models: ModelDescriptor[] = entry.models.map((model) => ({
    id: model.id,
    label: model.name || model.id,
    ...(model.context ? { contextWindow: model.context } : {}),
    supportsTools: model.tools ?? false,
    supportsReasoning: model.reasoning ?? false,
    supportsVision: model.vision ?? false,
  }));

  return {
    id: entry.id,
    label: entry.name,
    protocol,
    defaultBaseUrl: baseUrl,
    requiresKey,
    docsUrl: entry.doc ?? undefined,
    summary: `${models.length} model${models.length === 1 ? '' : 's'} from models.dev.`,
    fields: requiresKey
      ? [
          {
            key: 'apiKey',
            label: 'API key',
            secret: true,
            required: true,
            placeholder: entry.env?.[0] ?? '…',
          },
        ]
      : [
          {
            key: 'baseUrl',
            label: 'Base URL',
            placeholder: baseUrl ?? 'https://example.com/v1',
          },
        ],
    models,
  };
}

/** Where the snapshot lives, so the UI can credit it. */
export const MODELS_DEV_SOURCE = 'https://models.dev';

let cached: Provider[] | null = null;

/**
 * Load the catalog once and keep it.
 *
 * A failure is not fatal: the built-ins and the user's own providers still work, so the
 * caller can log and carry on rather than block the app.
 */
export async function loadCatalogProviders(): Promise<Provider[]> {
  if (cached) return cached;
  const base = import.meta.env.BASE_URL ?? '/';
  const response = await fetch(`${base}models-dev.json`);
  if (!response.ok) {
    throw new Error(`models.dev catalog: HTTP ${response.status}`);
  }
  const file = (await response.json()) as CatalogFile;
  cached = file.providers.map(catalogToProvider);
  return cached;
}
