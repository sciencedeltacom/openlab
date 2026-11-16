/**
 * Finding files and lines.
 *
 * The Rust half is `commands/search.rs`, with the same shape: the search is anchored to the
 * workspace root, `.git`, `node_modules` and build output are skipped, files past the size cap
 * are left alone rather than half-read, and matches are capped so one broad pattern cannot
 * print a megabyte.
 */

import { readFileSync, readdirSync, realpathSync, statSync, type Dirent } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { scopedDir } from './fs';

/** Largest file grep reads. Bigger files are skipped rather than half-searched. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Most matches grep returns. */
export const MAX_MATCHES = 200;

/** Directory names never descended into. */
export const SKIP_DIRS = ['.git', 'node_modules', 'target', 'dist', '.venv', '__pycache__'];

/** One glob match, as the caller reads it. */
export interface GlobMatch {
  path: string;
  /** Path relative to the workspace root. */
  relative: string;
  size: number;
  modifiedMs: number;
}

/** Every file under a root, depth-first, skipping the directories nothing wants searched. */
export function walkFiles(root: string, skip: readonly string[] = SKIP_DIRS): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (skip.includes(entry.name)) continue;
        visit(full);
        continue;
      }
      found.push(full);
    }
  };
  visit(realpathSync(root));
  return found;
}

/** Find files by glob pattern, newest first, anchored to the workspace root. */
export function globFiles(pattern: string, root: string, path?: string): GlobMatch[] {
  // A `path` narrows the search; it must still be inside the workspace, and a symlinked one
  // is resolved before the glob runs.
  const base = path ? scopedDir(path, root) : realpathSync(root);
  const glob = new Bun.Glob(pattern);
  const matches: GlobMatch[] = [];

  for (const relativePath of glob.scanSync({ cwd: base, onlyFiles: true, dot: true })) {
    if (SKIP_DIRS.some((dir) => relativePath.split(sep).includes(dir))) continue;
    const full = resolve(base, relativePath);
    try {
      const stats = statSync(full);
      matches.push({
        path: full,
        relative: relative(realpathSync(root), full),
        size: stats.size,
        modifiedMs: Math.floor(stats.mtimeMs),
      });
    } catch {
      // A file that vanished mid-scan is not a result.
    }
  }

  return matches.sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/** One matching line. */
export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

/** Find lines matching a regular expression, anchored to the workspace root. */
export function grepFiles(
  pattern: string,
  root: string,
  options: { path?: string; glob?: string; ignoreCase?: boolean; maxMatches?: number } = {},
): { matches: GrepMatch[]; truncated: boolean; pattern: string } {
  const max = options.maxMatches ?? MAX_MATCHES;
  const base = options.path ? scopedDir(options.path, root) : realpathSync(root);
  const regex = new RegExp(pattern, options.ignoreCase ? 'i' : '');
  const nameFilter = options.glob ? new Bun.Glob(options.glob) : null;
  const matches: GrepMatch[] = [];
  let truncated = false;

  for (const file of walkFiles(base)) {
    if (matches.length >= max) {
      truncated = true;
      break;
    }
    if (nameFilter && !nameFilter.match(file)) continue;
    let stats;
    try {
      stats = statSync(file);
    } catch {
      continue;
    }
    if (stats.size > MAX_FILE_BYTES) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      // A binary or non-UTF-8 file is skipped, not an error.
      continue;
    }
    const shown = relative(realpathSync(root), file);
    text.split('\n').forEach((line, index) => {
      if (matches.length >= max) {
        truncated = true;
        return;
      }
      if (regex.test(line)) {
        matches.push({ path: shown, line: index + 1, text: line.trim() });
      }
    });
  }

  return { matches, truncated, pattern };
}
