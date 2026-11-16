//! Cloud stores: the Files page's remote side.
//!
//! Two shapes of store, one command surface. A **token** store (Hugging Face, Zenodo, Figshare,
//! OSF, Dataverse, GitHub) is a public REST API reached with a stored credential; an
//! **S3-compatible** store (S3, R2, B2, Wasabi, Spaces, MinIO) is object storage reached with an
//! AWS Signature v4 request. Both keep the credential in the Stronghold vault — the webview
//! never sees it — and both are used *by reference*: the listing is remote, nothing is written to
//! disk until the reader asks for a file.
//!
//! Connector reads are `api_request`; an explicit import is `download_url`; the object store's
//! own two verbs are `s3_list` and `s3_presign`. The same SSRF guard the connector proxy uses
//! applies to every URL that leaves this module.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::commands::secrets;
use crate::error::CommandError;

/// A single imported file may not exceed this.
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;

/// A single uploaded file may not exceed this.
const MAX_UPLOAD: u64 = 512 * 1024 * 1024;

/// How a stored credential is presented to a token store.
#[derive(Debug, Clone, Deserialize)]
pub struct AuthSpec {
    /// `none`, `bearer`, `header` or `query`.
    pub kind: String,
    /// The header or query parameter name for `header`/`query`.
    pub name: Option<String>,
}

/// Resolve a stored credential for one request, or nothing for an open endpoint.
fn credential(app: &AppHandle, provider: &Option<String>) -> Result<Option<String>, CommandError> {
    match provider {
        Some(name) if !name.trim().is_empty() => secrets::read_secret(app, name),
        _ => Ok(None),
    }
}

/// Reject a URL that is not a public http(s) endpoint.
fn check_url(url: &str) -> Result<reqwest::Url, CommandError> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| CommandError::invalid(format!("{url} is not a valid URL: {e}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(CommandError::invalid(
            "only http and https URLs can be fetched",
        ));
    }
    let host = parsed.host_str().unwrap_or_default();
    if crate::commands::proxy::is_internal(host) {
        return Err(CommandError::invalid(format!(
            "{host} is not a public host"
        )));
    }
    Ok(parsed)
}

/// A client with a sane timeout, built once per call. Each redirect hop is re-checked against
/// the internal-host guard, so a checked public URL cannot be bounced inward.
fn client() -> Result<reqwest::Client, CommandError> {
    crate::commands::proxy::guarded_client(Duration::from_secs(60))
}

/// Query pairs and headers, in that order.
type AuthParts = (Vec<(String, String)>, Vec<(String, String)>);

/// Split a credential into the query pairs and the headers a store expects.
fn auth_parts(auth: &Option<AuthSpec>, secret: &Option<String>) -> AuthParts {
    let (Some(auth), Some(secret)) = (auth, secret) else {
        return (Vec::new(), Vec::new());
    };
    match auth.kind.as_str() {
        "bearer" => (
            Vec::new(),
            vec![("Authorization".into(), format!("Bearer {secret}"))],
        ),
        "header" => match &auth.name {
            Some(name) => (Vec::new(), vec![(name.clone(), secret.clone())]),
            None => (Vec::new(), Vec::new()),
        },
        "query" => match &auth.name {
            Some(name) => (vec![(name.clone(), secret.clone())], Vec::new()),
            None => (Vec::new(), Vec::new()),
        },
        _ => (Vec::new(), Vec::new()),
    }
}

/// True when two URLs name the same endpoint: same scheme, same host.
///
/// A credential belongs to one endpoint. The path may differ — a store's listing and its file
/// endpoints live on one host — but the host may not, which is what stops a compromised
/// renderer from forwarding a stored token to somewhere else.
fn same_endpoint(a: &reqwest::Url, b: &reqwest::Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str()
}

