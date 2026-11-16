//! Global account connections — OAuth 2.0 for the providers that need a signed-in account.
//!
//! Google Drive and GitHub are not reached with a pasted key; you sign in. This is the engine for
//! that: it opens the provider's consent page in the browser, catches the redirect on a loopback
//! port, exchanges the code for tokens (PKCE, S256), and keeps the tokens — plus the app's client
//! id/secret — in the Stronghold vault. The webview only ever sees the connected profile.
//!
//! The client credentials are the user's own OAuth app (see the Connections settings). They are
//! stored in the vault too, so a sign-in and every later refresh are self-contained and the
//! secret never crosses into the UI.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::commands::secrets;
use crate::error::CommandError;

/// The vault key holding an account's tokens and client credentials.
fn account_key(account_id: &str) -> String {
    format!("account-{account_id}")
}

/// The vault key holding just the OAuth app's client id/secret.
fn client_key(account_id: &str) -> String {
    format!("oauth-client-{account_id}")
}

/// What a connected account stores, in the vault.
#[derive(Debug, Serialize, Deserialize)]
struct Account {
    access_token: String,
    refresh_token: Option<String>,
    /// Unix seconds; a refresh happens before this.
    expires_at: u64,
    token_url: String,
    client_id: String,
    client_secret: String,
    /// The profile the provider returned, for the Connections page.
    profile: Value,
}

/// The OAuth app the user registered with the provider.
#[derive(Debug, Serialize, Deserialize)]
struct ClientConfig {
    #[serde(rename = "clientId")]
    client_id: String,
    #[serde(rename = "clientSecret", default)]
    client_secret: String,
}

/// The endpoints and scopes a provider's sign-in needs, passed from the provider registry.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthSpec {
    authorize_url: String,
    token_url: String,
    scopes: Vec<String>,
    /// Provider-specific authorize params, e.g. Google's `access_type=offline`.
    #[serde(default)]
    extra: HashMap<String, String>,
    /// A JSON endpoint answering the signed-in profile, e.g. Google's userinfo.
    profile_url: Option<String>,
}

/// The profile a connected account shows.
#[derive(Debug, Serialize)]
pub struct AccountStatus {
    pub connected: bool,
    /// The provider's own client id, for display. Never the secret.
    #[serde(rename = "clientId")]
    pub client_id: Option<String>,
    pub profile: Option<Value>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Base64 URL-safe, no padding — what PKCE wants.
fn b64url(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((data.len() * 4).div_ceil(3));
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 63) as usize] as char);
        }
    }
    out
}

