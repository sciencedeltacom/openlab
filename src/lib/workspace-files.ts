/**
 * Walking a workspace folder.
 *
 * The Files page and a paired folder both need "every file under here, as one flat list", so
 * the walk lives once. Paths are relative to the folder that was walked, which is what both
 * callers compare and act on.
 */

import { invokeCommand } from '@/lib/ipc';

/** One file the walk found. */
export interface WalkedFile {
  /** Relative to the folder that was walked. */
  path: string;
  name: string;
  size: number;
  /** Epoch milliseconds, or 0 when the file system did not say. */
  modified: number;
}

/** What one `list_dir` entry carries. */
interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modifiedMs: number | null;
}

/** Directories that are never the lab's work, so the walk never descends into them. */
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '__pycache__', '.git']);

/** A ceiling on a pathological tree, so one wrong pick cannot lock the UI. */
const MAX_FILES = 2000;
const MAX_DEPTH = 12;

/** Walk `dir` (relative to `root`) and append its files. Returns this directory's listing error. */
async function walk(
  root: string,
  dir: string,
  base: string,
  files: WalkedFile[],
  depth: number,
): Promise<string | null> {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) {
    return null;
  }
  const listed = await invokeCommand<Entry[]>('list_dir', { path: dir, root });
  if (!listed.ok) {
    return listed.error.message;
  }
  for (const entry of listed.value) {
    if (files.length >= MAX_FILES) {
      break;
    }
    if (entry.name.startsWith('.')) {
      continue;
    }
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDir) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      // One unreadable subdirectory is skipped, not fatal: the caller still shows the rest.
      await walk(root, path, rel, files, depth + 1);
      continue;
    }
    files.push({ path: rel, name: entry.name, size: entry.size, modified: entry.modifiedMs ?? 0 });
  }
  return null;
}

/** One file by its path, read from its folder's listing; undefined when it is not there. */
export async function statWorkspaceFile(root: string, path: string): Promise<WalkedFile | undefined> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) {
    return undefined;
  }
  const listed = await invokeCommand<Entry[]>('list_dir', { path: parts.join('/'), root });
  if (!listed.ok) {
    return undefined;
  }
  const entry = listed.value.find((candidate) => candidate.name === name);
  if (!entry || entry.isDir) {
    return undefined;
  }
  return { path: name, name: entry.name, size: entry.size, modified: entry.modifiedMs ?? 0 };
}

/** Every file under `folder` (relative to `root`), with the listing error the walk met. */
export async function walkWorkspaceFiles(
  root: string,
  folder = '',
): Promise<{ files: WalkedFile[]; error: string | null }> {
  const files: WalkedFile[] = [];
  const error = await walk(root, folder, '', files, 0);
  return { files, error };
}
