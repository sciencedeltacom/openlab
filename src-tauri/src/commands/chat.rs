//! Talking to a model provider.
//!
//! The webview cannot call a provider directly: a browser blocks the cross-origin request
//! unless the provider opts in with CORS headers, and most do not. So the request is made
//! here and the response is streamed back as events.
//!
//! **The API key never crosses the IPC boundary.** The UI says *how* to authenticate — a
//! bearer token, a named header, a query parameter — and this side reads the secret out of
//! the operating system's credential store and applies it. A key that reaches the webview is
//! a key any script in the webview can read, which is a worse trade than the round trip.
//!
//! The stream is forwarded line by line rather than parsed. Server-sent events are a
//! transport, and every provider shapes its payloads differently; splitting the frames here
//! and interpreting them in TypeScript keeps the protocol knowledge in one place.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::Url;
use rusqlite::{Connection as Sqlite, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

use crate::commands::{proxy, secrets};
use crate::error::CommandError;

/// Which requests the user has stopped.
///
/// Kept in managed state rather than in the stream task, because the task is parked on
/// `await` and cannot be reached from another command. The `Notify` is what reaches it: a
/// flag alone is only read between chunks, so a provider that accepted the connection and
/// went silent would keep the turn parked despite Stop.
#[derive(Clone, Default)]
pub struct ChatCancellations {
    cancelled: Arc<Mutex<HashSet<String>>>,
    wake: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
}

impl ChatCancellations {
    fn register(&self, id: &str) -> Arc<Notify> {
        let notify = Arc::new(Notify::new());
        if let Ok(mut wake) = self.wake.lock() {
            wake.insert(id.to_string(), notify.clone());
        }
        notify
    }

    fn unregister(&self, id: &str) {
        if let Ok(mut wake) = self.wake.lock() {
            wake.remove(id);
        }
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.remove(id);
        }
    }

    fn cancel(&self, id: &str) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.insert(id.to_string());
        }
        // Wake the stream if it is parked on a request or a read. `notify_one` stores a
        // permit, so a cancel that arrives a moment before the select registers is not lost.
        if let Ok(wake) = self.wake.lock() {
            if let Some(notify) = wake.get(id) {
                notify.notify_one();
            }
        }
    }

    fn is_cancelled(&self, id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|set| set.contains(id))
            .unwrap_or(false)
    }
}

/// How to present the credential to this provider.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Auth {
    /// No credential; a local server on the user's own machine.
    None,
    /// `Authorization: Bearer <key>`.
    Bearer,
    /// A provider-specific header, e.g. Anthropic's `x-api-key`.
    Header { name: String },
    /// A query parameter, e.g. Google's `?key=`.
    Query { name: String },
}

/// One streaming completion request, already shaped by the UI for its protocol.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamRequest {
    /// Correlates the events back to one turn. The UI may have several in flight.
    pub id: String,
    /// Keyring entry to read the credential from.
    pub provider: String,
    /// Fully-built endpoint.
    pub url: String,
    /// Serialised request body.
    pub body: String,
    /// Extra headers the protocol needs.
    pub headers: Vec<(String, String)>,
    pub auth: Auth,
}

/// One line of the response stream.
#[derive(Debug, Clone, Serialize)]
struct ChunkEvent {
    id: String,
    line: String,
}

/// The stream finished cleanly.
#[derive(Debug, Clone, Serialize)]
struct EndEvent {
    id: String,
}

/// The stream stopped because something went wrong.
#[derive(Debug, Clone, Serialize)]
struct ErrorEvent {
    id: String,
    message: String,
}

/// Append a query parameter, respecting any that are already present.
fn with_query(url: &str, name: &str, value: &str) -> String {
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{url}{separator}{name}={}", urlencoding(value))
}

