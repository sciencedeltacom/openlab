/**
 * The connected cloud stores, live — the public surface.
 *
 * The list lives in {@link CloudService}, built by the composition root. These functions are
 * what the Files page imports, unchanged.
 */

import { useSyncExternalStore } from 'react';

import { services } from '@/lib/container';
import type { CloudConnection, SyncPair } from './types';

/** The connections, live. */
export function useConnections(): CloudConnection[] {
  const { store } = services.cloud;
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Fill the list from the database. Called once, by `bootStorage`. */
export async function hydrateConnections(): Promise<void> {
  await services.cloud.hydrate();
}

/** A connection by id, or undefined when the link is stale. */
export function findConnection(id: string): CloudConnection | undefined {
  return services.cloud.find(id);
}

/** Add a connection to the front of the list. */
export function addConnection(connection: CloudConnection): void {
  services.cloud.add(connection);
}

/** Remove a connection. */
export function removeConnection(id: string): void {
  services.cloud.remove(id);
}

/** The paired folders, live. */
export function usePairs(): SyncPair[] {
  const { pairs } = services.cloud;
  return useSyncExternalStore(pairs.subscribe, pairs.get);
}

/** Pair a workspace folder with a store's folder. */
export function addPair(pair: SyncPair): void {
  services.cloud.addPair(pair);
}

/** Forget a pairing. Neither folder changes. */
export function removePair(id: string): void {
  services.cloud.removePair(id);
}

/** A pair by id, or undefined when the link is stale. */
export function findPair(id: string): SyncPair | undefined {
  return services.cloud.findPair(id);
}
