/**
 * Workspace files.
 *
 * The Rust half of this is `commands/workspace.rs`, and the rules are its rules: a path that
 * leaves the workspace is refused (checked lexically first so a `..` cannot create a directory
 * outside the root, then again after resolving symlinks), a read is capped so one file cannot
 * flood the terminal, and a write creates its parents. A command that passes no root is
 * working on an absolute path the user typed, and is left alone.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Largest file `read` returns; larger ones say so instead of being pulled in. */
export const MAX_READ_BYTES = 8 * 1024 * 1024;

/** One entry of a directory listing. */
export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modifiedMs: number | null;
}

/** Resolve `..` without touching the filesystem, so a path can be checked first. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of resolve(path).split(sep)) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return sep + parts.join(sep);
}

/** The workspace root as the filesystem sees it. */
function canonicalRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    throw new Error(`could not open the workspace ${root}`);
  }
}

/**
 * True when `child` is `base` itself or really inside it.
 *
 * A plain `startsWith` also accepts a sibling that merely shares the prefix
 * (`/lab` accepts `/lab-evil`), so compare the relative path instead.
 */
export function isWithin(child: string, base: string): boolean {
  const rel = relative(base, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Join onto the root and prove the result stays inside it. */
export function scopedRead(path: string, root: string): string {
  const base = canonicalRoot(root);
  const joined = normalize(path.startsWith('/') ? path : join(base, path));
  if (!isWithin(joined, base)) {
    throw new Error(`${path} is outside the workspace`);
  }
  try {
    const resolved = realpathSync(joined);
    if (!isWithin(resolved, base)) {
      throw new Error(`${path} is outside the workspace`);
    }
    return resolved;
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside the workspace')) throw error;
    throw new Error(`could not open ${path}`);
  }
}

/** A directory inside the workspace, resolved through symlinks before it is returned. */
export function scopedDir(path: string, root: string): string {
  const resolved = scopedRead(path, root);
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`${path} is not a directory`);
  }
  return resolved;
}

/** The same containment for a write, where the file itself may not exist yet. */
export function scopedWrite(path: string, root: string): string {
  const base = canonicalRoot(root);
  const joined = normalize(path.startsWith('/') ? path : join(base, path));
  if (!isWithin(joined, base)) {
    throw new Error(`${path} is outside the workspace`);
  }
  const parent = dirname(joined);
  // Prove the nearest existing ancestor is inside the root *before* creating anything: a
  // symlinked parent would otherwise let `mkdir -p` write outside the workspace first.
  let existing = parent;
  while (!existsSync(existing)) {
    const up = dirname(existing);
    if (up === existing) break;
    existing = up;
  }
  if (!isWithin(realpathSync(existing), base)) {
    throw new Error(`${path} is outside the workspace`);
  }
  mkdirSync(parent, { recursive: true });
  const realParent = realpathSync(parent);
  if (!isWithin(realParent, base)) {
    throw new Error(`${path} is outside the workspace`);
  }
  const target = join(realParent, basename(joined));
  // The parent is proven inside the root, but the file itself may already be a symlink
  // pointing out of it — a write would follow it.
  if (existsSync(target) && statSync(target).isSymbolicLink()) {
    const resolved = realpathSync(target);
    if (!isWithin(resolved, base)) {
      throw new Error(`${path} is outside the workspace`);
    }
  }
  return target;
}

/** Resolve a path for one command: inside the root when one is given, otherwise as typed. */
export function scoped(path: string, root?: string | null): string {
  return root ? scopedRead(path, root) : resolve(path);
}

/** True when the path is inside the workspace, for the containment check alone. */
export function isInside(path: string, root: string): boolean {
  try {
    return isWithin(realpathSync(path), realpathSync(root));
  } catch {
    return false;
  }
}

/** A path relative to the root, for display. */
export function displayPath(path: string, root: string): string {
  const shown = relative(root, path);
  return shown === '' ? '.' : shown;
}

/** List a directory: directories first, then alphabetically. */
export function listDir(path: string, root?: string | null): DirEntry[] {
  const target = scoped(path, root);
  const entries = readdirSync(target, { withFileTypes: true }).map((entry) => {
    const full = join(target, entry.name);
    let size = 0;
    let modifiedMs: number | null = null;
    try {
      const stats = statSync(full);
      size = stats.isDirectory() ? 0 : stats.size;
      modifiedMs = Math.floor(stats.mtimeMs);
    } catch {
      // A broken symlink lists, but has no size.
    }
    return {
      name: entry.name,
      path: full,
      isDir: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
      size,
      modifiedMs,
    };
  });

  return entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Read a text file, refusing anything past the cap. */
export function readFile(path: string, root?: string | null): string {
  const target = scoped(path, root);
  const stats = statSync(target);
  if (stats.size > MAX_READ_BYTES) {
    throw new Error(`${path} is ${Math.round(stats.size / 1024 / 1024)} MB; too large to read`);
  }
  return readFileSync(target, 'utf8');
}

/** Write a text file, creating its parents. */
export function writeFile(path: string, contents: string, root?: string | null): void {
  const target = root ? scopedWrite(path, root) : resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');
}

/** Remove a file, or a directory and everything under it. */
export function removeFile(path: string, root?: string | null): void {
  const target = scoped(path, root);
  rmSync(target, { recursive: true, force: true });
}

/** Move a file or directory. */
export function renameFile(from: string, to: string, root?: string | null): void {
  const source = scoped(from, root);
  const target = root ? scopedWrite(to, root) : resolve(to);
  renameSync(source, target);
}

/** Whether a path exists. */
export function pathExists(path: string, root?: string | null): boolean {
  try {
    return existsSync(scoped(path, root));
  } catch {
    return false;
  }
}

/** Whether a path is a directory. */
export function isDirectory(path: string, root?: string | null): boolean {
  try {
    return statSync(scoped(path, root)).isDirectory();
  } catch {
    return false;
  }
}

/** The size and modification time of a path. */
export function stat(
  path: string,
  root?: string | null,
): { path: string; isDir: boolean; size: number; modifiedMs: number | null } {
  const target = scoped(path, root);
  const stats = statSync(target);
  return {
    path: target,
    isDir: stats.isDirectory(),
    size: stats.isDirectory() ? 0 : stats.size,
    modifiedMs: Math.floor(stats.mtimeMs),
  };
}

/** The lines of a file, or null when it cannot be read as text. */
export function readLines(path: string): string[] | null {
  try {
    return readFileSync(path, 'utf8').split('\n');
  } catch {
    return null;
  }
}
