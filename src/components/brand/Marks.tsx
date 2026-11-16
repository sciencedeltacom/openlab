/**
 * The ScienceDelta marks.
 *
 * Two forms, both hung on the same product geometry: the openlab ring for product surfaces
 * and the workspace hexagon for folders (DESIGN_GUIDE §1.2). Single colour via
 * `currentColor`, never rotated, never gradient-filled.
 */

import { cn } from '@/lib/cn';

/**
 * The openlab mark: a hexagonal ring.
 *
 * A pointy-top regular hexagon with a second, concentric hexagon cut out of it. The
 * proportions are the app icon's — the inner hexagon's circumradius is 0.66 of the outer
 * one — expressed on a 1000-unit grid so the numbers stay readable.
 */
const RING_PATH =
  'M500 40 L898.4 270 L898.4 730 L500 960 L101.6 730 L101.6 270 Z ' +
  'M500 196.4 L762.9 348.2 L762.9 651.8 L500 803.6 L237.1 651.8 L237.1 348.2 Z';

/** The openlab product mark. */
export function LabLogo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1000 1000"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <path d={RING_PATH} fillRule="evenodd" clipRule="evenodd" fill="currentColor" />
    </svg>
  );
}

/**
 * The workspace hexagon.
 *
 * The mark a folder wears: a single outline, drawn from the same pointy-top geometry the
 * product uses for a workspace. One colour, no fill, never rotated.
 */
export function HexMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <path
        d="M12 3.2 19.4 7.6v8.8L12 20.8 4.6 16.4V7.6z"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The brand loader: three triangles in a wave, the middle one inverted (§8.2).
 * Used for every async state instead of a spinner.
 */
export function DeltaLoader({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[3px] text-accent', className)} aria-label="Working">
      {[0, 1, 2].map((index) => (
        <svg
          key={index}
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={cn(index === 1 && 'rotate-180')}
          style={{ animation: `openlab-wave 1.5s ${index * 0.2}s infinite cubic-bezier(0.4, 0, 0.2, 1)` }}
        >
          <polygon points="12,3 21,20 3,20" strokeLinejoin="round" />
        </svg>
      ))}
      <style>{`@keyframes openlab-wave {
        0%, 100% { opacity: .2; transform: translateY(0) scale(.8); }
        50% { opacity: 1; transform: translateY(-4px) scale(1); }
      }`}</style>
    </span>
  );
}

/** Live-status dot: a pinging ring over a solid centre (§8.2). */
export function PingDot({
  className,
  tone = 'accent',
}: {
  className?: string;
  tone?: 'accent' | 'success' | 'warning';
}) {
  const color = tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-accent';
  return (
    <span className={cn('relative flex size-2 shrink-0', className)}>
      <span className={cn('absolute inline-flex size-2 animate-ping rounded-full opacity-60', color)} />
      <span className={cn('relative inline-flex size-2 rounded-full', color)} />
    </span>
  );
}

/** Section label used above grouped lists and form blocks (§4.3). */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('section-label', className)}>{children}</div>;
}
