/**
 * Regenerates `public/models-dev.json` from https://models.dev/api.json.
 *
 * The catalog is data the app loads at runtime, so the shape is trimmed to what a model
 * picker needs: the provider, its base URL and key env var, and one compact entry per
 * model. Run with `bun scripts/models-dev.ts` and commit the result; the app never calls
 * models.dev itself.
 */

const SOURCE = 'https://models.dev/api.json';
const OUT = 'public/models-dev.json';

interface RawModel {
  id: string;
  name: string;
  tool_call?: boolean;
  reasoning?: boolean;
  limit?: { context?: number };
  modalities?: { input?: string[] };
}

interface RawProvider {
  id: string;
  name: string;
  doc?: string;
  api?: string;
  npm?: string;
  env?: string[];
  models?: Record<string, RawModel>;
}

const raw = (await (await fetch(SOURCE)).json()) as Record<string, RawProvider>;

const providers = Object.values(raw).map((provider) => ({
  id: provider.id,
  name: provider.name,
  doc: provider.doc ?? null,
  api: provider.api ?? null,
  npm: provider.npm ?? null,
  env: provider.env ?? [],
  models: Object.values(provider.models ?? {}).map((model) => {
    const entry: Record<string, unknown> = { id: model.id, name: model.name };
    const context = model.limit?.context ?? 0;
    if (context > 0) entry.context = context;
    if (model.tool_call) entry.tools = true;
    if (model.reasoning) entry.reasoning = true;
    if (model.modalities?.input?.includes('image')) entry.vision = true;
    return entry;
  }),
}));

const payload = { source: SOURCE, providers };
await Bun.write(OUT, JSON.stringify(payload));

const models = providers.reduce((total, provider) => total + provider.models.length, 0);
console.log(`wrote ${OUT}: ${providers.length} providers, ${models} models`);
