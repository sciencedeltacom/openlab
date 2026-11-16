/**
 * The domain-pack section's built pages.
 *
 * The catalogue and the three guides are data, but the list and the record page are not — a
 * pack page composes its entry, its tools and its guide. This host keeps that composition
 * out of the registry.
 */

import { PackDetail } from '@/components/packs/PackDetail';
import { PacksView } from '@/components/packs/PacksView';

/** The pack routes this host owns. */
export const PACK_PATTERNS = new Set(['packs', 'packs/:packId']);

/** Render a pack route. */
export function PackHost({ pattern, params }: { pattern: string; params: Record<string, string> }) {
  if (pattern === 'packs') {
    return <PacksView />;
  }
  return <PackDetail packId={params.packId} />;
}
