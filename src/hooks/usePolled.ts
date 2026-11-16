/**
 * Re-run something on an interval.
 *
 * A running job's elapsed time only moves if its row re-renders, and a queue
 * that polls a status wants the same clock. This calls `run` every interval and
 * returns the timestamp, so a caller that only wants the re-render can ignore
 * the callback.
 */

import { useEffect, useRef, useState } from 'react';

/**
 * Call `run` every `intervalMs` and return the current time.
 *
 * The returned timestamp changes with each tick, which is what re-renders a
 * caller that passes a no-op `run`. `run` is read through a ref, so an inline
 * arrow does not restart the timer.
 */
export function usePolled(run: () => void, intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      runRef.current();
      setNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);

  return now;
}
