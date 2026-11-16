/**
 * The account providers, as data.
 *
 * Each is a small descriptor: where the sign-in goes, what it asks for, and how to read the
 * profile that comes back. The OAuth engine itself lives in Rust; this is the provider's side.
 */

/** One account provider a user can sign in to. */
export interface AccountProvider {
  id: string;
  label: string;
  /** A simpleicons slug for its brand mark, when one exists. */
  icon?: string;
  summary: string;
  docsUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Provider-specific authorize parameters, e.g. Google's `access_type=offline`. */
  extra?: Record<string, string>;
  /** A JSON endpoint answering the signed-in profile. */
  profileUrl: string;
  /** The account's display name, from its profile. */
  name(profile: Record<string, unknown>): string;
  /** A quiet second line, from its profile. */
  detail(profile: Record<string, unknown>): string;
}

/** What the app knows about one account. */
export interface AccountState {
  connected: boolean;
  /** The provider's OAuth app client id, for display. Never the secret. */
  clientId?: string;
  profile?: Record<string, unknown>;
}