/// Refuse a credential-carrying request that is not aimed at its own endpoint.
///
/// `base_url` is the endpoint the connection belongs to. It is required whenever a credential
/// is attached, and the request must match it.
fn check_endpoint(
    parsed: &reqwest::Url,
    base_url: &Option<String>,
    carried: bool,
) -> Result<(), CommandError> {
    if !carried {
        return Ok(());
    }
    let base = base_url.as_deref().ok_or_else(|| {
        CommandError::invalid(
            "a request that carries a credential must name the endpoint it belongs to",
        )
    })?;
    let base = check_url(base)?;
    if !same_endpoint(&base, parsed) {
        return Err(CommandError::invalid(format!(
            "{} is not the endpoint this credential belongs to ({base})",
            parsed.as_str()
        )));
    }
    Ok(())
}

/// One request to a cloud store, with the credential applied and the body returned.
///
/// `base_url` is the endpoint the connection belongs to. It is required whenever a credential
/// is attached, and the request must match it.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn api_request(
    app: AppHandle,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    secret_provider: Option<String>,
    account: Option<String>,
    auth: Option<AuthSpec>,
    base_url: Option<String>,
) -> Result<String, CommandError> {
    let parsed = check_url(&url)?;
    check_endpoint(
        &parsed,
        &base_url,
        secret_provider.is_some() || account.is_some(),
    )?;
    let http_method = method
        .to_uppercase()
        .parse::<reqwest::Method>()
        .map_err(|_| CommandError::invalid(format!("{method} is not a valid HTTP method")))?;

    let secret = credential(&app, &secret_provider)?;
    let (query, mut auth_headers) = auth_parts(&auth, &secret);
    if let Some(account) = &account {
        if let Some(token) = crate::commands::oauth::access_token(&app, account).await? {
            auth_headers.push(("Authorization".into(), format!("Bearer {token}")));
        }
    }
    let mut parsed = parsed;
    if !query.is_empty() {
        let mut pairs = parsed.query_pairs_mut();
        for (name, value) in &query {
            pairs.append_pair(name, value);
        }
    }

    let mut request = client()?.request(http_method, parsed);
    for (name, value) in &headers {
        request = request.header(name.as_str(), value.as_str());
    }
    for (name, value) in &auth_headers {
        request = request.header(name.as_str(), value.as_str());
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|e| CommandError::new("network", format!("could not reach {url}: {e}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| CommandError::new("network", format!("could not read the response: {e}")))?;
    if !status.is_success() {
        let detail = if text.is_empty() {
            String::new()
        } else {
            format!(
                ": {}",
                crate::commands::proxy::cap(text)
                    .chars()
                    .take(400)
                    .collect::<String>()
            )
        };
        return Err(CommandError::new(
            "network",
            format!("the store answered {status}{detail}"),
        ));
    }
    Ok(crate::commands::proxy::cap(text))
}

/// A path inside the workspace, refusing anything that would escape it.
///
/// The lexical check is not enough on its own: a symlink inside the workspace can point
/// outside it, and on Windows a `C:\…` destination is absolute even though it does not start
/// with `/`. So the deepest existing ancestor is canonicalised and must still be under the
/// root before anything is read or written.
fn safe_dest(root: &str, dest: &str) -> Result<PathBuf, CommandError> {
    if dest.starts_with('/') || dest.split(['/', '\\']).any(|part| part == "..") {
        return Err(CommandError::invalid(
            "the destination must stay inside the workspace",
        ));
    }
    let root = std::fs::canonicalize(root)
        .map_err(|e| CommandError::io(format!("could not open the workspace {root}: {e}")))?;
    let target = root.join(dest);
    if !target.starts_with(&root) {
        return Err(CommandError::invalid(
            "the destination must stay inside the workspace",
        ));
    }
    // The target may not exist yet; the nearest existing ancestor is what a symlink would
    // have to pass through, so it is the one worth resolving.
    let mut existing = target.as_path();
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| CommandError::invalid("the destination is outside the workspace"))?;
    }
    let resolved = std::fs::canonicalize(existing)
        .map_err(|e| CommandError::io(format!("could not open {}: {e}", existing.display())))?;
    if !resolved.starts_with(&root) {
        return Err(CommandError::invalid(
            "the destination must stay inside the workspace",
        ));
    }
    Ok(target)
}

/// Import one file into the workspace by reference — fetched only when the reader asks.
#[tauri::command]
pub async fn download_url(
    app: AppHandle,
    url: String,
    dest: String,
    root: String,
    secret_provider: Option<String>,
    account: Option<String>,
    auth: Option<AuthSpec>,
) -> Result<u64, CommandError> {
    use futures_util::StreamExt;

    let parsed = check_url(&url)?;
    let target = safe_dest(&root, &dest)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| CommandError::io(format!("could not create {}: {e}", parent.display())))?;
    }

    let secret = credential(&app, &secret_provider)?;
    let (query, mut auth_headers) = auth_parts(&auth, &secret);
    if let Some(account) = &account {
        if let Some(token) = crate::commands::oauth::access_token(&app, account).await? {
            auth_headers.push(("Authorization".into(), format!("Bearer {token}")));
        }
    }
    let mut parsed = parsed;
    if !query.is_empty() {
        let mut pairs = parsed.query_pairs_mut();
        for (name, value) in &query {
            pairs.append_pair(name, value);
        }
    }

    let mut request = client()?.get(parsed);
    for (name, value) in &auth_headers {
        request = request.header(name.as_str(), value.as_str());
    }
    request = request.header("User-Agent", "openlab/1.0 (research workbench)");

    let response = request
        .send()
        .await
        .map_err(|e| CommandError::new("network", format!("could not reach {url}: {e}")))?;
    let status = response.status();
    if !status.is_success() {
        return Err(CommandError::new(
            "network",
            format!("the store answered {status}"),
        ));
    }
    if let Some(length) = response.content_length() {
        if length > MAX_DOWNLOAD {
            return Err(CommandError::invalid("that file is too large to import"));
        }
    }

    let mut file = std::fs::File::create(&target)
        .map_err(|e| CommandError::io(format!("could not write {}: {e}", target.display())))?;
    let mut written = 0u64;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| CommandError::new("network", format!("the download failed: {e}")))?;
        written += chunk.len() as u64;
        if written > MAX_DOWNLOAD {
            return Err(CommandError::invalid("that file is too large to import"));
        }
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| CommandError::io(format!("could not write {}: {e}", target.display())))?;
    }
    Ok(written)
}

