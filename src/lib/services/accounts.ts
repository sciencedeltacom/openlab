/**
 * The account connections, as a service.
 *
 * The status lives in the vault; this only caches what the Connections page reads and refreshes
 * it on a connect or a disconnect. A service, so the cache is owned and not a module-level `let`.
 */

import * as client from '@/lib/accounts/client';
import type { AccountState } from '@/lib/accounts/types';
import { ExternalStore } from './external';

export class AccountsService {
  readonly store = new ExternalStore<Record<string, AccountState>>({});

  private put(providerId: string, state: AccountState): void {
    this.store.update((states) => ({ ...states, [providerId]: state }));
  }

  /** Reload a provider's state from the vault. */
  async refresh(providerId: string): Promise<void> {
    this.put(providerId, await client.status(providerId));
  }

  /** Save the user's OAuth app credentials, then reload. */
  async setClient(providerId: string, clientId: string, clientSecret: string): Promise<void> {
    await client.setClient(providerId, clientId, clientSecret);
    await this.refresh(providerId);
  }

  /** Sign in, then reload. */
  async connect(providerId: string): Promise<void> {
    this.put(providerId, await client.connect(providerId));
  }

  /** Sign out, then reload. */
  async disconnect(providerId: string): Promise<void> {
    await client.disconnect(providerId);
    await this.refresh(providerId);
  }
}
