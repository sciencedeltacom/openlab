/**
 * Platform facts the layout needs.
 *
 * One of them matters: macOS draws its window controls *inside* the window when the title
 * bar is an overlay, so the top of the interface has to reserve room for them or the close
 * button lands on the first thing in the sidebar. Nothing else about the platform should
 * reach the UI.
 */

import { isDesktop } from './ipc';

/** Height the macOS traffic lights occupy, including their margin. */
const MACOS_TITLEBAR = 28;

/** True when the window controls are drawn over the interface. */
function hasOverlayControls(): boolean {
  if (!isDesktop() || typeof navigator === 'undefined') {
    return false;
  }
  return /Mac|iPhone|iPad/.test(navigator.platform ?? '') || /Mac OS X/.test(navigator.userAgent);
}

/**
 * Reserve room for the window controls, once, before the first paint.
 *
 * A development escape hatch is included on purpose: the browser preview has no traffic
 * lights, so without a way to ask for them the one layout that only exists on macOS could
 * not be looked at while working on it.
 */
export function applyTitlebarInset(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const forced = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('os') === 'macos'
    : false;
  const overlay = forced || hasOverlayControls();
  document.documentElement.dataset.os = overlay ? 'macos' : 'other';
  document.documentElement.style.setProperty('--titlebar-h', overlay ? `${MACOS_TITLEBAR}px` : '0px');
}

/** The attribute Tauri reads to make a region drag the window. */
export const DRAG_REGION = { 'data-tauri-drag-region': true } as const;