/// A multipart/related body: a JSON part naming the file, then its bytes as the media part.
fn multipart_related(boundary: &str, metadata: &str, mime: &str, bytes: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(bytes.len() + metadata.len() + 256);
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

/// Upload one workspace file to a cloud store — the write side of an import.
///
/// The bytes are read here, never in the webview, and the same credential and endpoint rules
/// apply as for a download. `metadata` asks for a multipart/related body: a JSON part naming
/// the file, then the media part. Without it the file itself is the body, which is how an
/// existing file's content is replaced.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn upload_file(
    app: AppHandle,
    url: String,
    method: String,
    path: String,
    root: String,
    mime: Option<String>,
    metadata: Option<String>,
    secret_provider: Option<String>,
    account: Option<String>,
    auth: Option<AuthSpec>,
    base_url: Option<String>,
) -> Result<String, CommandError> {
    let parsed = check_url(&url)?;
    check_endpoint(
        &parsed,
        &base_url,
        secret_provider.is_some() || account.is_some(),
    )?;
    let http_method = method
        .to_uppercase()
        .parse::<reqwest::Method>()
        .map_err(|_| CommandError::invalid(format!("{method} is not a valid HTTP method")))?;

    // The same guard as a download's destination, for a path that is read instead of written.
    let source = safe_dest(&root, &path)?;
    let length = std::fs::metadata(&source)
        .map_err(|e| CommandError::io(format!("could not read {}: {e}", source.display())))?
        .len();
    if length > MAX_UPLOAD {
        return Err(CommandError::invalid("that file is too large to upload"));
    }
    let bytes = std::fs::read(&source)
        .map_err(|e| CommandError::io(format!("could not read {}: {e}", source.display())))?;
    let mime = mime.unwrap_or_else(|| "application/octet-stream".into());

    let secret = credential(&app, &secret_provider)?;
    let (query, mut auth_headers) = auth_parts(&auth, &secret);
    if let Some(account) = &account {
        if let Some(token) = crate::commands::oauth::access_token(&app, account).await? {
            auth_headers.push(("Authorization".into(), format!("Bearer {token}")));
        }
    }
    let mut parsed = parsed;
    if !query.is_empty() {
        let mut pairs = parsed.query_pairs_mut();
        for (name, value) in &query {
            pairs.append_pair(name, value);
        }
    }

    let mut request = client()?.request(http_method, parsed);
    for (name, value) in &auth_headers {
        request = request.header(name.as_str(), value.as_str());
    }
    request = request.header("User-Agent", "openlab/1.0 (research workbench)");

    request = match metadata {
        Some(metadata) => {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let boundary = format!("openlab-{nanos:x}");
            request
                .header(
                    "Content-Type",
                    format!("multipart/related; boundary={boundary}"),
                )
                .body(multipart_related(&boundary, &metadata, &mime, &bytes))
        }
        None => request.header("Content-Type", mime).body(bytes),
    };

    let response = request
        .send()
        .await
        .map_err(|e| CommandError::new("network", format!("could not reach {url}: {e}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| CommandError::new("network", format!("could not read the response: {e}")))?;
    if !status.is_success() {
        let detail = if text.is_empty() {
            String::new()
        } else {
            format!(
                ": {}",
                crate::commands::proxy::cap(text)
                    .chars()
                    .take(400)
                    .collect::<String>()
            )
        };
        return Err(CommandError::new(
            "network",
            format!("the store answered {status}{detail}"),
        ));
    }
    Ok(crate::commands::proxy::cap(text))
}

/* ================================================================================================
 * S3-compatible stores — AWS Signature v4
 * ============================================================================================== */

/// The credential an S3 store keeps in the vault, as one JSON blob.
#[derive(Debug, Deserialize)]
struct S3Credential {
    #[serde(rename = "accessKeyId", alias = "access_key_id")]
    access_key_id: String,
    #[serde(rename = "secretAccessKey", alias = "secret_access_key")]
    secret_access_key: String,
}

/// One object in a listing.
#[derive(Debug, Serialize)]
pub struct S3Object {
    pub key: String,
    pub size: u64,
    pub modified: Option<String>,
}

/// One page of a listing.
#[derive(Debug, Serialize)]
pub struct S3Listing {
    pub objects: Vec<S3Object>,
    /// Folder-like prefixes, when the caller asked for one level at a time.
    pub prefixes: Vec<String>,
    pub truncated: bool,
    pub next: Option<String>,
}

/// Lowercase hex.
fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// SHA-256 of a value, hex.
fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex(&hasher.finalize())
}

/// HMAC-SHA256, over `sha2` rather than a second dependency.
fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut key_block = [0u8; BLOCK];
    if key.len() > BLOCK {
        let mut hasher = Sha256::new();
        hasher.update(key);
        key_block[..32].copy_from_slice(&hasher.finalize());
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; BLOCK];
    let mut opad = [0x5cu8; BLOCK];
    for index in 0..BLOCK {
        ipad[index] ^= key_block[index];
        opad[index] ^= key_block[index];
    }
    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(data);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner);
    let mut out = [0u8; 32];
    out.copy_from_slice(&outer.finalize());
    out
}

