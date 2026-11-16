/**
 * Git.
 *
 * Shelling out to the user's own `git`, exactly as `commands/git.rs` does, so hooks,
 * credential helpers, `core.autocrlf` and LFS behave the same here as in their terminal.
 * Status is read from `--porcelain=v1 -z`: NUL-delimited, never localised, and the only
 * format that survives paths with spaces or newlines.
 */

import { spawnSync } from 'node:child_process';

import { existsSync, statSync } from 'node:fs';

/** Repository identity and position. */
export interface GitInfo {
  isRepo: boolean;
  root: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
}

/** One changed path. */
export interface GitFileStatus {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
  originalPath: string | null;
}

/** Everything the Git panel needs in one round trip. */
export interface GitStatus {
  info: GitInfo;
  files: GitFileStatus[];
}

/** Run `git` in `cwd`; a failure carries git's own stderr. */
function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    // Keep output stable regardless of the user's language and pager.
    env: { ...process.env, GIT_PAGER: 'cat', LC_ALL: 'C' },
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    throw new Error(
      code === 'ENOENT' ? 'git was not found on PATH' : `could not run git: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    throw new Error(stderr || `git ${args.join(' ')} failed with ${result.status}`);
  }
  return result.stdout ?? '';
}

/** Run `git` and return whether it succeeded, for probes. */
function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

function ensureDir(cwd: string): void {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`${cwd} is not a directory`);
  }
}

/** Repository identity, ahead/behind counts and branch for `cwd`. */
export function info(cwd: string): GitInfo {
  ensureDir(cwd);
  if (tryGit(cwd, ['rev-parse', '--is-inside-work-tree']) === null) {
    return { isRepo: false, root: null, branch: null, ahead: 0, behind: 0 };
  }

  const root = (tryGit(cwd, ['rev-parse', '--show-toplevel']) ?? '').trim() || null;
  // `--abbrev-ref HEAD` prints "HEAD" when detached, which is not a branch name.
  const branchRaw = (tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim();
  const branch = branchRaw && branchRaw !== 'HEAD' ? branchRaw : null;

  let ahead = 0;
  let behind = 0;
  if (branch) {
    const counts = tryGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    if (counts) {
      const [left, right] = counts.trim().split(/\s+/);
      ahead = Number(left ?? 0) || 0;
      behind = Number(right ?? 0) || 0;
    }
  }
  return { isRepo: true, root, branch, ahead, behind };
}

/** Parse `git status --porcelain=v1 -z` output. */
export function parsePorcelain(raw: string): GitFileStatus[] {
  const files: GitFileStatus[] = [];
  const chunks = raw
    .split('\0')
    .filter((chunk) => chunk !== '')
    .values();

  for (;;) {
    const next = chunks.next();
    if (next.done) break;
    const chunk = next.value;
    if (chunk.length < 3) continue;
    const index = chunk[0];
    const worktree = chunk[1];
    const path = chunk.slice(2).replace(/^ +/, '');
    // `R` (renamed) and `C` (copied) are followed by the original path.
    const carriesOrigin = index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C';
    const original = carriesOrigin ? (chunks.next().value ?? null) : null;
    files.push({
      staged: index !== ' ' && index !== '?',
      index,
      worktree,
      path,
      originalPath: original,
    });
  }
  return files;
}

/** Repository identity and every changed path. */
export function status(cwd: string): GitStatus {
  const identity = info(cwd);
  if (!identity.isRepo) {
    return { info: identity, files: [] };
  }
  return {
    info: identity,
    files: parsePorcelain(git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])),
  };
}

/** Stage the given paths. */
export function stage(cwd: string, paths: string[]): void {
  ensureDir(cwd);
  git(cwd, ['add', '--', ...paths]);
}

/** Unstage the given paths, restoring the index entry from HEAD. */
export function unstage(cwd: string, paths: string[]): void {
  ensureDir(cwd);
  git(cwd, ['restore', '--staged', '--', ...paths]);
}

/** Stage everything and commit; returns the short hash of the new commit. */
export function commit(cwd: string, message: string, addAll: boolean): string {
  ensureDir(cwd);
  if (message.trim() === '') {
    throw new Error('a commit message is required');
  }
  if (addAll) {
    git(cwd, ['add', '-A']);
  }
  git(cwd, ['commit', '-m', message.trim()]);
  return git(cwd, ['rev-parse', '--short', 'HEAD']).trim();
}

/** One commit, as the log reads. */
export interface Commit {
  hash: string;
  date: string;
  author: string;
  subject: string;
}

/** The most recent commits. */
export function log(cwd: string, limit = 20): Commit[] {
  ensureDir(cwd);
  const raw = git(cwd, ['log', `-n${limit}`, '--pretty=format:%h%x1f%ad%x1f%an%x1f%s', '--date=short']);
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [hash, date, author, subject] = line.split('\x1f');
      return { hash, date, author, subject };
    });
}

/** The diff of the working tree (or the index), capped by the caller. */
export function diff(cwd: string, staged = false, paths: string[] = []): string {
  ensureDir(cwd);
  return git(cwd, ['diff', ...(staged ? ['--staged'] : []), '--', ...paths]);
}

/** Initialise a repository in `cwd` if there is none, and make one initial commit. */
export function init(cwd: string, message = 'Initial commit'): boolean {
  ensureDir(cwd);
  if (info(cwd).isRepo) {
    return false;
  }
  git(cwd, ['init']);
  return true;
}
