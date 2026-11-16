/**
 * Model providers — the model-agnostic layer.
 *
 * openlab ships no default vendor. A provider is data: where it lives, how it
 * authenticates, and what it is good at. Adding one is an entry in {@link PROVIDERS},
 * not a code path, and "Custom OpenAI-compatible" makes any endpoint reachable
 * without waiting for a release.
 *
 * Model references are always `provider/model-id`, so a session, a skill and a
 * sub-agent can each point at a different model without the rest of the app
 * knowing which vendor that implies.
 */

/** How a provider speaks on the wire. */
export type Protocol =
  /** Anthropic Messages API (`/v1/messages`). */
  | 'anthropic'
  /** OpenAI Chat Completions (`/chat/completions`). The lingua franca. */
  | 'openai'
  /** Google Generative Language API. */
  | 'google'
  /** A server on the user's own machine; no key, no cost, no network. */
  | 'local';

/** One configurable value on a provider card. */
export interface ProviderField {
  key: string;
  label: string;
  /** Rendered as a password field and never logged. */
  secret?: boolean;
  placeholder?: string;
  /** Shown under the field. */
  help?: string;
  required?: boolean;
}

/** A model the user can pick, before any live discovery has happened. */
export interface ModelDescriptor {
  /** Provider-local id, e.g. `claude-sonnet-4-6`. */
  id: string;
  /** What the picker shows. */
  label: string;
  /** Tokens of combined context, when known. Drives the usage meter. */
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  /** Exposes a reasoning/effort control. */
  supportsReasoning?: boolean;
}

/** A place models can come from. */
export interface Provider {
  id: string;
  label: string;
  protocol: Protocol;
  /** Left empty when the user must supply it (self-hosted, custom gateway). */
  defaultBaseUrl?: string;
  /** False only for local servers that accept unauthenticated requests. */
  requiresKey: boolean;
  /** Where a user gets a key or finds the model list. */
  docsUrl?: string;
  /** One line on when to choose this provider. */
  summary: string;
  fields: ProviderField[];
  /** Offline fallback list. Live discovery replaces it when the endpoint answers. */
  models: ModelDescriptor[];
}

/** The API key field every hosted provider shares. */
const keyField = (placeholder: string): ProviderField => ({
  key: 'apiKey',
  label: 'API key',
  secret: true,
  required: true,
  placeholder,
});

const baseUrlField = (placeholder: string, help?: string): ProviderField => ({
  key: 'baseUrl',
  label: 'Base URL',
  placeholder,
  help,
});

/**
 * Every provider openlab knows about out of the box.
 *
 * Ordered by how likely a new user is to want it: direct hosts first, then
 * aggregators, then local servers, then the escape hatch.
 */
