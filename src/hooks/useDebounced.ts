/**
 * A value that settles after typing stops.
 *
 * Search fields filter as you type, and re-filtering a long list on every
 * keystroke is wasted work. The field keeps the immediate value it draws; the
 * list reads the debounced one.
 */

import { useEffect, useState } from 'react';

/** `value`, after it has stopped changing for `delayMs`. */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);

  return settled;
}
