//! Credential storage.
//!
//! API keys go to an encrypted [Stronghold](https://v2.tauri.app/plugin/stronghold/) vault in the
//! app's data directory. The macOS login keychain is deliberately avoided: an unsigned dev build
//! is re-signed on every compile, so its per-app keychain permission never matches the next build
//! and macOS asks for the login password on every read. The vault is unlocked by a 32-byte key
//! kept in a `0600` file beside it, so there is nothing to type and no keychain dialog.
//!
//! The UI can ask *whether* a key exists without being able to read it back; only the Rust side
//! ever reads a secret, to hand it to a provider.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use shaku::{Component, HasComponent, Interface};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_stronghold::stronghold::Stronghold;

use crate::error::CommandError;

/// The Stronghold client that owns the store.
const CLIENT: &[u8] = b"openlab";
/// The encrypted snapshot, inside the app data directory.
const VAULT_FILE: &str = "secrets.hold";
/// The 32-byte unlock key, beside the snapshot.
const KEY_FILE: &str = "secrets.key";

/// The credential store a command reaches.
pub trait Secrets: Interface {
    /// Store a value, overwriting any previous one.
    fn set(&self, app: &AppHandle, provider: &str, value: &str) -> Result<(), CommandError>;
    /// Read a stored value, or `None` when the provider has no key.
    fn get(&self, app: &AppHandle, provider: &str) -> Result<Option<String>, CommandError>;
    /// Remove a value.
    fn delete(&self, app: &AppHandle, provider: &str) -> Result<(), CommandError>;
    /// Which of the named providers have a stored key, without reading the keys.
    fn status(
        &self,
        app: &AppHandle,
        providers: &[String],
    ) -> Result<Vec<SecretStatus>, CommandError>;
}

/// The open vault, or `None` until the first command needs it.
#[derive(Component, Default)]
#[shaku(interface = Secrets)]
pub struct Vault {
    #[shaku(force_default)]
    vault: Mutex<Option<Stronghold>>,
}

impl Secrets for Vault {
    fn set(&self, app: &AppHandle, provider: &str, value: &str) -> Result<(), CommandError> {
        with_vault(app, self, |stronghold| write(stronghold, provider, value))
    }

    fn get(&self, app: &AppHandle, provider: &str) -> Result<Option<String>, CommandError> {
        with_vault(app, self, |stronghold| read(stronghold, provider))
    }

    fn delete(&self, app: &AppHandle, provider: &str) -> Result<(), CommandError> {
        with_vault(app, self, |stronghold| erase(stronghold, provider))
    }

    fn status(
        &self,
        app: &AppHandle,
        providers: &[String],
    ) -> Result<Vec<SecretStatus>, CommandError> {
        with_vault(app, self, |stronghold| {
            providers
                .iter()
                .map(|provider| {
                    Ok(SecretStatus {
                        has_key: read(stronghold, provider)?.is_some(),
                        provider: provider.clone(),
                    })
                })
                .collect()
        })
    }
}

fn fail(message: String) -> CommandError {
    CommandError::new("stronghold", message)
}

/// The app data directory, created if it does not exist.
fn data_dir(app: &AppHandle) -> Result<PathBuf, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| fail(format!("could not resolve the app data directory: {e}")))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| fail(format!("could not create {}: {e}", dir.display())))?;
    Ok(dir)
}

/// Write a file only the current user may read.
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    std::fs::write(path, bytes)
        .map_err(|e| fail(format!("could not write {}: {e}", path.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| fail(format!("could not protect {}: {e}", path.display())))?;
    }
    Ok(())
}

/// The 32-byte unlock key, generated on first use.
fn load_key(dir: &Path) -> Result<Vec<u8>, CommandError> {
    let path = dir.join(KEY_FILE);
    if let Ok(bytes) = std::fs::read(&path) {
        if bytes.len() == 32 {
            return Ok(bytes);
        }
    }
    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key).map_err(|e| fail(format!("no system randomness: {e}")))?;
    write_private(&path, &key)?;
    Ok(key.to_vec())
}

/// Open the vault, creating its store on first use.
fn open(app: &AppHandle) -> Result<Stronghold, CommandError> {
    let dir = data_dir(app)?;
    let stronghold = Stronghold::new(dir.join(VAULT_FILE), load_key(&dir)?)
        .map_err(|e| fail(format!("could not open the vault: {e}")))?;
    // An existing snapshot loads its client into memory; a fresh vault creates one.
    if stronghold.load_client(CLIENT).is_err() {
        stronghold
            .create_client(CLIENT)
            .map_err(|e| fail(format!("could not open the vault: {e}")))?;
    }
    Ok(stronghold)
}

/// Run `f` against the open vault, opening it once and reusing it.
fn with_vault<T>(
    app: &AppHandle,
    state: &Vault,
    f: impl FnOnce(&Stronghold) -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let mut guard = state
        .vault
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.is_none() {
        *guard = Some(open(app)?);
    }
    f(guard.as_ref().expect("the vault was just opened"))
}

