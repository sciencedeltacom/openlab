/**
 * The window's size and place, remembered between launches.
 *
 * A desktop app that reopens at the wrong size is a small insult every morning. The bounds are
 * stored in local storage rather than the database: they describe this display, not the work,
 * and they should not travel with a workspace.
 *
 * Restoring runs once, before any save listener is attached, so the restore itself is not
 * mistaken for a resize and written back.
 */

import { useEffect } from 'react';

import { isDesktop } from '@/lib/ipc';

/** The key the bounds live under. */
const KEY = 'openlab.window-bounds';

/** A stored size smaller than this is a corrupt record, not a preference. */
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

interface Bounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

/** Read the stored bounds, ignoring anything that is not a usable window. */
function read(): Bounds | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Bounds>;
    if (
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number' ||
      parsed.width < MIN_WIDTH ||
      parsed.height < MIN_HEIGHT
    ) {
      return null;
    }
    return {
      width: Math.round(parsed.width),
      height: Math.round(parsed.height),
      ...(typeof parsed.x === 'number' ? { x: Math.round(parsed.x) } : {}),
      ...(typeof parsed.y === 'number' ? { y: Math.round(parsed.y) } : {}),
    };
  } catch {
    return null;
  }
}

/** Keep the window where the reader left it. */
export function useWindowState(): void {
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unlisteners: (() => void)[] = [];

    void (async () => {
      // A window API that is absent or incomplete (a browser preview, a partial runtime) must
      // leave the window where the system put it, not throw out of an effect.
      let api: typeof import('@tauri-apps/api/window');
      try {
        api = await import('@tauri-apps/api/window');
      } catch {
        return;
      }
      const { getCurrentWindow, PhysicalPosition, PhysicalSize } = api;
      let window: ReturnType<typeof getCurrentWindow>;
      try {
        window = getCurrentWindow();
      } catch {
        return;
      }
      const stored = read();
      if (disposed) return;

      if (stored) {
        try {
          await window.setSize(new PhysicalSize(stored.width, stored.height));
          if (stored.x !== undefined && stored.y !== undefined) {
            await window.setPosition(new PhysicalPosition(stored.x, stored.y));
          }
        } catch {
          // A stored position can be off-screen after a display change; the size alone is
          // still worth keeping, and the window manager will place it.
        }
      }

      const save = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void (async () => {
            try {
              const [size, position] = await Promise.all([window.innerSize(), window.outerPosition()]);
              localStorage.setItem(
                KEY,
                JSON.stringify({
                  width: size.width,
                  height: size.height,
                  x: position.x,
                  y: position.y,
                } satisfies Bounds),
              );
            } catch {
              // A window that is closing has no size to read; the last saved one stands.
            }
          })();
        }, 300);
      };

      const [onResized, onMoved] = await Promise.all([
        window.onResized(() => save()),
        window.onMoved(() => save()),
      ]);
      if (disposed) {
        onResized();
        onMoved();
        return;
      }
      unlisteners.push(onResized, onMoved);
    })();

    return () => {
      disposed = true;
      clearTimeout(timer);
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);
}
