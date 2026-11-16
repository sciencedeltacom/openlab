/**
 * The packs this build ships.
 *
 * Kept in its own module, with no imports, so the extension registry can check a manifest
 * against the shipped ids without importing the runtime that imports the registry back.
 * `agent/packs` re-exports it, so every reader keeps using one name.
 */
export const PACK_IDS = [
  'genomics',
  'molecular',
  'ml',
  'structural-biology',
  'cheminformatics',
  'proteomics',
  'transcriptomics',
  'imaging',
  'epidemiology',
] as const;

/** A pack this build ships. Installed extensions may define their own, never these. */
export type ShippedPackId = (typeof PACK_IDS)[number];
