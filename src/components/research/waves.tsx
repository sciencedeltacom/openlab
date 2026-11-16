/**
 * A wave's timing, and the strip that draws it.
 *
 * A wave is a bounded stretch of days, so the one thing both the list and its page say first
 * is where today sits inside it: the cells before today are spent, today is marked, the rest
 * are still open. Shared here so the two surfaces cannot disagree about how much of a cycle is
 * gone.
 */

import { cn } from '@/lib/cn';
import { waveDaysLeft, type Wave } from '@/store/research';
import { parseDay, toIso } from './shared';

const DAY_MS = 86_400_000;

/** Where a wave stands, in whole days. */
export interface WaveSchedule {
  /** Days the wave covers, counting both ends. */
  days: number;
  /** Days from its start to today; negative before it opens, `>= days` once it is over. */
  elapsed: number;
  /** Days to its end: 0 on the last day, negative once passed. */
  left: number;
  /** How much of the window has gone, 0–1. */
  ratio: number;
}

export function waveSchedule(wave: Wave, now = new Date()): WaveSchedule {
  const start = parseDay(wave.startDate).getTime();
  const end = parseDay(wave.endDate).getTime();
  const days = Math.max(1, Math.round((end - start) / DAY_MS) + 1);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const elapsed = Math.round((today.getTime() - start) / DAY_MS);
  const left = waveDaysLeft(wave, toIso(today));
  return { days, elapsed, left, ratio: Math.max(0, Math.min(1, elapsed / days)) };
}

/** `9 days left`, `Last day`, or how far over it is once it has passed. */
export function daysLeftLabel(days: number): string {
  if (days > 1) return `${days} days left`;
  if (days === 1) return '1 day left';
  if (days === 0) return 'Last day';
  return `${-days} day${days === -1 ? '' : 's'} over`;
}

/**
 * The wave's days, one cell each.
 *
 * A normal cycle is short enough to draw every day, and counting the cells is the point of a
 * cycle; a very long window falls back to a bar rather than a comb of hairlines.
 */
export function DayStrip({ wave, className, now }: { wave: Wave; className?: string; now?: Date }) {
  const { days, elapsed } = waveSchedule(wave, now);

  if (days > 31) {
    const share = Math.max(0, Math.min(1, elapsed / days)) * 100;
    return (
      <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary', className)}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
      </div>
    );
  }

  return (
    <div className={cn('flex h-3.5 items-stretch gap-[2px]', className)} aria-hidden>
      {Array.from({ length: days }, (_, index) => (
        <span
          key={index}
          className={cn(
            'flex-1 rounded-[2px]',
            index < elapsed ? 'bg-accent/45' : index === elapsed ? 'bg-accent' : 'bg-surface-secondary',
          )}
        />
      ))}
    </div>
  );
}
