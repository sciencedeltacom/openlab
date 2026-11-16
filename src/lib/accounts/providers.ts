/**
 * Global accounts — the providers you sign in to once.
 *
 * Google Drive and GitHub are not pasted keys; you sign in, and the tokens live in the vault
 * (see `commands/oauth.rs`). This registry is the provider's side of that: where to send the user,
 * what to ask for, and how to read the profile that comes back. The OAuth app's client id and
 * secret are the user's own, entered once in the Connections surface.
 */

import type { AccountProvider, AccountState } from './types';

const GOOGLE: AccountProvider = {
  id: 'google',
  label: 'Google',
  icon: 'google',
  summary: 'Sign in with Google to reach Drive.',
  docsUrl: 'https://console.cloud.google.com/apis/credentials',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: [
    // Reads and writes: syncing a paired folder sends a local file back to Drive, and Drive's
    // narrower `drive.file` scope would only ever see files this app created.
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  // `offline` + `consent` is what returns a refresh token, so a sign-in lasts.
  extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  profileUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  name: (profile) => String(profile.email ?? profile.name ?? 'Google account'),
  detail: (profile) => String(profile.name ?? ''),
};

const GITHUB: AccountProvider = {
  id: 'github',
  label: 'GitHub',
  icon: 'github',
  summary: 'Sign in with GitHub to reach repositories.',
  docsUrl: 'https://github.com/settings/developers',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scopes: ['repo', 'read:user'],
  profileUrl: 'https://api.github.com/user',
  name: (profile) => String(profile.login ?? 'GitHub account'),
  detail: (profile) => String(profile.name ?? profile.email ?? ''),
};

/** Every account provider, in the order the Connections surface lists them. */
export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = [GOOGLE, GITHUB];

/** An account provider by id. */
export function findAccountProvider(id: string): AccountProvider | undefined {
  return ACCOUNT_PROVIDERS.find((provider) => provider.id === id);
}

/** The label an account shows, from its stored profile. */
export function accountLabel(state: AccountState | undefined, providerId: string): string {
  const provider = findAccountProvider(providerId);
  const profile = state?.profile;
  if (!provider) {
    return providerId;
  }
  return profile ? provider.name(profile as Record<string, unknown>) : provider.label;
}
