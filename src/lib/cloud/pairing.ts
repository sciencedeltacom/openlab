/**
 * A paired folder: a workspace folder and a folder in a connected store, kept level by hand.
 *
 * Comparing walks both sides and matches **by relative path**, then decides each file's state
 * from what the two sides report. That is the honest limit of a comparison made by reference:
 * a file counts as in sync when both sides report the same size. A byte-for-byte check would
 * mean downloading the whole folder, which is the cost pairing exists to avoid.
 *
 * Nothing syncs on its own. Every write is one row's direction — pull that file from the
 * store, or push this one to it — so a conflict is a choice the reader makes, not a policy.
 */

import { invokeCommand } from '@/lib/ipc';
import { statWorkspaceFile, walkWorkspaceFiles } from '@/lib/workspace-files';
import { contextFor, downloadRemote, importFile, listRemote, uploadLocal } from './client';
import { diffSides, isNative, type RemoteFile, type SyncDiff, type SyncRow } from './diff';
import { findProvider } from './providers';
import { findConnection } from './store';
import type { CloudConnection, RemoteEntry, SyncPair } from './types';

export type { RemoteFile, SyncDiff, SyncRow, SyncState } from './diff';
export { diffSides, isNative } from './diff';

/** A ceiling on the remote walk, for the same reason the local one has one. */
const MAX_REMOTE_FILES = 1000;
const MAX_REMOTE_DEPTH = 8;

/** The media type to send for a workspace file, from its name. */
function mimeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const known: Record<string, string> = {
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    html: 'text/html',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    zip: 'application/zip',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ipynb: 'application/x-ipynb+json',
  };
  return known[ext] ?? 'application/octet-stream';
}

/** The pair's store, or a clear failure when the connection is gone. */
function connectionOf(pair: SyncPair): CloudConnection {
  const connection = findConnection(pair.connectionId);
  if (!connection) {
    throw new Error(`The store ${pair.label} was paired with is no longer connected.`);
  }
  return connection;
}

/** Every file under `path` in the store, walked one level at a time. */
async function walkRemote(
  connection: CloudConnection,
  path: string,
  base: string,
  out: RemoteFile[],
  depth: number,
): Promise<void> {
  if (depth > MAX_REMOTE_DEPTH || out.length >= MAX_REMOTE_FILES) {
    return;
  }
  const entries = await listRemote(connection, path);
  for (const entry of entries) {
    if (out.length >= MAX_REMOTE_FILES) {
      break;
    }
    if (entry.name.startsWith('.')) {
      continue;
    }
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDir) {
      await walkRemote(connection, entry.key, rel, out, depth + 1);
      continue;
    }
    out.push({ path: rel, entry });
  }
}

/**
 * Compare a file pair: one remote entry against one workspace file.
 *
 * Both sides are keyed by the remote name, so a local file called something else still pairs
 * with the entry the reader chose instead of becoming two one-sided rows.
 */
async function compareFilePair(pair: SyncPair, connection: CloudConnection, root: string): Promise<SyncDiff> {
  const provider = findProvider(connection.providerId);
  if (!provider?.stat) {
    throw new Error(`${connection.label} cannot address one file on its own.`);
  }
  const remote = await provider.stat(contextFor(connection), pair.remotePath);
  if (!remote) {
    throw new Error(`${pair.remoteName} is no longer in ${connection.label}.`);
  }
  const local = await statWorkspaceFile(root, pair.localPath);
  // One key for both sides: the row's path is a label here, not a route into a folder.
  const key = pair.remoteName;
  return diffSides(local ? [{ ...local, path: key }] : [], [{ path: key, entry: remote }]);
}

/** Compare a pairing: both folders, walked and matched, or two files side by side. */
export async function comparePair(pair: SyncPair, root: string): Promise<SyncDiff> {
  const connection = connectionOf(pair);
  if (pair.kind === 'file') {
    return compareFilePair(pair, connection, root);
  }
  const walked = await walkWorkspaceFiles(root, pair.localPath);
  let local = walked.files;
  if (walked.error) {
    // A folder that is not here yet holds nothing, and a pull will create it. Any other reason
    // the walk failed is a real error, not an empty side.
    const exists = await invokeCommand<boolean>('path_exists', { path: pair.localPath, root });
    if (!exists.ok || exists.value) {
      throw new Error(walked.error);
    }
    local = [];
  }
  const remote: RemoteFile[] = [];
  await walkRemote(connection, pair.remotePath, '', remote, 0);
  return diffSides(local, remote);
}

/** The workspace-relative path a row's local copy lives at. */
function localPathOf(pair: SyncPair, row: SyncRow): string {
  if (pair.kind === 'file') {
    return pair.localPath;
  }
  return pair.localPath ? `${pair.localPath}/${row.path}` : row.path;
}

/** The store's key for the folder a row's remote copy belongs in, created when it is missing. */
async function ensureRemoteFolder(
  connection: CloudConnection,
  rootKey: string,
  folderPath: string,
): Promise<string> {
  let parent = rootKey;
  for (const name of folderPath.split('/').filter(Boolean)) {
    const entries = await listRemote(connection, parent);
    const found = entries.find((entry) => entry.isDir && entry.name === name);
    if (found) {
      parent = found.key;
      continue;
    }
    const provider = findProvider(connection.providerId);
    if (!provider?.mkdir) {
      throw new Error(`${connection.label} is read-only, so it cannot hold a new folder.`);
    }
    const created = await provider.mkdir(contextFor(connection, parent), name, parent);
    if (!created) {
      throw new Error(`Could not create ${name} in ${connection.label}.`);
    }
    parent = created;
  }
  return parent;
}

/** Write one remote file over its local copy. */
export async function pullRow(pair: SyncPair, row: SyncRow, root: string): Promise<void> {
  const connection = connectionOf(pair);
  if (!row.remote) {
    return;
  }
  const url = await downloadRemote(connection, row.remote);
  if (!url) {
    throw new Error(`${connection.label} gave no download link for ${row.name}.`);
  }
  await importFile(connection, url, localPathOf(pair, row), root);
}

/** Write one local file over its remote copy, creating the folder above it when it is new. */
export async function pushRow(pair: SyncPair, row: SyncRow, root: string): Promise<void> {
  const connection = connectionOf(pair);
  if (!row.local) {
    return;
  }
  if (row.native) {
    throw new Error(`${row.name} is a Google document; only its export can come down.`);
  }
  const provider = findProvider(connection.providerId);
  if (!provider?.upload) {
    throw new Error(`${connection.label} is read-only, so it cannot take a file.`);
  }
  // A file pair writes over the entry it was paired with, so no folder has to exist: only a
  // folder pair can meet a local subfolder the store does not have yet.
  const folder =
    pair.kind === 'file'
      ? undefined
      : await ensureRemoteFolder(connection, pair.remotePath, row.path.split('/').slice(0, -1).join('/'));
  const plan = await provider.upload(contextFor(connection, folder), {
    name: row.local.name,
    key: row.remote?.key,
    folder,
    mime: mimeOf(row.local.name),
  });
  if (!plan) {
    throw new Error(`${connection.label} did not say where to write ${row.name}.`);
  }
  await uploadLocal(connection, plan, localPathOf(pair, row), root);
}

/** Whether a pair's store can take a file at all. */
export function canPush(pair: SyncPair): boolean {
  const connection = findConnection(pair.connectionId);
  return Boolean(connection && findProvider(connection.providerId)?.upload);
}