/// Percent-encode a value for a query string.
///
/// Hand-rolled rather than pulling a crate: the only values that ever pass through here are
/// a fixed parameter name and an API key, and the set of characters that must be escaped is
/// small and well defined.
fn urlencoding(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
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

/// The base URL a provider was saved with.
///
/// The request URL comes from the webview, so it cannot be trusted on its own. Reading the
/// configured endpoint from the same database the UI writes lets `chat_stream` refuse to
/// attach a stored key to any other origin — a renderer that has been compromised can ask
/// for the key, but not send it somewhere new.
fn configured_base_url(app: &AppHandle, provider: &str) -> Option<String> {
    let path = app
        .path()
        .app_data_dir()
        .ok()?
        .join(crate::commands::db::DB_FILE);
    if !path.exists() {
        return None;
    }
    let connection = Sqlite::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let base: Option<String> = connection
        .query_row(
            "SELECT defaultBaseUrl FROM providers WHERE id = ?1",
            [provider],
            |row| row.get(0),
        )
        .ok()?;
    base.filter(|value| !value.trim().is_empty())
}

/// True when two URLs share scheme, host and port.
fn same_origin(left: &Url, right: &Url) -> bool {
    left.origin() == right.origin()
}

/// Refuse a request that is not the endpoint the provider was configured with.
fn check_endpoint(app: &AppHandle, request: &ChatStreamRequest) -> Result<(), CommandError> {
    let target = Url::parse(&request.url)
        .map_err(|e| CommandError::invalid(format!("{} is not a valid URL: {e}", request.url)))?;
    if !matches!(target.scheme(), "http" | "https") {
        return Err(CommandError::invalid(
            "only http and https URLs can be called",
        ));
    }
    match configured_base_url(app, &request.provider) {
        Some(base) => {
            let configured = Url::parse(&base).map_err(|_| {
                CommandError::invalid(format!(
                    "the stored endpoint for {} is not a valid URL",
                    request.provider
                ))
            })?;
            if !same_origin(&target, &configured) {
                return Err(CommandError::invalid(format!(
                    "{} is not the endpoint configured for {}. Update the provider's base URL and save its key again.",
                    target.origin().ascii_serialization(),
                    request.provider
                )));
            }
            Ok(())
        }
        // No saved endpoint to compare against (an older key, or a provider this build does
        // not know): fall back to the public-host guard rather than sending a key inward.
        None => proxy::check_public_url(&request.url).map(|_| ()),
    }
}

/// Read the credential and return the URL and headers to use.
fn authorize(
    app: &AppHandle,
    request: &ChatStreamRequest,
) -> Result<(String, HeaderMap), CommandError> {
    let mut url = request.url.clone();
    let mut headers = HeaderMap::new();

    if matches!(request.auth, Auth::None) {
        return Ok((url, headers));
    }

    let key = secrets::read_secret(app, &request.provider)?.ok_or_else(|| {
        CommandError::invalid(format!(
            "no credential is stored for {}. Add one in Settings → Providers.",
            request.provider
        ))
    })?;

    match &request.auth {
        Auth::None => {}
        Auth::Bearer => {
            let value = HeaderValue::from_str(&format!("Bearer {key}")).map_err(|_| {
                CommandError::invalid("the stored credential is not a valid header value")
            })?;
            headers.insert(AUTHORIZATION, value);
        }
        Auth::Header { name } => {
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| CommandError::invalid("that header name is not valid"))?;
            let value = HeaderValue::from_str(&key).map_err(|_| {
                CommandError::invalid("the stored credential is not a valid header value")
            })?;
            headers.insert(name, value);
        }
        Auth::Query { name } => {
            url = with_query(&url, name, &key);
        }
    }

    Ok((url, headers))
}

/// Stream a response body, one whole line at a time.
///
/// Separated from the command on purpose. The transport is the part that breaks — a split
/// frame, a provider that answers 401 with an explanation, a socket that dies mid-answer —
/// and none of that needs a Tauri runtime to exercise. The command supplies a closure that
/// emits; a test supplies one that collects.
///
/// Returns `Err` when the provider refused the request, carrying the provider's own message
/// where there is one, because that is the part a user can act on.
pub async fn stream_lines<F>(
    url: &str,
    headers: HeaderMap,
    body: &str,
    is_cancelled: impl Fn() -> bool,
    wake: Arc<Notify>,
    mut on_line: F,
) -> Result<(), CommandError>
where
    F: FnMut(String) + Send,
{
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        // A provider that accepted the connection and then went silent must not park the
        // turn forever; the UI's Stop cannot reach an `await` that never wakes.
        .read_timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| {
            CommandError::new("network", format!("could not start an HTTP client: {e}"))
        })?;

    let response = tokio::select! {
        _ = wake.notified() => return Ok(()),
        response = client
            .post(url)
            .headers(headers)
            .body(body.to_string())
            .send() => response
            .map_err(|e| CommandError::new("network", format!("could not reach the provider: {e}")))?,
    };

    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        let detail = detail.trim();
        return Err(CommandError::new(
            "provider",
            if detail.is_empty() {
                format!("the provider answered {status}")
            } else {
                format!("the provider answered {status}: {}", truncate(detail, 600))
            },
        ));
    }

    if is_cancelled() {
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    loop {
        if is_cancelled() {
            break;
        }
        let next = tokio::select! {
            _ = wake.notified() => break,
            next = stream.next() => next,
        };
        let Some(chunk) = next else { break };
        match chunk {
            Ok(bytes) => {
                buffer.push_str(&String::from_utf8_lossy(&bytes));
                // Frames arrive on line boundaries, but a network chunk can split one, so
                // only whole lines are forwarded and the remainder stays buffered.
                while let Some(index) = buffer.find('\n') {
                    let line = buffer[..index].trim_end_matches('\r').to_string();
                    buffer.drain(..=index);
                    on_line(line);
                }
            }
            Err(error) => {
                return Err(CommandError::new(
                    "network",
                    format!("the response stream broke: {error}"),
                ));
            }
        }
    }

    if !buffer.trim().is_empty() {
        on_line(buffer.trim_end_matches('\r').to_string());
    }

    Ok(())
}