/// Percent-encode per the AWS rules; `/` is only kept where the path allows it.
fn uri_encode(value: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b'/' if !encode_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// The canonical query string: sorted by key, then value, each encoded.
fn canonical_query(pairs: &[(String, String)]) -> String {
    let mut sorted: Vec<(String, String)> = pairs
        .iter()
        .map(|(key, value)| (uri_encode(key, true), uri_encode(value, true)))
        .collect();
    sorted.sort();
    sorted
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

/// `now` as `(YYYYMMDDTHHMMSSZ, YYYYMMDD)`, without a date dependency.
fn amz_now() -> (String, String) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    let stamp = format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    );
    (stamp, format!("{year:04}{month:02}{day:02}"))
}

/// Days since the epoch to a civil date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// The signed pieces for one S3 request.
struct Signed {
    /// Headers to send, including `Authorization`.
    headers: Vec<(String, String)>,
    /// The full URL, with any signing query the caller asked to embed.
    url: String,
}

/// Sign a request for `service` (always `s3` here) with SigV4.
#[allow(clippy::too_many_arguments)]
fn sign_v4(
    method: &str,
    host: &str,
    path: &str,
    query: &[(String, String)],
    region: &str,
    access_key_id: &str,
    secret_access_key: &str,
    payload_hash: &str,
    presign_secs: Option<u64>,
) -> Signed {
    let (amz_date, date) = amz_now();
    let scope = format!("{date}/{region}/s3/aws4_request");

    let mut base_headers: Vec<(String, String)> = vec![
        ("host".into(), host.into()),
        ("x-amz-content-sha256".into(), payload_hash.into()),
        ("x-amz-date".into(), amz_date.clone()),
    ];

    if let Some(expires) = presign_secs {
        // A presigned GET carries the signature in the query, not a header.
        let mut params = query.to_vec();
        params.push(("X-Amz-Algorithm".into(), "AWS4-HMAC-SHA256".into()));
        params.push((
            "X-Amz-Credential".into(),
            format!("{access_key_id}/{scope}"),
        ));
        params.push(("X-Amz-Date".into(), amz_date.clone()));
        params.push(("X-Amz-Expires".into(), expires.to_string()));
        params.push(("X-Amz-SignedHeaders".into(), "host".into()));
        let canonical = canonical_query(&params);
        let canonical_request = format!(
            "{method}\n{}\n{canonical}\nhost:{host}\n\nhost\n{payload_hash}",
            uri_encode(path, false)
        );
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
            sha256_hex(canonical_request.as_bytes())
        );
        let signing_key = signing_key(secret_access_key, &date, region);
        let signature = hex(&hmac_sha256(&signing_key, string_to_sign.as_bytes()));
        let url = format!("https://{host}{path}?{canonical}&X-Amz-Signature={signature}");
        return Signed {
            headers: Vec::new(),
            url,
        };
    }

    base_headers.sort();
    let signed_headers = base_headers
        .iter()
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_headers = base_headers
        .iter()
        .map(|(name, value)| format!("{name}:{}\n", value.trim()))
        .collect::<String>();
    let canonical_request = format!(
        "{method}\n{}\n{}\n{canonical_headers}\n{signed_headers}\n{payload_hash}",
        uri_encode(path, false),
        canonical_query(query)
    );
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );
    let signing_key = signing_key(secret_access_key, &date, region);
    let signature = hex(&hmac_sha256(&signing_key, string_to_sign.as_bytes()));
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );
    base_headers.push(("authorization".into(), authorization));

    let query_string = canonical_query(query);
    let url = if query_string.is_empty() {
        format!("https://{host}{path}")
    } else {
        format!("https://{host}{path}?{query_string}")
    };
    Signed {
        headers: base_headers,
        url,
    }
}

