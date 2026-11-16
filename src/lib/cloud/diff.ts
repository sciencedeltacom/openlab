/**
 * Comparing two folders, file by file.
 *
 * Kept apart from the syncing itself so the rule can be pinned by a test: the two sides are
 * matched by relative path, and a file counts as in sync when both sides report the same size.
 * A native Google file has no size of its own, so it has no answer here — it can be pulled as
 * an export and never pushed.
 *
 * Type-only imports, deliberately: this module runs in the verification scripts as well as the
 * app, and it touches no command and no network.
 */

import type { RemoteEntry } from './types';
import type { WalkedFile } from '@/lib/workspace-files';

/** Where one file stands across the two folders. */
export type SyncState = 'local-only' | 'remote-only' | 'same' | 'differs' | 'unknown';

/** One file, as the comparison sees it. */
export interface SyncRow {
  /** Relative to the paired folder, on both sides. */
  path: string;
  name: string;
  local?: WalkedFile;
  remote?: RemoteEntry;
  state: SyncState;
  /** A Google-native file has no bytes of its own: it can be pulled as an export, never pushed. */
  native?: boolean;
}

/** A remote file and where it sits, relative to the paired folder. */
export interface RemoteFile {
  path: string;
  entry: RemoteEntry;
}

/** One comparison, with its totals. */
export interface SyncDiff {
  rows: SyncRow[];
  counts: Record<SyncState, number>;
}

/** A file the store holds no bytes for: it is a document, a sheet, a drawing. */
export function isNative(entry: RemoteEntry): boolean {
  return Boolean(entry.mime?.startsWith('application/vnd.google-apps.'));
}

/** What one file's state is, from both sides. */
function stateOf(local: WalkedFile | undefined, remote: RemoteEntry | undefined): SyncState {
  if (local && !remote) {
    return 'local-only';
  }
  if (!local && remote) {
    return 'remote-only';
  }
  if (!local || !remote) {
    return 'same';
  }
  // A native file's size is the size of nothing; its export is only weighed by downloading it.
  if (isNative(remote) || remote.size === undefined) {
    return 'unknown';
  }
  return local.size === remote.size ? 'same' : 'differs';
}

/** Match the two sides by relative path and decide each row. */
export function diffSides(local: WalkedFile[], remote: RemoteFile[]): SyncDiff {
  const rows = new Map<string, SyncRow>();

  for (const file of local) {
    rows.set(file.path, { path: file.path, name: file.name, local: file, state: 'local-only' });
  }
  for (const { path, entry } of remote) {
    const known = rows.get(path);
    if (known) {
      known.remote = entry;
      known.native = isNative(entry);
      known.state = stateOf(known.local, entry);
      continue;
    }
    rows.set(path, {
      path,
      name: entry.name,
      remote: entry,
      state: 'remote-only',
      native: isNative(entry),
    });
  }

  const counts: Record<SyncState, number> = {
    'local-only': 0,
    'remote-only': 0,
    same: 0,
    differs: 0,
    unknown: 0,
  };
  const sorted = [...rows.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const row of sorted) {
    counts[row.state] += 1;
  }
  return { rows: sorted, counts };
}
