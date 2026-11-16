/**
 * The CLI's credential vault.
 *
 * The desktop app keeps provider keys in an encrypted Stronghold snapshot, unlocked by a key
 * file beside it — a format only the Rust plugin can read. The terminal is a separate place to
 * work, so it keeps its own vault: a `0600` JSON file in the same data directory, plus the
 * environment, which is where a key usually already is on a machine that runs other tools.
 *
 * Lookup order for a provider key is environment first, then the vault, so `ANTHROPIC_API_KEY`
 * in a shell wins over something stored once and forgotten.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

import { secretsPath } from '../paths';

/** The stored keys, by name. */
type Vault = Record<string, string>;

/** Read the vault; a missing or unreadable file is an empty vault, not a failure. */
function readVault(): Vault {
  const path = secretsPath();
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Vault) : {};
  } catch {
    return {};
  }
}

/** Write the vault so only the current user can read it. */
function writeVault(vault: Vault): void {
  const path = secretsPath();
  writeFileSync(path, `${JSON.stringify(vault, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  // A file that already existed keeps its old mode; make sure it is still private.
  chmodSync(path, 0o600);
}

/** The names a stored value can have. */
export function secretNames(): string[] {
  return Object.keys(readVault()).sort();
}

/** A stored value, or `null`. */
export function getSecret(name: string): string | null {
  return readVault()[name] ?? null;
}

/** Store a value, overwriting any previous one. */
export function setSecret(name: string, value: string): void {
  writeVault({ ...readVault(), [name]: value });
}

/** Remove a value. Returns whether it was there. */
export function deleteSecret(name: string): boolean {
  const vault = readVault();
  if (!(name in vault)) {
    return false;
  }
  delete vault[name];
  writeVault(vault);
  return true;
}

/** Whether a value is stored. */
export function hasSecret(name: string): boolean {
  return getSecret(name) !== null;
}

/**
 * The key for a provider.
 *
 * An environment variable named by the provider (its models.dev `env` list) wins; otherwise the
 * vault is consulted under the provider id, then under the variable name. A local server needs
 * nothing and gets `null`, which the model factory reads as "no credential required".
 */
export function providerKey(providerId: string, envNames: readonly string[] = []): string | null {
  for (const name of envNames) {
    const fromEnv = process.env[name];
    if (fromEnv) {
      return fromEnv;
    }
  }
  return getSecret(providerId) ?? envNames.map((name) => getSecret(name)).find(Boolean) ?? null;
}

/** How a provider's key is named, for the message that says one is missing. */
export function keyHint(providerId: string, envNames: readonly string[] = []): string {
  const name = envNames[0] ?? `${providerId.toUpperCase()}_API_KEY`;
  return `set ${name}, or run \`openlab secrets set ${providerId}\``;
}