/// The SigV4 date/region/service key chain.
fn signing_key(secret: &str, date: &str, region: &str) -> [u8; 32] {
    let k_date = hmac_sha256(format!("AWS4{secret}").as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, b"s3");
    hmac_sha256(&k_service, b"aws4_request")
}

/// A parsed endpoint: host and whether it already carries a path.
fn endpoint_parts(endpoint: &str) -> Result<(String, String), CommandError> {
    let url = reqwest::Url::parse(endpoint)
        .map_err(|e| CommandError::invalid(format!("{endpoint} is not a valid endpoint: {e}")))?;
    if url.scheme() != "https" {
        return Err(CommandError::invalid("the endpoint must be https"));
    }
    let host = url.host_str().unwrap_or_default().to_string();
    if crate::commands::proxy::is_internal(&host) {
        return Err(CommandError::invalid(format!(
            "{host} is not a public host"
        )));
    }
    let mut base = url.path().trim_end_matches('/').to_string();
    if base.is_empty() {
        base = String::new();
    }
    if let Some(port) = url.port() {
        return Ok((format!("{host}:{port}"), base));
    }
    Ok((host, base))
}

/// Read and parse the S3 credential from the vault.
fn s3_credential(app: &AppHandle, provider: &str) -> Result<S3Credential, CommandError> {
    let raw = secrets::read_secret(app, provider)?
        .ok_or_else(|| CommandError::invalid("this store has no credential yet"))?;
    serde_json::from_str(&raw)
        .map_err(|_| CommandError::invalid("the stored credential is not a valid access key pair"))
}

