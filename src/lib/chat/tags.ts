/**
 * Colours for bracketed status tokens.
 *
 * The same tag must always wear the same colour, on every render and in every session, so
 * the colour is derived from the tag's own name rather than from the order it appeared in.
 * A few common tags get the colour a reader expects; everything else hashes to one of the
 * palette, which is stable for that word.
 */

/** The colours a HeroUI chip accepts here. */
export type TagColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

/** Tags with an obvious colour, so `verified` is green and `deprecated` is red. */
const KNOWN: Record<string, TagColor> = {
  verified: 'success',
  stable: 'success',
  canonical: 'accent',
  standard: 'accent',
  deprecated: 'danger',
  broken: 'danger',
  blocked: 'danger',
  experimental: 'warning',
  beta: 'warning',
  draft: 'default',
  todo: 'default',
};

const PALETTE: readonly TagColor[] = ['default', 'accent', 'success', 'warning', 'danger'];

/** The colour for a tag: known ones by meaning, the rest by a stable hash of the word. */
export function tagColor(tag: string): TagColor {
  const key = tag.trim().toLowerCase();
  const known = KNOWN[key];
  if (known) {
    return known;
  }
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}