/// Random bytes, as hex.
fn random_hex(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    let _ = getrandom::getrandom(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Percent-encode a query value.
fn enc(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Block on one callback request, returning `(code, state)`.
fn accept_code(listener: TcpListener) -> Result<(String, String), CommandError> {
    let (mut stream, _) = listener
        .accept()
        .map_err(|e| CommandError::new("oauth", format!("the sign-in callback failed: {e}")))?;
    let mut buffer = [0u8; 4096];
    let read = stream
        .read(&mut buffer)
        .map_err(|e| CommandError::new("oauth", format!("could not read the callback: {e}")))?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("");
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut code = String::new();
    let mut state = String::new();
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        match key {
            "code" => code = value.to_string(),
            "state" => state = value.to_string(),
            _ => {}
        }
    }

    let body = "<!doctype html><meta charset=utf-8><title>openlab</title><body style=\"font:16px -apple-system,system-ui;padding:3rem;text-align:center\">You can close this window and return to openlab.</body>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());

    if code.is_empty() {
        return Err(CommandError::new("oauth", "the sign-in was cancelled"));
    }
    Ok((code, state))
}

/// Everything the exchange needs, pulled out before the blocking wait.
struct Flow {
    redirect_uri: String,
    verifier: String,
    state: String,
}

/// Build the authorize URL and open it.
fn start(
    app: &AppHandle,
    account_id: &str,
    spec: &OAuthSpec,
    client: &ClientConfig,
) -> Result<(TcpListener, Flow), CommandError> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| CommandError::new("oauth", format!("could not open a callback port: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| CommandError::new("oauth", format!("could not read the callback port: {e}")))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let verifier = random_hex(32);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let state = random_hex(16);

    let mut params: Vec<(String, String)> = vec![
        ("client_id".into(), client.client_id.clone()),
        ("redirect_uri".into(), redirect_uri.clone()),
        ("response_type".into(), "code".into()),
        ("scope".into(), spec.scopes.join(" ")),
        ("state".into(), state.clone()),
        ("code_challenge".into(), challenge),
        ("code_challenge_method".into(), "S256".into()),
    ];
    for (key, value) in &spec.extra {
        params.push((key.clone(), value.clone()));
    }
    let query = params
        .iter()
        .map(|(key, value)| format!("{}={}", enc(key), enc(value)))
        .collect::<Vec<_>>()
        .join("&");
    let url = format!("{}?{query}", spec.authorize_url);

    let _ = account_id;
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| CommandError::new("oauth", format!("could not open the browser: {e}")))?;
    Ok((
        listener,
        Flow {
            redirect_uri,
            verifier,
            state,
        },
    ))
}

/// Exchange the code for tokens and store them.
async fn exchange(
    token_url: &str,
    client: &ClientConfig,
    code: &str,
    flow: &Flow,
) -> Result<Value, CommandError> {
    // Defence in depth: the caller validated the URL, but this is where the client secret
    // leaves, so it is checked again here and the client re-checks every redirect hop.
    crate::commands::proxy::check_public_url(token_url)?;
    let client_http = crate::commands::proxy::guarded_client(Duration::from_secs(30))?;
    let response = client_http
        .post(token_url)
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", flow.redirect_uri.as_str()),
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("code_verifier", flow.verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| CommandError::new("oauth", format!("the token exchange failed: {e}")))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(CommandError::new(
            "oauth",
            format!("the provider refused the sign-in ({status})"),
        ));
    }
    serde_json::from_str(&text).map_err(|_| {
        CommandError::new(
            "oauth",
            format!("the provider's token reply was not JSON: {text}"),
        )
    })
}

/// Store the OAuth app's client credentials, so a sign-in and every refresh are self-contained.
#[tauri::command]
pub fn oauth_client_set(
    app: AppHandle,
    account_id: String,
    client_id: String,
    client_secret: String,
) -> Result<(), CommandError> {
    let config = serde_json::to_string(&ClientConfig {
        client_id,
        client_secret,
    })
    .map_err(|e| CommandError::new("oauth", format!("could not encode the client: {e}")))?;
    secrets::write_secret(&app, &client_key(&account_id), &config)
}

/// Read the OAuth app's credentials from the vault.
fn read_client(app: &AppHandle, account_id: &str) -> Result<Option<ClientConfig>, CommandError> {
    let Some(raw) = secrets::read_secret(app, &client_key(account_id))? else {
        return Ok(None);
    };
    Ok(serde_json::from_str(&raw).ok())
}

/// Read the stored account, if any.
fn read_account(app: &AppHandle, account_id: &str) -> Result<Option<Account>, CommandError> {
    let Some(raw) = secrets::read_secret(app, &account_key(account_id))? else {
        return Ok(None);
    };
    Ok(serde_json::from_str(&raw).ok())
}

/// Sign in to an account provider and store the tokens.
#[tauri::command]
pub async fn oauth_connect(
    app: AppHandle,
    account_id: String,
    spec: OAuthSpec,
) -> Result<Value, CommandError> {
    let client = read_client(&app, &account_id)?.ok_or_else(|| {
        CommandError::invalid("Set this provider's OAuth client id and secret first.")
    })?;

    // Every endpoint here receives the client secret or an access token, so each one must be a
    // real public https host before a single request is made. Without this, a spec could point
    // the exchange at a host of its own choosing and be handed the client secret.
    crate::commands::proxy::check_public_url(&spec.authorize_url)?;
    crate::commands::proxy::check_public_url(&spec.token_url)?;
    if let Some(profile_url) = &spec.profile_url {
        crate::commands::proxy::check_public_url(profile_url)?;
    }

    let (listener, flow) = start(&app, &account_id, &spec, &client)?;
    let expected_state = flow.state.clone();
    let (code, state) = tauri::async_runtime::spawn_blocking(move || accept_code(listener))
        .await
        .map_err(|e| CommandError::new("oauth", format!("the sign-in was interrupted: {e}")))??;
    if state != expected_state {
        return Err(CommandError::new(
            "oauth",
            "the sign-in state did not match",
        ));
    }

    let tokens = exchange(&spec.token_url, &client, &code, &flow).await?;
    let access_token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::new("oauth", "the provider returned no access token"))?
        .to_string();
    let refresh_token = tokens
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::to_string);
    let expires_in = tokens
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(3600);

    // The profile is nice-to-have; a failure there is not a failed sign-in.
    let profile = match &spec.profile_url {
        Some(url) => fetch_profile(&access_token, url).await.unwrap_or(json!({})),
        None => json!({}),
    };

    let account = Account {
        access_token,
        refresh_token,
        expires_at: now() + expires_in.saturating_sub(60),
        token_url: spec.token_url.clone(),
        client_id: client.client_id.clone(),
        client_secret: client.client_secret.clone(),
        profile: profile.clone(),
    };
    let raw = serde_json::to_string(&account)
        .map_err(|e| CommandError::new("oauth", format!("could not encode the tokens: {e}")))?;
    secrets::write_secret(&app, &account_key(&account_id), &raw)?;
    Ok(profile)
}