export const PROVIDERS: Provider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresKey: true,
    docsUrl: 'https://console.anthropic.com/settings/keys',
    summary: 'Claude models. Strongest at long-context reasoning and careful tool use.',
    fields: [keyField('sk-ant-…')],
    models: [
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        contextWindow: 200_000,
        supportsTools: true,
        supportsVision: true,
        supportsReasoning: true,
      },
      {
        id: 'claude-opus-4-6',
        label: 'Claude Opus 4.6',
        contextWindow: 200_000,
        supportsTools: true,
        supportsVision: true,
        supportsReasoning: true,
      },
      {
        id: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        contextWindow: 200_000,
        supportsTools: true,
        supportsVision: true,
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    docsUrl: 'https://platform.openai.com/api-keys',
    summary: 'GPT models. Broad ecosystem and reliable structured output.',
    fields: [keyField('sk-…')],
    models: [
      {
        id: 'gpt-5.2',
        label: 'GPT-5.2',
        contextWindow: 400_000,
        supportsTools: true,
        supportsVision: true,
        supportsReasoning: true,
      },
      {
        id: 'gpt-5.2-mini',
        label: 'GPT-5.2 mini',
        contextWindow: 400_000,
        supportsTools: true,
        supportsVision: true,
      },
    ],
  },
  {
    id: 'google',
    label: 'Google AI',
    protocol: 'google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresKey: true,
    docsUrl: 'https://aistudio.google.com/apikey',
    summary: 'Gemini models. Very large context windows at low cost.',
    fields: [keyField('AIza…')],
    models: [
      {
        id: 'gemini-3.1-pro',
        label: 'Gemini 3.1 Pro',
        contextWindow: 1_000_000,
        supportsTools: true,
        supportsVision: true,
        supportsReasoning: true,
      },
      {
        id: 'gemini-3.1-flash',
        label: 'Gemini 3.1 Flash',
        contextWindow: 1_000_000,
        supportsTools: true,
        supportsVision: true,
      },
    ],
  },
  {
    id: 'opencode',
    label: 'OpenCode Zen',
    protocol: 'openai',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    requiresKey: true,
    docsUrl: 'https://opencode.ai/docs/zen',
    summary:
      'OpenCode membership: one key for a curated set of frontier models, including free contributor tiers.',
    fields: [keyField('sk-…')],
    models: [
      {
        id: 'muse-spark-1.3-contributor-free',
        label: 'Muse Spark 1.3 (free)',
        contextWindow: 1_048_576,
        supportsTools: true,
        supportsVision: true,
        supportsReasoning: true,
      },
      {
        id: 'deepseek-v4.1-flash',
        label: 'DeepSeek V4.1 Flash',
        contextWindow: 1_000_000,
        supportsTools: true,
        supportsVision: true,
        supportsReasoning: true,
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        contextWindow: 1_000_000,
        supportsTools: true,
        supportsVision: true,
        supportsReasoning: true,
      },
      {
        id: 'gpt-5.2',
        label: 'GPT-5.2',
        contextWindow: 400_000,
        supportsTools: true,
        supportsVision: true,
        supportsReasoning: true,
      },
      {
        id: 'glm-5.3-flash',
        label: 'GLM-5.3 Flash',
        contextWindow: 1_000_000,
        supportsTools: true,
        supportsVision: true,
        supportsReasoning: true,
      },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    docsUrl: 'https://openrouter.ai/keys',
    summary: 'One key for hundreds of models across many vendors.',
    fields: [keyField('sk-or-…')],
    models: [],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    requiresKey: true,
    docsUrl: 'https://platform.deepseek.com/api_keys',
    summary: 'Low-cost reasoning and coding models.',
    fields: [keyField('sk-…')],
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', contextWindow: 128_000, supportsTools: true },
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek Reasoner',
        contextWindow: 128_000,
        supportsTools: true,
        supportsReasoning: true,
      },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    requiresKey: true,
    docsUrl: 'https://console.mistral.ai/api-keys',
    summary: 'European-hosted models with strong function calling.',
    fields: [keyField('…')],
    models: [],
  },
  {
    id: 'groq',
    label: 'Groq',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    docsUrl: 'https://console.groq.com/keys',
    summary: 'Extremely fast inference for open-weight models.',
    fields: [keyField('gsk_…')],
    models: [],
  },
  {
    id: 'xai',
    label: 'xAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.x.ai/v1',
    requiresKey: true,
    docsUrl: 'https://console.x.ai',
    summary: 'Grok models.',
    fields: [keyField('xai-…')],
    models: [],
  },
  {
    id: 'moonshot',
    label: 'Moonshot',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    requiresKey: true,
    docsUrl: 'https://platform.moonshot.ai/console/api-keys',
    summary: 'Kimi models with very long context.',
    fields: [keyField('sk-…')],
    models: [],
  },
  {
    id: 'zhipu',
    label: 'Zhipu',
    protocol: 'openai',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    requiresKey: true,
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    summary: 'GLM models.',
    fields: [keyField('…')],
    models: [],
  },
  {
    id: 'together',
    label: 'Together',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    requiresKey: true,
    docsUrl: 'https://api.together.ai/settings/api-keys',
    summary: 'Hosted open-weight models, including fine-tunes.',
    fields: [keyField('…')],
    models: [],
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    requiresKey: true,
    docsUrl: 'https://cloud.cerebras.ai',
    summary: 'Wafer-scale inference; unusually low latency.',
    fields: [keyField('csk-…')],
    models: [],
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    requiresKey: true,
    docsUrl: 'https://fireworks.ai/account/api-keys',
    summary: 'Open-weight inference with custom deployments.',
    fields: [keyField('fw_…')],
    models: [],
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
    requiresKey: true,
    docsUrl: 'https://deepinfra.com/dash/api_keys',
    summary: 'Cheap open-weight inference.',
    fields: [keyField('…')],
    models: [],
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.perplexity.ai',
    requiresKey: true,
    docsUrl: 'https://www.perplexity.ai/settings/api',
    summary: 'Models with built-in web search and citations.',
    fields: [keyField('pplx-…')],
    models: [],
  },
  {
    id: 'ollama',
    label: 'Ollama',
    protocol: 'local',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    requiresKey: false,
    docsUrl: 'https://ollama.com/download',
    summary: 'Local models. Nothing leaves the machine.',
    fields: [baseUrlField('http://127.0.0.1:11434/v1', 'Change only if Ollama listens elsewhere.')],
    models: [],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    protocol: 'local',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    requiresKey: false,
    docsUrl: 'https://lmstudio.ai',
    summary: 'Local models with a desktop model browser.',
    fields: [baseUrlField('http://127.0.0.1:1234/v1')],
    models: [],
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    protocol: 'local',
    defaultBaseUrl: 'http://127.0.0.1:8080/v1',
    requiresKey: false,
    docsUrl: 'https://github.com/ggml-org/llama.cpp',
    summary: 'A single GGUF served by `llama-server`.',
    fields: [baseUrlField('http://127.0.0.1:8080/v1')],
    models: [],
  },
  {
    id: 'vllm',
    label: 'vLLM',
    protocol: 'local',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    requiresKey: false,
    docsUrl: 'https://docs.vllm.ai',
    summary: 'High-throughput serving for your own weights.',
    fields: [baseUrlField('http://127.0.0.1:8000/v1')],
    models: [],
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    protocol: 'openai',
    requiresKey: false,
    summary:
      'Any OpenAI-compatible endpoint: a gateway, a lab server, a proxy. Fill in the base URL and the model id yourself.',
    fields: [
      baseUrlField('https://models.example.edu/v1', 'Must expose /chat/completions.'),
      {
        key: 'apiKey',
        label: 'API key',
        secret: true,
        help: 'Leave empty if the endpoint does not require one.',
      },
      {
        key: 'modelId',
        label: 'Model id',
        placeholder: 'my-model',
        required: true,
        help: 'Sent verbatim in the request body.',
      },
    ],
    models: [],
  },
];

