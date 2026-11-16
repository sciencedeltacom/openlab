/**
 * The astroid mark.
 *
 * Lucide's `Astroid` is not in the icon set this build ships, and the AI page should wear it
 * rather than the generic sparkle. Same contract as a lucide icon — `LucideIcon` props, stroke
 * from `currentColor`, a 24px viewBox — so it slots into {@link PageEntry.icon} and a tab
 * draws it exactly like every other mark.
 */

import { forwardRef } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

/** The four-cusped curve, as lucide draws it. */
export const Astroid = forwardRef<SVGSVGElement, LucideProps>(({ strokeWidth = 2, ...props }, ref) => (
  <svg
    ref={ref}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M12.983 21.186a1 1 0 0 1-1.966 0 10 10 0 0 0-8.203-8.203 1 1 0 0 1 0-1.966 10 10 0 0 0 8.203-8.203 1 1 0 0 1 1.966 0 10 10 0 0 0 8.203 8.203 1 1 0 0 1 0 1.966 10 10 0 0 0-8.203 8.203" />
  </svg>
)) as unknown as LucideIcon;

Astroid.displayName = 'Astroid';