/// Fetch the signed-in profile for display.
async fn fetch_profile(access_token: &str, url: &str) -> Result<Value, CommandError> {
    let url = crate::commands::proxy::check_public_url(url)?;
    let response = crate::commands::proxy::guarded_client(Duration::from_secs(30))?
        .get(url)
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .header("User-Agent", "openlab/1.0")
        .send()
        .await
        .map_err(|e| CommandError::new("oauth", format!("could not read the profile: {e}")))?;
    response
        .json::<Value>()
        .await
        .map_err(|e| CommandError::new("oauth", format!("the profile was not JSON: {e}")))
}

/// Whether an account is connected, and its profile.
#[tauri::command]
pub fn oauth_status(app: AppHandle, account_id: String) -> Result<AccountStatus, CommandError> {
    let client = read_client(&app, &account_id)?;
    let account = read_account(&app, &account_id)?;
    Ok(AccountStatus {
        connected: account.is_some(),
        client_id: client.map(|c| c.client_id),
        profile: account.map(|a| a.profile),
    })
}

/// Forget an account. The OAuth app's credentials are kept, so a re-connect is one click.
#[tauri::command]
pub fn oauth_disconnect(app: AppHandle, account_id: String) -> Result<(), CommandError> {
    secrets::delete_secret(&app, &account_key(&account_id))
}

/// A live access token, refreshing it when it is close to expiring.
pub(crate) async fn access_token(
    app: &AppHandle,
    account_id: &str,
) -> Result<Option<String>, CommandError> {
    let Some(mut account) = read_account(app, account_id)? else {
        return Ok(None);
    };
    if account.expires_at > now() {
        return Ok(Some(account.access_token));
    }
    let Some(refresh) = account.refresh_token.clone() else {
        return Ok(Some(account.access_token));
    };
    // The refresh carries the client secret, so it is checked and does not follow redirects.
    crate::commands::proxy::check_public_url(&account.token_url)?;
    let response = crate::commands::proxy::guarded_client(Duration::from_secs(30))?
        .post(&account.token_url)
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", account.client_id.as_str()),
            ("client_secret", account.client_secret.as_str()),
        ])
        .send()
        .await
        .map_err(|e| CommandError::new("oauth", format!("the token refresh failed: {e}")))?;
    let tokens = response
        .json::<Value>()
        .await
        .map_err(|e| CommandError::new("oauth", format!("the refresh reply was not JSON: {e}")))?;
    if let Some(access) = tokens.get("access_token").and_then(Value::as_str) {
        account.access_token = access.to_string();
        if let Some(refresh) = tokens.get("refresh_token").and_then(Value::as_str) {
            account.refresh_token = Some(refresh.to_string());
        }
        let expires_in = tokens
            .get("expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(3600);
        account.expires_at = now() + expires_in.saturating_sub(60);
        if let Ok(raw) = serde_json::to_string(&account) {
            let _ = secrets::write_secret(app, &account_key(account_id), &raw);
        }
    }
    Ok(Some(account.access_token))
}
