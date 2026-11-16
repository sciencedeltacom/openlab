/**
 * Where things are.
 *
 * The CLI is the desktop app without its window, so it reads the same two places: the app's
 * data directory (where `openlab.db` lives) and the folder a lab works in. The data directory
 * is derived exactly as Tauri derives it from the bundle identifier, so `openlab` and the app
 * open the same database; `OPENLAB_DATA_DIR` overrides it for tests and for a second install.
 *
 * A workspace is found by walking up from the working directory for the markers openlab itself
 * leaves — `.labconfig`, `.openlab/`, `openwiki/` — which is how `git` finds a repository, so
 * `openlab status` works from anywhere inside a lab.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** The identifier the desktop app is built under; it names the data directory. */
export const APP_IDENTIFIER = 'dev.sciencedelta.deltalab';

/** Files and folders that mean "a lab is here". */
const MARKERS = ['.labconfig', '.openlab', 'openwiki'];

/** The app's data directory, created when `create` is set. */
export function dataDir(create = false): string {
  const override = process.env.OPENLAB_DATA_DIR;
  const dir = override
    ? resolve(override)
    : (() => {
        switch (process.platform) {
          case 'darwin':
            return join(homedir(), 'Library', 'Application Support', APP_IDENTIFIER);
          case 'win32':
            return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP_IDENTIFIER);
          default:
            return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), APP_IDENTIFIER);
        }
      })();
  if (create && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** The SQLite file the workbench keeps its records in. */
export function databasePath(): string {
  return process.env.OPENLAB_DB ?? join(dataDir(), 'openlab.db');
}

/** The CLI's own vault — provider keys for terminal use, never the app's Stronghold file. */
export function secretsPath(): string {
  return join(dataDir(true), 'cli-secrets.json');
}

/** The CLI's own preferences. */
export function configPath(): string {
  return join(dataDir(true), 'cli.json');
}

/** The `apps/openlab` folder — the CLI's `..`, and where the migrations and catalog live. */
export function appRoot(): string {
  return resolve(import.meta.dir, '..', '..', '..');
}

/** The desktop app's bundled models.dev snapshot. */
export function catalogPath(): string {
  return join(appRoot(), 'public', 'models-dev.json');
}

/** True when `dir` is a lab (it carries a marker). */
export function isLab(dir: string): boolean {
  return MARKERS.some((marker) => existsSync(join(dir, marker)));
}

/** The nearest lab at or above `start`, or `null`. */
export function findLab(start = process.cwd()): string | null {
  let dir = resolve(start);
  try {
    if (!statSync(dir).isDirectory()) {
      dir = dirname(dir);
    }
  } catch {
    return null;
  }
  for (;;) {
    if (isLab(dir)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * The lab a command runs against.
 *
 * An explicit path wins, then `OPENLAB_WORKSPACE`, then the nearest lab above the working
 * directory. A command that needs a lab and gets none says so rather than inventing a folder.
 */
export function resolveLabRoot(explicit?: string): string | null {
  const named = explicit ?? process.env.OPENLAB_WORKSPACE;
  if (named) {
    return resolve(named);
  }
  return findLab();
}

/** A short display path: `~/Studio/lab` rather than the whole home prefix. */
export function shortPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
