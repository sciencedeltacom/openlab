/**
 * The small pieces the session panels are made of.
 *
 * Context, stats and settings are three views of one session, so they are built from one kit:
 * a label with a rule, a figure whose number is the point, and a thin meter. Boxes are avoided
 * on purpose — a panel of tiles reads as a dashboard, and these are a quiet read beside the
 * transcript.
 */

import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** A section of a panel: its name, an optional aside, and its content. */
export function PanelSection({
  label,
  aside,
  children,
  className,
}: {
  label: string;
  /** The count or total that belongs beside the name, right-aligned. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline gap-2 border-t border-separator pt-3">
        <span className="section-label">{label}</span>
        {aside !== undefined && <span className="ms-auto text-meta tabular-nums text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** A headline figure: the number is the point, the words under it are the footnote. */
export function Figure({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  /** A trailing unit, set small and quiet beside the number. */
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-meta text-muted">{label}</span>
      <span className="mt-1 flex items-baseline gap-1">
        <span className="text-[1.55rem] leading-none font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </span>
        {unit && <span className="text-meta text-muted">{unit}</span>}
      </span>
      {hint && <span className="mt-1.5 truncate text-meta text-muted">{hint}</span>}
    </div>
  );
}

/** A one-line label and its value, separated by a rule rather than a box. */
export function PanelLine({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0 truncate text-body text-muted">{label}</span>
      <span className={cn('shrink-0 tabular-nums text-body', tone ?? 'text-foreground')}>{value}</span>
    </div>
  );
}
