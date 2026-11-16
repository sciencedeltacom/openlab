/**
 * A clock that ticks once a second while `active` is true.
 *
 * A running session shows how long it has been working; this is the single ticker those badges
 * share, so a screen with ten sessions does not start ten intervals — it starts one per screen,
 * and none at all when nothing is running.
 */

import { useEffect, useState } from 'react';

export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
