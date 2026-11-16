/**
 * The models.dev catalogue, from disk.
 *
 * The app loads the same snapshot over HTTP from `public/models-dev.json`; the CLI reads the
 * file directly, so the model list works offline and without the app running. The mapping to
 * a {@link Provider} is the app's own (`lib/models-dev`), so a provider reached from the
 * terminal is the same provider, with the same base URL and protocol, that the picker offers.
 */

import { readFileSync } from 'node:fs';

import { catalogToProvider, type CatalogProvider } from '@/lib/models-dev';
import type { Provider } from '@/lib/providers';

import { catalogPath } from './paths';

/** The snapshot file. */
interface CatalogFile {
  source: string;
  providers: CatalogProvider[];
}

let cached: { providers: Provider[]; entries: CatalogProvider[] } | null = null;

/** The catalogue, read once. A missing snapshot is not fatal: the built-ins still work. */
export function catalog(): { providers: Provider[]; entries: CatalogProvider[] } {
  if (cached) {
    return cached;
  }
  try {
    const file = JSON.parse(readFileSync(catalogPath(), 'utf8')) as CatalogFile;
    cached = { providers: file.providers.map(catalogToProvider), entries: file.providers };
  } catch {
    cached = { providers: [], entries: [] };
  }
  return cached;
}

/** The environment variables a provider reads its key from, per models.dev. */
export function envFor(providerId: string): string[] {
  return catalog().entries.find((entry) => entry.id === providerId)?.env ?? [];
}

/** Every provider a model reference can name: the built-ins, then the catalogue. */
export function catalogProviders(): Provider[] {
  return catalog().providers;
}
