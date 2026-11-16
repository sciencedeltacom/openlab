/**
 * Folder selection.
 *
 * Shared by the welcome screen and the sidebar so both paths behave identically —
 * including the browser-preview fallback, which keeps the UI explorable when the
 * native dialog is not available.
 */

import { isDesktop } from './ipc';

/** Placeholder used when running in a browser, where no native picker exists. */
export const PREVIEW_WORKSPACE = '/Users/you/research/egfr-inhibitors';

/**
 * Ask the user for a folder.
 *
 * Returns `null` when they cancel, and falls back to a sample path in a plain browser
 * so the workbench can still be reviewed without the desktop shell.
 */
export async function pickWorkspaceFolder(): Promise<string | null> {
  if (!isDesktop()) {
    return PREVIEW_WORKSPACE;
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title: 'Choose a lab folder' });
  return typeof picked === 'string' ? picked : null;
}

/** Last path segment, for chrome that shows where a session lives. */
export function folderName(path: string | null): string {
  if (!path) {
    return 'No folder';
  }
  return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * Ask the user for files to attach.
 *
 * Returns absolute paths. In a browser preview there is no native picker, so this returns
 * an empty list rather than pretending something was attached.
 */
export async function pickFiles(): Promise<string[]> {
  if (!isDesktop()) {
    return [];
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ multiple: true, title: 'Attach files', directory: false });
  if (!picked) {
    return [];
  }
  return Array.isArray(picked) ? picked : [picked];
}

/** Last path segment of a file, for a chip label. */
export function fileName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}
