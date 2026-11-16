/**
 * The bridge between the open studio and the top bar.
 *
 * A figure's own controls belong in the one bar at the top of the window, not in a second
 * header under it. The studio owns that state — the history, the viewport, the document —
 * and the top bar is a sibling component, so the studio publishes what the bar needs and the
 * bar renders it. Nothing is duplicated: the same closures drive both.
 *
 * The published object is replaced on every studio render, so the bar never reads a stale
 * document, and cleared on unmount so the bar falls back to the plain title.
 */

import { useSyncExternalStore } from 'react';

export interface StudioControls {
  caption: string;
  canUndo: boolean;
  canRedo: boolean;
  grid: boolean;
  snap: boolean;
  onCaption: (value: string) => void;
  /** Write the caption to the store — on blur, not on every keystroke. */
  commitCaption: () => void;
  undo: () => void;
  redo: () => void;
  zoomBy: (factor: number) => void;
  fit: () => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  runExport: (kind: 'svg' | 'png' | 'png4' | 'json' | 'copy') => void;
}

let current: StudioControls | null = null;
const listeners = new Set<() => void>();

/** Publish the open studio's controls, or `null` when there is no studio. */
export function setStudioControls(next: StudioControls | null): void {
  current = next;
  for (const listener of listeners) listener();
}

/** The published controls, live. */
export function useStudioControls(): StudioControls | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
