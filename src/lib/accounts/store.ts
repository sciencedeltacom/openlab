/**
 * The account connections, live — the public surface.
 *
 * The cache lives in {@link AccountsService}, built by the composition root. These functions
 * are what the Connections page imports, unchanged.
 */

import { useSyncExternalStore } from 'react';

import { services } from '@/lib/container';
import type { AccountState } from './types';

/** One provider's state, live. */
export function useAccount(providerId: string): AccountState | undefined {
  const { store } = services.accounts;
  return useSyncExternalStore(store.subscribe, () => store.get()[providerId]);
}

/** Reload a provider's state from the vault. */
export async function refreshAccount(providerId: string): Promise<void> {
  await services.accounts.refresh(providerId);
}

/** Save the user's OAuth app credentials, then reload. */
export async function setAccountClient(
  providerId: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await services.accounts.setClient(providerId, clientId, clientSecret);
}

/** Sign in, then reload. */
export async function connectAccount(providerId: string): Promise<void> {
  await services.accounts.connect(providerId);
}

/** Sign out, then reload. */
export async function disconnectAccount(providerId: string): Promise<void> {
  await services.accounts.disconnect(providerId);
}
