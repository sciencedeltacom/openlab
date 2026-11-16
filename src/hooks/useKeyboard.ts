/**
 * One key binding, declared rather than hand-rolled.
 *
 * Everything that listens on `window` for a shortcut repeats the same
 * modifier dance and the same cleanup. This spells the binding as a string —
 * `"mod+k"`, `"escape"` — so what a shortcut is can be read at the call site.
 */

import { useEffect, useRef } from 'react';

/**
 * Run `handler` when `combo` is pressed.
 *
 * `mod` is Cmd on Apple hardware and Ctrl elsewhere. `ctrl` is Ctrl on both, which is what
 * the browser's own shortcuts use — Ctrl+Tab must not also fire on Cmd+Tab, because the
 * operating system owns that one. Modifiers left out must be up, so `"mod+k"` does not also
 * fire on Cmd+Shift+K.
 */
export function useKeyboard(combo: string, handler: (event: KeyboardEvent) => void, enabled = true): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    const parts = combo
      .toLowerCase()
      .split('+')
      .map((part) => part.trim());
    const key = parts[parts.length - 1];

    const onKeyDown = (event: KeyboardEvent) => {
      if (parts.includes('ctrl')) {
        if (!event.ctrlKey || event.metaKey) return;
      } else {
        const modifier = event.metaKey || event.ctrlKey;
        if (modifier !== parts.includes('mod')) return;
      }
      if (event.shiftKey !== parts.includes('shift')) return;
      if (event.altKey !== parts.includes('alt')) return;
      if (event.key.toLowerCase() !== key) return;
      handlerRef.current(event);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [combo, enabled]);
}
