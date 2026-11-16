/**
 * The scan pipeline, from the interface.
 *
 * Every call goes through the Rust commands (`scan_*`), which own the Python worker. The
 * index root is the active project's `.openlab` folder unless the user pinned one in
 * Settings; a browser preview has no worker at all and gets a readable failure rather than
 * a crash.
 */

import { invokeCommand, type Result } from '@/lib/ipc';
import type { ScanDocument, ScanHealth, ScanProgress, ScanRequest, ScanSearchResult } from './types';

/** Where the index lives: the pinned path, or the project's own `.openlab` folder. */
export function scanRoot(workspacePath: string | null, pinned: string): string {
  const chosen = pinned.trim();
  if (chosen) {
    return chosen;
  }
  return workspacePath ? `${workspacePath.replace(/\/$/, '')}/.openlab` : '';
}

/** Index one record's PDF. */
export function scanPdf(root: string, request: ScanRequest): Promise<Result<ScanDocument>> {
  return invokeCommand<ScanDocument>('scan_pdf', { root, args: request });
}

/** Ask the index a question. */
export function searchLibrary(
  root: string,
  query: string,
  options: { docIds?: string[]; limit?: number } = {},
): Promise<Result<ScanSearchResult>> {
  return invokeCommand<ScanSearchResult>('search_library', {
    root,
    query,
    docIds: options.docIds ?? null,
    limit: options.limit ?? 10,
  });
}

/**
 * Listen for scan progress. Resolves to an unsubscribe function; a plain browser gets a
 * no-op because there is no worker to report anything.
 */
export async function onScanProgress(handler: (progress: ScanProgress) => void): Promise<() => void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return () => undefined;
  }
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<ScanProgress>('scan://progress', (event) => handler(event.payload));
  return unlisten;
}

/** Which engines the pipeline found on this machine, for the engine page. */
export function scanHealth(root: string): Promise<Result<ScanHealth>> {
  return invokeCommand<ScanHealth>('scan_health', { root });
}

/**
 * The scan engine's Python, installed on demand.
 *
 * The interpreter and its packages are not in the installer — Surya alone would add roughly a
 * gigabyte — so they are fetched into the app's data directory when a reader asks for them.
 */
export interface EngineStatus {
  /** An interpreter is present and its packages finished installing. */
  installed: boolean;
  /** The interpreter path, when there is one. */
  python: string | null;
  /** The install directory. */
  path: string | null;
  /** The packages an install puts in place. */
  packages: string[];
}

/** One line of engine-install progress. */
export interface EngineProgress {
  phase: 'download' | 'extract' | 'install' | string;
  /** Percent, on the download phase only. */
  pct: number | null;
  /** The line pip printed, on the install phase. */
  line: string | null;
}

/** Whether the engine is installed, and where. */
export function scanEngineStatus(): Promise<Result<EngineStatus>> {
  return invokeCommand<EngineStatus>('scan_engine_status', {});
}

/** Fetch the pinned Python and the worker's packages into the app's data directory. */
export function scanEngineInstall(): Promise<Result<EngineStatus>> {
  return invokeCommand<EngineStatus>('scan_engine_install', {});
}

/** Listen for engine-install progress. Resolves to an unsubscribe function. */
export async function onScanEngineProgress(handler: (progress: EngineProgress) => void): Promise<() => void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return () => undefined;
  }
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<EngineProgress>('scan://engine', (event) => handler(event.payload));
  return unlisten;
}
