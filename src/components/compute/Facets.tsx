/**
 * The facet furniture the compute filters share with the tracker.
 *
 * A filter is a popover of tabs, one facet per tab, and every row carries its own mark and
 * a check. This is copied from the tracker's toolbar on purpose: a reader who has used one
 * filter in openlab should not have to learn a second.
 */

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/cn';

/** The checkbox-like mark that says whether a facet row is on. Tone, never a stroke. */
export function CheckMark({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded',
        on ? 'bg-accent text-accent-foreground' : 'bg-surface-tertiary',
      )}
      aria-hidden
    >
      {on && <Check className="size-3" />}
    </span>
  );
}

/** One pressable pick in a facet: its own mark, a label, and whether it is on. */
export function FacetRow({
  on,
  mark,
  label,
  onPress,
}: {
  on: boolean;
  mark?: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface',
        on && 'bg-surface',
      )}
    >
      {mark}
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{label}</span>
      <CheckMark on={on} />
    </button>
  );
}
