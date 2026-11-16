/**
 * The way into the command palette.
 *
 * The palette itself is a modal — it takes the whole window, the way a search over everything
 * should — so what the chrome needs is the thing you press to open it. It sits in the strip's
 * right corner in tabs mode and at the foot of the column in sidebar mode: always in the same
 * place within whichever chrome you chose, and never in the way of the work.
 */

import { Command, Search } from 'lucide-react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';

/** The search control. `full` fills its row, for the foot of the sidebar. */
export function SearchButton({ full }: { full?: boolean } = {}) {
  const { dispatch } = useApp();

  return (
    <Button
      variant="secondary"
      aria-label="Search"
      onPress={() => dispatch({ type: 'palette/set', open: true })}
      className={cn('justify-start gap-2 font-normal', full ? 'w-full' : 'w-56')}
    >
      <Search className="size-3.5 shrink-0 text-muted" />
      <span className="flex-1 truncate text-start text-muted">Search reviews, tasks, pages…</span>
      <span className="flex shrink-0 items-center gap-0.5 text-meta text-muted">
        <Command className="size-3" />K
      </span>
    </Button>
  );
}