/// The objects under a prefix, one page at a time.
///
/// A `delimiter` makes the listing hierarchical: the store answers the objects at this level
/// and rolls the rest up into common prefixes, which is what lets a bucket be browsed like a
/// folder tree instead of one flat list.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn s3_list(
    app: AppHandle,
    secret_provider: String,
    endpoint: String,
    region: String,
    bucket: String,
    prefix: Option<String>,
    continuation_token: Option<String>,
    delimiter: Option<String>,
) -> Result<S3Listing, CommandError> {
    let (host, base) = endpoint_parts(&endpoint)?;
    let cred = s3_credential(&app, &secret_provider)?;
    let path = format!("{base}/{bucket}");

    let mut query: Vec<(String, String)> = vec![("list-type".into(), "2".into())];
    if let Some(prefix) = &prefix {
        if !prefix.is_empty() {
            query.push(("prefix".into(), prefix.clone()));
        }
    }
    if let Some(delimiter) = &delimiter {
        if !delimiter.is_empty() {
            query.push(("delimiter".into(), delimiter.clone()));
        }
    }
    if let Some(token) = &continuation_token {
        if !token.is_empty() {
            query.push(("continuation-token".into(), token.clone()));
        }
    }

    let empty_hash = sha256_hex(b"");
    let signed = sign_v4(
        "GET",
        &host,
        &path,
        &query,
        &region,
        &cred.access_key_id,
        &cred.secret_access_key,
        &empty_hash,
        None,
    );

    let mut request = client()?.get(&signed.url);
    for (name, value) in &signed.headers {
        request = request.header(name.as_str(), value.as_str());
    }
    let response = request
        .send()
        .await
        .map_err(|e| CommandError::new("network", format!("could not reach {host}: {e}")))?;
    let status = response.status();
    let xml = response
        .text()
        .await
        .map_err(|e| CommandError::new("network", format!("could not read the listing: {e}")))?;
    if !status.is_success() {
        return Err(CommandError::new(
            "network",
            format!(
                "{} answered {status}",
                if host.is_empty() { "the store" } else { &host }
            ),
        ));
    }
    Ok(parse_listing(&xml))
}