/// Stream a completion from a provider.
///
/// Resolves when the stream ends. Progress arrives as `chat://chunk`, and the end as
/// `chat://end` or `chat://error` — the caller listens for those rather than reading the
/// return value, because a turn is long and the UI must render while it runs.
#[tauri::command]
pub async fn chat_stream(app: AppHandle, request: ChatStreamRequest) -> Result<(), CommandError> {
    check_endpoint(&app, &request)?;
    let id = request.id.clone();
    let (url, mut headers) = authorize(&app, &request)?;

    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
    for (name, value) in &request.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| CommandError::invalid(format!("{name} is not a valid header name")))?;
        let value = HeaderValue::from_str(value)
            .map_err(|_| CommandError::invalid(format!("{name} has an invalid value")))?;
        headers.insert(name, value);
    }

    let cancellations = app.state::<ChatCancellations>().inner().clone();
    let wake = cancellations.register(&id);
    let switch = cancellations.clone();
    let mut failure: Option<String> = None;

    let outcome = {
        let app = app.clone();
        let id = id.clone();
        let event_id = id.clone();
        let emit = move |line: String| {
            let _ = app.emit(
                "chat://chunk",
                ChunkEvent {
                    id: event_id.clone(),
                    line,
                },
            );
        };
        let check = {
            let switch = switch.clone();
            let id = id.clone();
            move || switch.is_cancelled(&id)
        };
        stream_lines(&url, headers, &request.body, check, wake, emit).await
    };

    if let Err(error) = outcome {
        failure = Some(error.message.clone());
        let _ = app.emit(
            "chat://error",
            ErrorEvent {
                id: id.clone(),
                message: error.message,
            },
        );
    }

    if failure.is_none() {
        let _ = app.emit("chat://end", EndEvent { id: id.clone() });
    }

    cancellations.unregister(&id);
    Ok(())
}

/// Stop a stream that is in flight.
#[tauri::command]
pub fn chat_cancel(app: AppHandle, id: String) -> Result<(), CommandError> {
    app.state::<ChatCancellations>().cancel(&id);
    Ok(())
}

/// Keep a provider's error message readable in a toast without flooding it.
fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut out: String = text.chars().take(limit).collect();
    out.push('…');
    out
}

