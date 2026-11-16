/**
 * ScienceDelta brand constants.
 *
 * The CSS variables in `theme/openlab.css` are what the UI actually paints with;
 * this module holds the values TypeScript needs (canvas drawing, generated icons,
 * inline SVG, future exports) so there is exactly one place to change a colour.
 */

/**
 * Research phases (§3.3). Every deliverable in the lab carries one, which is how
 * the UI communicates state without a wall of status text.
 */
export const PHASES = ['WRITING', 'ANALYSIS', 'REVIEW', 'PUBLISHED'] as const;
export type Phase = (typeof PHASES)[number];

/** Tailwind class triplets per phase: pastel wash, deep text, same-family border. */
export const PHASE_CLASS: Record<Phase, string> = {
  WRITING:
    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
  ANALYSIS:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  REVIEW:
    'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900',
  PUBLISHED:
    'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900',
};

/**
 * Motion constants (§8.1). The signature curve is the Apple-style ease-out used for
 * every entrance; the micro curve is for height and disclosure changes.
 */
export const MOTION = {
  signature: [0.22, 1, 0.36, 1] as const,
  micro: [0.4, 0, 0.2, 1] as const,
  duration: { micro: 0.15, panel: 0.2, entrance: 0.48 },
  spring: { type: 'spring' as const, stiffness: 300, damping: 30 },
} as const;
