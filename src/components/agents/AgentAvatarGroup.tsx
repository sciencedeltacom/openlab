/**
 * The agents a piece of work used, as a stack of avatars.
 *
 * HeroUI's `AvatarGroup` can only show an image or initials, and an agent's face here is its
 * orb. So this is the same idea with the app's own mark: overlapping circles, each one an
 * agent's orb, ringed in the surface they sit on so the overlap reads as a stack rather than a
 * smear. Three fit; the rest are counted.
 */

import { AgentOrb } from './AgentOrb';
import { defaultAvatarColor } from './data';
import { cn } from '@/lib/cn';

/** How many avatars before the count takes over. */
const DEFAULT_MAX = 3;

export function AgentAvatarGroup({
  names,
  max = DEFAULT_MAX,
  paused = true,
  className,
}: {
  /** Agent or worker names; duplicates are one avatar. */
  names: readonly string[];
  max?: number;
  /** Orbs hold their frame unless the caller wants them alive. */
  paused?: boolean;
  className?: string;
}) {
  const unique = [...new Set(names.filter((name) => name.trim().length > 0))];
  if (unique.length === 0) {
    return null;
  }
  const shown = unique.slice(0, max);
  const more = unique.length - shown.length;

  return (
    <span
      className={cn('flex shrink-0 items-center', className)}
      aria-label={`Agents: ${unique.join(', ')}`}
      role="img"
    >
      {shown.map((name, index) => (
        <span
          key={name}
          // The first sits on top of the stack, the way a pile of cards reads.
          style={{ zIndex: shown.length - index }}
          className={cn(
            'relative grid size-6 place-items-center rounded-full bg-surface ring-2 ring-surface',
            index > 0 && '-ms-1.5',
          )}
        >
          <AgentOrb color={defaultAvatarColor(name)} size={20} paused={paused} />
        </span>
      ))}
      {more > 0 && (
        <span className="relative -ms-1.5 grid size-6 place-items-center rounded-full bg-surface-tertiary ring-2 ring-surface text-[10px] font-medium tabular-nums text-muted">
          +{more}
        </span>
      )}
    </span>
  );
}