/// Confirm the module is wired, without pulling in the whole crate in a test.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_parameters_respect_existing_ones() {
        assert_eq!(
            with_query("https://x/v1", "key", "abc"),
            "https://x/v1?key=abc"
        );
        assert_eq!(
            with_query("https://x/v1?alt=sse", "key", "abc"),
            "https://x/v1?alt=sse&key=abc"
        );
    }

    #[test]
    fn keys_are_percent_encoded() {
        assert_eq!(urlencoding("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(urlencoding("a/b+c="), "a%2Fb%2Bc%3D");
    }

    /// A provider that accepts the connection and never writes would park `send()` forever;
    /// Stop has to reach that await, not only the loop between chunks.
    #[tokio::test]
    async fn a_cancel_wakes_a_silent_provider() {
        use std::io::Read;

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        std::thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let mut buffer = [0u8; 1024];
                let _ = socket.read(&mut buffer);
                std::thread::sleep(Duration::from_secs(5));
            }
        });

        let wake = Arc::new(Notify::new());
        let signal = wake.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            signal.notify_one();
        });

        let outcome = tokio::time::timeout(
            Duration::from_secs(2),
            stream_lines(
                &format!("http://127.0.0.1:{port}/chat/completions"),
                HeaderMap::new(),
                "{}",
                || false,
                wake,
                |_| {},
            ),
        )
        .await
        .expect("the cancel must wake the stream");
        assert!(outcome.is_ok());
    }

    #[test]
    fn long_errors_are_trimmed() {
        assert_eq!(truncate("short", 10), "short");
        assert_eq!(truncate("abcdefghijkl", 5), "abcde…");
    }

    #[test]
    fn an_endpoint_must_share_the_configured_origin() {
        let configured = Url::parse("https://api.example.edu/v1").expect("url");
        assert!(same_origin(
            &Url::parse("https://api.example.edu/v1/chat/completions").expect("url"),
            &configured
        ));
        assert!(!same_origin(
            &Url::parse("https://evil.example.edu/v1/chat/completions").expect("url"),
            &configured
        ));
        // A sibling host that merely shares a suffix is not the same origin.
        assert!(!same_origin(
            &Url::parse("https://api.example.edu.evil.test/v1").expect("url"),
            &configured
        ));
        // Same host, different port or scheme, is a different origin.
        assert!(!same_origin(
            &Url::parse("http://api.example.edu/v1").expect("url"),
            &configured
        ));
        assert!(!same_origin(
            &Url::parse("https://api.example.edu:8443/v1").expect("url"),
            &configured
        ));
    }

    /// Serve one canned HTTP response and return the port it is listening on.
    ///
    /// A real socket rather than a mocked client: the thing under test is how bytes arriving
    /// in arbitrary chunks become whole lines, and a mock would hand over the answer already
    /// split the way the code hopes for.
    fn serve(response: &'static str) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        std::thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                // Drain the request so the client is not blocked writing it.
                let mut scratch = [0u8; 4096];
                let _ = socket.read(&mut scratch);
                let _ = socket.write_all(response.as_bytes());
                let _ = socket.flush();
            }
        });
        port
    }

    #[tokio::test]
    async fn frames_split_across_packets_become_whole_lines() {
        // Deliberately broken mid-frame: the first line is cut in half by the TCP boundary.
        let body = "data: {\"a\":1}\ndata: {\"b\":2}\ndata: [DONE]\n";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let port = serve(Box::leak(response.into_boxed_str()));

        let mut lines: Vec<String> = Vec::new();
        let outcome = stream_lines(
            &format!("http://127.0.0.1:{port}/chat/completions"),
            HeaderMap::new(),
            "{}",
            || false,
            Arc::new(Notify::new()),
            |line| lines.push(line),
        )
        .await;

        assert!(outcome.is_ok(), "transport failed: {outcome:?}");
        assert_eq!(
            lines,
            vec!["data: {\"a\":1}", "data: {\"b\":2}", "data: [DONE]"]
        );
    }

    #[tokio::test]
    async fn a_provider_error_carries_its_own_explanation() {
        let body = "{\"error\":{\"message\":\"invalid api key\"}}";
        let response = format!(
            "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let port = serve(Box::leak(response.into_boxed_str()));

        let outcome = stream_lines(
            &format!("http://127.0.0.1:{port}/chat/completions"),
            HeaderMap::new(),
            "{}",
            || false,
            Arc::new(Notify::new()),
            |_| {},
        )
        .await;

        let message = outcome.expect_err("a 401 must not read as success").message;
        assert!(message.contains("401"), "{message}");
        assert!(message.contains("invalid api key"), "{message}");
    }

    #[tokio::test]
    async fn a_cancelled_stream_stops_early() {
        let body = "data: one\ndata: two\n";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let port = serve(Box::leak(response.into_boxed_str()));

        // Already cancelled: nothing should be emitted.
        let cancelled = Arc::new(Mutex::new(HashSet::new()));
        cancelled.lock().expect("lock").insert("test".to_string());

        let mut lines: Vec<String> = Vec::new();
        let outcome = stream_lines(
            &format!("http://127.0.0.1:{port}/chat/completions"),
            HeaderMap::new(),
            "{}",
            move || {
                cancelled
                    .lock()
                    .map(|set| set.contains("test"))
                    .unwrap_or(false)
            },
            Arc::new(Notify::new()),
            |line| lines.push(line),
        )
        .await;

        assert!(outcome.is_ok());
        assert!(lines.is_empty(), "a stopped turn emitted {lines:?}");
    }
}