/// Pull the objects out of a ListObjectsV2 response, which is flat and stable.
fn parse_listing(xml: &str) -> S3Listing {
    let contents = xml.split("<Contents>").skip(1);
    let tag = |block: &str, name: &str| -> Option<String> {
        let open = format!("<{name}>");
        let close = format!("</{name}>");
        let start = block.find(&open)? + open.len();
        let end = block[start..].find(&close)? + start;
        Some(block[start..end].trim().to_string())
    };
    let objects = contents
        .map(|block| S3Object {
            key: tag(block, "Key").unwrap_or_default(),
            size: tag(block, "Size").and_then(|v| v.parse().ok()).unwrap_or(0),
            modified: tag(block, "LastModified"),
        })
        .filter(|object| !object.key.is_empty() && !object.key.ends_with('/'))
        .collect();
    let prefixes = xml
        .split("<CommonPrefixes>")
        .skip(1)
        .filter_map(|block| tag(block, "Prefix"))
        .filter(|prefix| !prefix.is_empty())
        .collect();
    let truncated = xml.contains("<IsTruncated>true</IsTruncated>");
    S3Listing {
        objects,
        prefixes,
        truncated,
        next: tag(xml, "NextContinuationToken"),
    }
}

/// A time-limited URL for one object, so the OS or a browser can open it without a credential.
#[tauri::command]
pub async fn s3_presign(
    app: AppHandle,
    secret_provider: String,
    endpoint: String,
    region: String,
    bucket: String,
    key: String,
    expires: Option<u64>,
) -> Result<String, CommandError> {
    // Signing reads the credential from the vault, so it runs off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        s3_presign_blocking(
            &app,
            secret_provider,
            endpoint,
            region,
            bucket,
            key,
            expires,
        )
    })
    .await
    .map_err(|e| CommandError::new("cloud", format!("the presign task failed: {e}")))?
}

/// The blocking half of {@link s3_presign}, kept off the main thread.
fn s3_presign_blocking(
    app: &AppHandle,
    secret_provider: String,
    endpoint: String,
    region: String,
    bucket: String,
    key: String,
    expires: Option<u64>,
) -> Result<String, CommandError> {
    let (host, base) = endpoint_parts(&endpoint)?;
    let cred = s3_credential(app, &secret_provider)?;
    let path = format!("{base}/{bucket}/{}", uri_encode(&key, false));
    let signed = sign_v4(
        "GET",
        &host,
        &path,
        &[],
        &region,
        &cred.access_key_id,
        &cred.secret_access_key,
        &sha256_hex(b""),
        Some(expires.unwrap_or(3600)),
    );
    Ok(signed.url)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One multipart body, assembled the way Drive's create form expects it: a JSON part, then
    /// the bytes, then the closing boundary — with the file's own bytes untouched.
    #[test]
    fn a_multipart_upload_keeps_its_two_parts_apart() {
        let body = multipart_related("edge", r#"{"name":"raw.csv"}"#, "text/csv", b"a,b\n1,2\n");
        let text = String::from_utf8(body).expect("the fixture is utf8");

        assert!(text.starts_with("--edge\r\nContent-Type: application/json"));
        assert!(text.contains("{\"name\":\"raw.csv\"}"));
        assert!(text.contains("\r\n--edge\r\nContent-Type: text/csv\r\n\r\na,b\n1,2\n"));
        assert!(text.ends_with("\r\n--edge--\r\n"));
    }

    /// The destination guard is the same one both directions use: nothing leaves the workspace.
    #[test]
    fn a_path_that_escapes_the_workspace_is_refused() {
        let root = std::env::temp_dir().join(format!("openlab-safe-dest-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("a temp workspace");
        let root = root.to_str().expect("utf8 path");

        assert!(safe_dest(root, "data/raw.csv").is_ok());
        assert!(safe_dest(root, "../secrets").is_err());
        assert!(safe_dest(root, "/etc/passwd").is_err());

        // A link inside the workspace is still a way out of it.
        #[cfg(unix)]
        {
            let outside =
                std::env::temp_dir().join(format!("openlab-safe-outside-{}", std::process::id()));
            std::fs::create_dir_all(&outside).expect("a temp directory");
            std::os::unix::fs::symlink(&outside, PathBuf::from(root).join("link"))
                .expect("a symlink");
            assert!(safe_dest(root, "link/raw.csv").is_err());
            let _ = std::fs::remove_dir_all(&outside);
        }

        let _ = std::fs::remove_dir_all(root);
    }
}