/// Read a stored value, or `None` when the provider has no key.
fn read(stronghold: &Stronghold, provider: &str) -> Result<Option<String>, CommandError> {
    let client = stronghold
        .get_client(CLIENT)
        .map_err(|e| fail(format!("could not open the vault: {e}")))?;
    match client.store().get(provider.as_bytes()) {
        Ok(Some(bytes)) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| fail("the stored credential is not valid UTF-8".to_string())),
        Ok(None) => Ok(None),
        Err(e) => Err(fail(format!("could not read the key: {e}"))),
    }
}

/// Store a value and persist the vault.
fn write(stronghold: &Stronghold, provider: &str, value: &str) -> Result<(), CommandError> {
    let client = stronghold
        .get_client(CLIENT)
        .map_err(|e| fail(format!("could not open the vault: {e}")))?;
    client
        .store()
        .insert(
            provider.as_bytes().to_vec(),
            value.as_bytes().to_vec(),
            None,
        )
        .map_err(|e| fail(format!("could not save the key: {e}")))?;
    stronghold
        .save()
        .map_err(|e| fail(format!("could not save the vault: {e}")))
}

/// Remove a value and persist the vault.
fn erase(stronghold: &Stronghold, provider: &str) -> Result<(), CommandError> {
    let client = stronghold
        .get_client(CLIENT)
        .map_err(|e| fail(format!("could not open the vault: {e}")))?;
    client
        .store()
        .delete(provider.as_bytes())
        .map_err(|e| fail(format!("could not delete the key: {e}")))?;
    stronghold
        .save()
        .map_err(|e| fail(format!("could not save the vault: {e}")))
}

/// Read a credential for the Rust side (the chat proxy), opening the vault if needed.
pub(crate) fn read_secret(app: &AppHandle, provider: &str) -> Result<Option<String>, CommandError> {
    let module = app.state::<crate::services::AppModule>();
    let secrets: &dyn Secrets = module.resolve_ref();
    secrets.get(app, provider)
}

/// Store a credential on the Rust side, for an OAuth token the webview never sees.
pub(crate) fn write_secret(
    app: &AppHandle,
    provider: &str,
    value: &str,
) -> Result<(), CommandError> {
    let module = app.state::<crate::services::AppModule>();
    let secrets: &dyn Secrets = module.resolve_ref();
    secrets.set(app, provider, value)
}

/// Remove a credential on the Rust side.
pub(crate) fn delete_secret(app: &AppHandle, provider: &str) -> Result<(), CommandError> {
    let module = app.state::<crate::services::AppModule>();
    let secrets: &dyn Secrets = module.resolve_ref();
    secrets.delete(app, provider)
}

/// Store a credential. Overwrites any previous value.
#[tauri::command]
pub fn secret_set(
    app: AppHandle,
    services: State<'_, crate::services::AppModule>,
    provider: String,
    value: String,
) -> Result<(), CommandError> {
    if provider.trim().is_empty() {
        return Err(CommandError::invalid("a provider id is required"));
    }
    let secrets: &dyn Secrets = services.resolve_ref();
    secrets.set(&app, &provider, &value)
}

/// Remove a credential. Deleting one that is not there is not an error.
#[tauri::command]
pub fn secret_delete(
    app: AppHandle,
    services: State<'_, crate::services::AppModule>,
    provider: String,
) -> Result<(), CommandError> {
    let secrets: &dyn Secrets = services.resolve_ref();
    secrets.delete(&app, &provider)
}

/// Whether a credential exists, without reading it.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub provider: String,
    pub has_key: bool,
}

/// Report which of the given providers have a stored key.
#[tauri::command]
pub fn secrets_status(
    app: AppHandle,
    services: State<'_, crate::services::AppModule>,
    providers: Vec<String>,
) -> Result<Vec<SecretStatus>, CommandError> {
    let secrets: &dyn Secrets = services.resolve_ref();
    secrets.status(&app, &providers)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A vault key, fixed so the test is deterministic.
    fn key() -> Vec<u8> {
        vec![7u8; 32]
    }

    /// Open the vault the way {@link open} does, for a path the test controls.
    fn open_at(path: &Path) -> Stronghold {
        let stronghold = Stronghold::new(path, key()).unwrap();
        if stronghold.load_client(CLIENT).is_err() {
            stronghold.create_client(CLIENT).unwrap();
        }
        stronghold
    }

    /// A secret written to the vault survives a save and reopen, and deleting it sticks.
    #[test]
    fn stores_reads_and_deletes_a_secret() {
        let dir = std::env::temp_dir().join(format!("openlab-secrets-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("secrets.hold");
        let _ = std::fs::remove_file(&path);

        let stronghold = open_at(&path);
        write(&stronghold, "openai", "sk-test").unwrap();
        assert_eq!(
            read(&stronghold, "openai").unwrap(),
            Some("sk-test".to_string())
        );
        assert_eq!(read(&stronghold, "missing").unwrap(), None);

        // A fresh instance reads what was committed to disk.
        let reopened = open_at(&path);
        assert_eq!(
            read(&reopened, "openai").unwrap(),
            Some("sk-test".to_string())
        );

        erase(&stronghold, "openai").unwrap();
        let after = open_at(&path);
        assert_eq!(read(&after, "openai").unwrap(), None);

        std::fs::remove_dir_all(&dir).ok();
    }
}