/** Look a provider up by id. */
export function findProvider(id: string): Provider | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/**
 * The providers in play: the built-ins plus the ones the user added.
 *
 * A custom entry with the same id replaces the built-in, so a user can point a known provider
 * at their own gateway or model set without a code change — the same idea as OpenCode's
 * `provider` config block, kept in the app's own store.
 */
export function mergeProviders(custom: readonly Provider[] = []): Provider[] {
  const byId = new Map<string, Provider>();
  for (const provider of PROVIDERS) {
    byId.set(provider.id, provider);
  }
  for (const provider of custom) {
    byId.set(provider.id, provider);
  }
  return [...byId.values()];
}

/**
 * The name a model is sold under, from its `provider/model-id` reference.
 *
 * A session remembers the ref it ran on, which is the right thing to store and the wrong thing
 * to read: `claude-sonnet-4-6` is an id, `Claude Sonnet 4.6` is a model. The catalogue's own
 * label wins; a model the catalogue does not list falls back to its id rather than to nothing.
 */
export function modelLabel(providers: readonly Provider[], ref: string): string {
  const slash = ref.indexOf('/');
  const providerId = slash === -1 ? '' : ref.slice(0, slash);
  const modelId = slash === -1 ? ref : ref.slice(slash + 1);
  const provider = providers.find((candidate) => candidate.id === providerId);
  return provider?.models.find((model) => model.id === modelId)?.label ?? modelId;
}

/** A custom provider from the registry form. */
export function createProvider(input: {
  id: string;
  label: string;
  protocol: Protocol;
  baseUrl: string;
  requiresKey: boolean;
  summary?: string;
  models?: ModelDescriptor[];
}): Provider {
  return {
    id: input.id.trim(),
    label: input.label.trim() || input.id.trim(),
    protocol: input.protocol,
    defaultBaseUrl: input.baseUrl.trim() || undefined,
    requiresKey: input.requiresKey,
    summary: input.summary?.trim() || 'A provider added in this app.',
    fields: input.requiresKey ? [keyField('…')] : [baseUrlField(input.baseUrl.trim())],
    models: input.models ?? [],
  };
}

/** A model from the registry's one-per-line entry: `id | label | context`, label and context optional. */
export function parseModelLine(line: string): ModelDescriptor | undefined {
  const [id, label, context] = line.split('|').map((part) => part.trim());
  if (!id) {
    return undefined;
  }
  const window = context ? Number(context) : NaN;
  return {
    id,
    label: label || id,
    ...(Number.isFinite(window) && window > 0 ? { contextWindow: window } : {}),
    supportsTools: true,
  };
}
