/**
 * The small marks the compute screens share.
 *
 * A state, a target kind and a readiness level each own an icon and a tint, and they are
 * drawn in the ledger row, the board card, the facet popover, the record eyebrow and the
 * facts rail. Defining them once is what stops the four places disagreeing.
 */

import { cn } from '@/lib/cn';
import {
  JOB_STATE_META,
  READINESS_META,
  TARGET_KIND_META,
  type JobState,
  type Readiness,
  type TargetKind,
} from './data';

/** The accessible name for a job state's icon, since a chip also carries the word. */
function stateLabel(state: JobState): string {
  return JOB_STATE_META[state].label;
}

/** A job state's icon on its tint. */
export function JobStateMark({ state, className }: { state: JobState; className?: string }) {
  const meta = JOB_STATE_META[state];
  const Icon = meta.icon;
  return (
    <span
      role="img"
      aria-label={stateLabel(state)}
      className={cn('grid size-5 shrink-0 place-items-center rounded-md', meta.chip, className)}
    >
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

/** A target kind's icon on its tint. */
export function TargetKindMark({ kind, className }: { kind: TargetKind; className?: string }) {
  const meta = TARGET_KIND_META[kind];
  const Icon = meta.icon;
  return (
    <span
      role="img"
      aria-label={meta.label}
      className={cn('grid size-5 shrink-0 place-items-center rounded-md', meta.chip, className)}
    >
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

/** A readiness level's icon and its label, as a chip-shaped row. */
export function ReadinessMark({ readiness, className }: { readiness: Readiness; className?: string }) {
  const meta = READINESS_META[readiness];
  const Icon = meta.icon;
  return (
    <span className={cn('flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label', meta.chip, className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {meta.label}
    </span>
  );
}
