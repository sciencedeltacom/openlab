/** Mirrors `CommandError` in `src-tauri/src/error.rs`. */
export interface CommandError {
  /** Stable category: `io`, `git`, `invalid`, `json`, `no-runtime`, `unknown`. */
  kind: string;
  /** Human-readable explanation, safe to show in the UI. */
  message: string;
}

/** Mirrors `GitInfo` in `src-tauri/src/commands/git.rs`. */
export interface GitInfo {
  isRepo: boolean;
  root: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
}

/** Mirrors `GitFileStatus` in `src-tauri/src/commands/git.rs`. */
export interface GitFileStatus {
  path: string;
  /** Index status character: `M`, `A`, `D`, `R`, `?`, ` `. */
  index: string;
  /** Work-tree status character. */
  worktree: string;
  staged: boolean;
  originalPath: string | null;
}

/** Mirrors `GitStatus` in `src-tauri/src/commands/git.rs`. */
export interface GitStatus {
  info: GitInfo;
  files: GitFileStatus[];
}

/** Mirrors `DirEntry` in `src-tauri/src/commands/workspace.rs`. */
export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
}

/** Mirrors `FileStat` in `src-tauri/src/commands/workspace.rs`. */
export interface FileStat {
  path: string;
  isDir: boolean;
  size: number;
  modifiedMs: number | null;
}
