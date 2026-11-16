/**
 * The catalogue surfaces, in and out of SQLite.
 *
 * Databases and sources are app-level rather than workspace-level: they describe the world
 * outside a project, so they are read whole at boot and written whole on change. The diffing
 * syncer keeps the writes to the rows that actually changed.
 */

import type { Database } from '../../components/databases/data';
import type { CloudConnection, SyncPair } from '../cloud/types';
import type { Source } from '../catalog/sources';

import type { Db } from './client';
import * as t from './schema';
import { TableSyncer } from './sync';

const databaseSyncer = new TableSyncer<Database>(t.databases, (database, position) => ({
  id: database.id,
  position,
  name: database.name,
  family: database.family,
  mark: database.mark,
  purpose: database.purpose,
  recordCount: database.recordCount,
  access: database.access,
  state: database.state,
  authorization: database.authorization,
  endpoint: database.endpoint,
  operations: database.operations,
  defaultHeaders: database.defaultHeaders,
  holds: database.holds,
  updateCadence: database.updateCadence,
  licence: database.licence,
  docsUrl: database.docsUrl,
  sample: database.sample,
}));

/** Every database the workbench knows about, in order. */
export async function loadDatabases(db: Db): Promise<Database[]> {
  const rows = await db.select().from(t.databases).orderBy(t.databases.position);
  return rows.map(({ position: _position, ...database }) => database);
}

/** Write the database catalogue. */
export async function saveDatabases(db: Db, items: readonly Database[]): Promise<void> {
  await databaseSyncer.sync(db, items);
}

const sourceSyncer = new TableSyncer<Source>(t.sources, (source, position) => ({
  id: source.id,
  position,
  name: source.name,
  databaseId: source.databaseId,
  filters: source.filters,
  preview: source.preview,
  createdAt: source.createdAt,
}));

/** Every saved source, in order. */
export async function loadSources(db: Db): Promise<Source[]> {
  const rows = await db.select().from(t.sources).orderBy(t.sources.position);
  return rows.map(({ position: _position, ...source }) => source);
}

/** Write the source list. */
export async function saveSources(db: Db, items: readonly Source[]): Promise<void> {
  await sourceSyncer.sync(db, items);
}

const connectionSyncer = new TableSyncer<CloudConnection>(t.cloudConnections, (connection, position) => ({
  id: connection.id,
  position,
  providerId: connection.providerId,
  label: connection.label,
  config: connection.config,
  createdAt: connection.createdAt,
}));

/** Every connected cloud store, in order. */
export async function loadConnections(db: Db): Promise<CloudConnection[]> {
  const rows = await db.select().from(t.cloudConnections).orderBy(t.cloudConnections.position);
  return rows.map(({ position: _position, ...connection }) => connection);
}

/** Write the cloud connections. */
export async function saveConnections(db: Db, items: readonly CloudConnection[]): Promise<void> {
  await connectionSyncer.sync(db, items);
}

const pairSyncer = new TableSyncer<SyncPair>(t.syncPairs, (pair, position) => ({
  id: pair.id,
  position,
  connectionId: pair.connectionId,
  label: pair.label,
  kind: pair.kind,
  remotePath: pair.remotePath,
  remoteName: pair.remoteName,
  localPath: pair.localPath,
  createdAt: pair.createdAt,
}));

/** Every paired folder, in order. */
export async function loadPairs(db: Db): Promise<SyncPair[]> {
  const rows = await db.select().from(t.syncPairs).orderBy(t.syncPairs.position);
  // Pairs written before files could be paired hold two folders; that is the default.
  return rows.map(({ position: _position, kind, ...pair }) => ({ ...pair, kind: kind ?? 'folder' }));
}

/** Write the paired folders. */
export async function savePairs(db: Db, items: readonly SyncPair[]): Promise<void> {
  await pairSyncer.sync(db, items);
}

/** Drop the write memories, so the next save rewrites everything. */
export function resetCatalogSyncers(): void {
  databaseSyncer.reset();
  sourceSyncer.reset();
  connectionSyncer.reset();
  pairSyncer.reset();
}

/**
 * Adopt the catalogue already in the database as the last-written one.
 *
 * A process that has just started has written nothing, so a save would never delete a database
 * or a source the caller removed. See `TableSyncer.primeFromDb`.
 */
export async function primeCatalogSyncers(db: Db): Promise<void> {
  await databaseSyncer.primeFromDb(db);
  await sourceSyncer.primeFromDb(db);
  await connectionSyncer.primeFromDb(db);
  await pairSyncer.primeFromDb(db);
}
