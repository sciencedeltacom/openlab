/**
 * Talking to the account engine.
 *
 * The OAuth app's client id and secret the user enters go straight to the vault (`oauth_client_set`);
 * a sign-in (`oauth_connect`) opens the browser and resolves when the loopback callback has been
 * exchanged. Neither the tokens nor the client secret ever come back to the webview — only the
 * connected profile.
 */

import { invokeCommand } from '@/lib/ipc';
import { findAccountProvider } from './providers';
import type { AccountState } from './types';

/** Store the user's own OAuth app credentials for a provider. */
export async function setClient(providerId: string, clientId: string, clientSecret: string): Promise<void> {
  const result = await invokeCommand('oauth_client_set', { accountId: providerId, clientId, clientSecret });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
}

/** A provider's connection state: whether a client is set, and whether an account is connected. */
export async function status(providerId: string): Promise<AccountState> {
  const result = await invokeCommand<AccountState>('oauth_status', { accountId: providerId });
  if (!result.ok) {
    return { connected: false };
  }
  return result.value;
}

/** Sign in to a provider and return the connected state. */
export async function connect(providerId: string): Promise<AccountState> {
  const provider = findAccountProvider(providerId);
  if (!provider) {
    throw new Error('This provider is not an account provider.');
  }
  const result = await invokeCommand('oauth_connect', {
    accountId: providerId,
    spec: {
      authorizeUrl: provider.authorizeUrl,
      tokenUrl: provider.tokenUrl,
      scopes: provider.scopes,
      extra: provider.extra ?? {},
      profileUrl: provider.profileUrl,
    },
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return status(providerId);
}

/** Forget a provider's account; the OAuth app credentials are kept. */
export async function disconnect(providerId: string): Promise<void> {
  await invokeCommand('oauth_disconnect', { accountId: providerId });
}
