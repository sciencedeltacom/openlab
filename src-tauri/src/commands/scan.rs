//! The PDF scan worker.
//!
//! The heavy pipeline — Surya for OCR, EmbeddingGemma over llama.cpp, LanceDB for
//! vectors — lives in a bundled Python process, not in the webview and not in this
//! crate. Rust's job is the boundary: spawn the worker once, speak JSON lines to
//! it, forward its progress to the interface, and answer with its result.
//!
//! The worker is optional by design. A machine without the bundled Python falls
//! back to `python3` on the path; a machine with neither gets a readable error from
//! `scan_health` rather than a crash, so the rest of the workbench is unaffected.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use shaku::{Component, HasComponent};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::vectors::VectorIndex;
use crate::error::CommandError;

/// One line of the worker's protocol, classified.
#[derive(Debug, PartialEq, Eq)]
pub enum ReplyKind {
    /// A progress event for the request in flight.
    Progress,
    /// The final answer.
    Done,
    /// The request failed.
    Error,
    /// Anything else, including a line that is not JSON.
    Unknown,
}

/// Classify one protocol line, returning the request id it carries.
pub fn classify(line: &str) -> (Option<String>, ReplyKind) {
    let parsed: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return (None, ReplyKind::Unknown),
    };
    let id = parsed.get("id").and_then(Value::as_str).map(str::to_string);
    let kind = match parsed.get("event").and_then(Value::as_str) {
        Some("progress") => ReplyKind::Progress,
        Some("done") => ReplyKind::Done,
        Some("error") => ReplyKind::Error,
        _ => ReplyKind::Unknown,
    };
    (id, kind)
}

/// The PDF pipeline a command reaches.
pub trait Scan: crate::services::Service {
    /// What is alive right now, without starting anything.
    fn status(&self) -> Value;

    /// Run one request against the worker, restarting it when the root changed.
    fn request(
        &self,
        app: &AppHandle,
        root: &str,
        op: &str,
        args: Value,
    ) -> Result<Value, CommandError>;
}

/// The running worker, or `None` until the first command needs it.
#[derive(Component, Default)]
#[shaku(interface = Scan)]
pub struct ScanWorker {
    #[shaku(force_default)]
    worker: Mutex<Option<Worker>>,
    /// The embedding server the worker talks to, when this app started it.
    #[shaku(force_default)]
    embed: Mutex<Option<Child>>,
}

impl Scan for ScanWorker {
    fn status(&self) -> Value {
        let mut worker = self.worker.lock().ok();
        let alive = worker
            .as_mut()
            .and_then(|guard| guard.as_mut())
            .map(|running| {
                running
                    .child
                    .try_wait()
                    .map(|state| state.is_none())
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        let root = worker
            .as_ref()
            .and_then(|guard| guard.as_ref())
            .map(|running| running.root.clone());
        let embed = self
            .embed
            .lock()
            .ok()
            .and_then(|mut guard| {
                guard.as_mut().map(|child| {
                    child
                        .try_wait()
                        .map(|state| state.is_none())
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);
        json!({ "worker": alive, "embedding": embed, "root": root })
    }

    fn request(
        &self,
        app: &AppHandle,
        root: &str,
        op: &str,
        args: Value,
    ) -> Result<Value, CommandError> {
        run_request(app, self, root, op, args)
    }
}

impl crate::services::Service for ScanWorker {
    /// Stop the worker and the embedding server this app started.
    ///
    /// This is the memory that matters: a Python process holding Surya and torch, and a
    /// llama-server holding a loaded model — hundreds of megabytes to gigabytes between them.
    /// Both are respawned on the next scan, so releasing them costs a reload, not correctness.
    /// A server the user started themselves is not in `embed`, so it is never touched.
    fn on_idle(&self) {
        if let Ok(mut guard) = self.worker.lock() {
            if let Some(mut worker) = guard.take() {
                let _ = worker.child.kill();
                let _ = worker.child.wait();
            }
        }
        if let Ok(mut guard) = self.embed.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

struct Worker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    /// The index root this worker was started with; a different one restarts it.
    root: String,
}

impl Worker {
    fn send(
        &mut self,
        request: &Value,
        on_progress: &mut dyn FnMut(&Value),
    ) -> Result<Value, CommandError> {
        let line = serde_json::to_string(request)
            .map_err(|error| CommandError::new("scan", error.to_string()))?;
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|error| {
                CommandError::new(
                    "scan",
                    format!("the scan worker stopped accepting input: {error}"),
                )
            })?;

        let id = request
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let mut buffer = String::new();
        loop {
            buffer.clear();
            let read = self.stdout.read_line(&mut buffer).map_err(|error| {
                CommandError::new(
                    "scan",
                    format!("could not read from the scan worker: {error}"),
                )
            })?;
            if read == 0 {
                return Err(CommandError::new("scan", "the scan worker exited"));
            }
            let (reply_id, kind) = classify(buffer.trim());
            match kind {
                ReplyKind::Progress => {
                    if let Ok(payload) = serde_json::from_str::<Value>(buffer.trim()) {
                        on_progress(&payload);
                    }
                    continue;
                }
                ReplyKind::Done | ReplyKind::Error if reply_id.as_deref() == Some(id.as_str()) => {
                    let parsed: Value = serde_json::from_str(buffer.trim())
                        .map_err(|error| CommandError::new("scan", error.to_string()))?;
                    if kind == ReplyKind::Error {
                        let message = parsed
                            .get("error")
                            .and_then(Value::as_str)
                            .unwrap_or("the scan worker failed")
                            .to_string();
                        return Err(CommandError::new("scan", message));
                    }
                    return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
                }
                _ => continue,
            }
        }
    }
}

/// Where the worker script and its Python live.
///
/// The interpreter is looked for in the order a reader would expect: an explicit `OPENLAB_PYTHON`
/// override wins at spawn time; here, a build that still bundles one, then an engine installed on
/// demand into the app's data directory, then a development checkout's own copy. When none is
/// found the spawn falls back to `python3` on the path, which is the one interpreter that is not
/// pinned — and a machine that never installs the engine still runs the pipeline's fallbacks.
fn worker_paths(app: &AppHandle) -> (PathBuf, Option<PathBuf>) {
    let mut script = None;
    let mut python = None;
    if let Ok(resources) = app.path().resource_dir() {
        let bundled_script = resources.join("worker").join("worker.py");
        if bundled_script.exists() {
            script = Some(bundled_script);
        }
        let bundled_python = resources.join("python").join("bin").join("python3");
        if bundled_python.exists() {
            python = Some(bundled_python);
        }
    }
    // A development checkout runs the same script straight from the repository, and has its own
    // copy of the engine beside it.
    let script = script.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("worker")
            .join("worker.py")
    });
    let python = python
        .or_else(|| crate::commands::engine::installed_python(app))
        .or_else(|| {
            let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("python")
                .join("bin")
                .join("python3");
            checkout.exists().then_some(checkout)
        });
    (script, python)
}

fn spawn(app: &AppHandle, root: &str, embed_url: Option<&str>) -> Result<Worker, CommandError> {
    let (script, bundled) = worker_paths(app);
    if !script.exists() {
        return Err(CommandError::new(
            "scan",
            format!("the scan worker is missing at {}", script.display()),
        ));
    }
    let python = std::env::var("OPENLAB_PYTHON")
        .ok()
        .map(PathBuf::from)
        .or(bundled)
        .unwrap_or_else(|| PathBuf::from("python3"));

    let mut command = Command::new(&python);
    command
        .arg(&script)
        .arg("--root")
        .arg(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if let Some(url) = embed_url {
        command.arg("--embed-url").arg(url);
    }

    let mut child = command.spawn().map_err(|error| {
        CommandError::new(
            "scan",
            format!("could not start {}: {error}", python.display()),
        )
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| CommandError::new("scan", "no stdin on the worker"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CommandError::new("scan", "no stdout on the worker"))?;

    Ok(Worker {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        root: root.to_string(),
    })
}

/// Run one request against the worker, restarting it when the root changed.
///
/// The `Busy` guard tells the idle watchdog a scan is in flight, so it cannot stop the worker
/// out from under a running request.
fn run_request(
    app: &AppHandle,
    worker: &ScanWorker,
    root: &str,
    op: &str,
    args: Value,
) -> Result<Value, CommandError> {
    let _busy = crate::services::Busy::start();
    let mut guard = lock_worker(worker, WORKER_WAIT)?;

    let restart = match guard.as_ref() {
        Some(worker) => worker.root != root,
        None => true,
    };
    if restart {
        if let Some(mut worker) = guard.take() {
            let _ = worker.child.kill();
            let _ = worker.child.wait();
        }
        let embed_url = ensure_embed_server(app, worker);
        *guard = Some(spawn(app, root, embed_url.as_deref())?);
    }

    let worker = guard.as_mut().expect("the worker was just spawned");
    let mut on_progress = |payload: &Value| {
        let _ = app.emit("scan://progress", payload.clone());
    };
    let payload = worker.send(
        &json!({ "id": "1", "op": op, "args": args }),
        &mut on_progress,
    )?;
    Ok(payload)
}

/// How long a command waits for the worker before it reports that it is busy.
const WORKER_WAIT: Duration = Duration::from_secs(5);

/// Take the worker lock, or fail after `wait`.
///
/// The worker is one process speaking one protocol, so its requests are serial by design. What
/// must not happen is a second command blocking forever behind a long scan: it waits a bounded
/// time, then says the worker is busy. The idle watchdog is kept out by the `Busy` guard, which
/// covers the whole request.
fn lock_worker(
    worker: &ScanWorker,
    wait: Duration,
) -> Result<MutexGuard<'_, Option<Worker>>, CommandError> {
    let deadline = Instant::now() + wait;
    loop {
        match worker.worker.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::Poisoned(_)) => {
                return Err(CommandError::new(
                    "scan",
                    "the scan worker lock was poisoned",
                ))
            }
            Err(TryLockError::WouldBlock) => {
                if Instant::now() >= deadline {
                    return Err(CommandError::new(
                        "scan",
                        "the scan worker is busy with another request",
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

/// True when something is listening at `host:port`.
fn listening(host: &str, port: u16) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    let Ok(addresses) = (host, port).to_socket_addrs() else {
        return false;
    };
    addresses.into_iter().any(|address| {
        TcpStream::connect_timeout(&address, std::time::Duration::from_millis(300)).is_ok()
    })
}

/// The embedding endpoint: the user's choice, or the default the worker also assumes.
fn embed_endpoint() -> (String, String, u16) {
    let url =
        std::env::var("OPENLAB_EMBED_URL").unwrap_or_else(|_| "http://127.0.0.1:8901".to_string());
    let rest = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let mut parts = rest.splitn(2, ':');
    let host = parts.next().unwrap_or("127.0.0.1").to_string();
    let port = parts
        .next()
        .and_then(|tail| tail.trim_end_matches('/').parse().ok())
        .unwrap_or(8901);
    (url, host, port)
}

/// A binary on the path, for machines that installed llama.cpp themselves.
fn on_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|directory| directory.join(name))
            .find(|candidate| candidate.exists())
    })
}

/// The llama-server to run: the bundled one first, then a checkout, then the path.
fn llama_binary(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("bin").join("llama-server");
        if bundled.exists() {
            return Some(bundled);
        }
    }
    let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("bin")
        .join("llama-server");
    if checkout.exists() {
        return Some(checkout);
    }
    on_path("llama-server")
}

/// The GGUF to serve: an explicit path, or the embedding model in the app's data directory.
fn embed_model(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("OPENLAB_EMBED_MODEL_PATH") {
        let path = PathBuf::from(explicit);
        return path.exists().then_some(path);
    }
    let directory = app.path().app_data_dir().ok()?.join("models");
    std::fs::read_dir(directory)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("embeddinggemma") && name.ends_with(".gguf"))
                .unwrap_or(false)
        })
}

/// Make sure an embedding server is up, starting one when the pieces are on this machine.
///
/// Returns the URL to hand the worker. A machine without the binary or the model gets
/// `None`, and the worker reports its fallback embedder rather than failing.
fn ensure_embed_server(app: &AppHandle, worker: &ScanWorker) -> Option<String> {
    let (url, host, port) = embed_endpoint();
    if listening(&host, port) {
        return Some(url);
    }
    let binary = llama_binary(app)?;
    let model = embed_model(app)?;

    let mut command = Command::new(&binary);
    command
        .arg("--model")
        .arg(&model)
        .arg("--alias")
        .arg("embeddinggemma2")
        .args(["--embeddings", "--pooling", "mean"])
        .args([
            "--ctx-size",
            "2048",
            "--batch-size",
            "2048",
            "--ubatch-size",
            "2048",
        ])
        .args(["--parallel", "1"])
        .arg("--host")
        .arg(&host)
        .arg("--port")
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command.spawn().ok()?;
    if let Ok(mut guard) = worker.embed.lock() {
        *guard = Some(child);
    }

    // A 176 MB Q4 model loads in seconds; wait a little so the first scan gets real vectors.
    for _ in 0..20 {
        if listening(&host, port) {
            return Some(url);
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    None
}

/// What the scan pipeline can do on this machine.
#[tauri::command]
pub async fn scan_health(app: AppHandle, root: String) -> Result<Value, CommandError> {
    off_thread(app, "scan", move |app, services| {
        let scan: &dyn Scan = services.resolve_ref();
        let mut payload = scan.request(app, &root, "health", json!({}))?;
        if let Value::Object(ref mut map) = payload {
            // The vector index is this side's, so the worker cannot report it.
            map.insert("vectors".to_string(), Value::String("lancedb".to_string()));
        }
        Ok(payload)
    })
    .await
}

/// Index one record's PDF: `{ doi?, recordId?, url?, path?, docId?, force? }`.
#[tauri::command]
pub async fn scan_pdf(app: AppHandle, root: String, args: Value) -> Result<Value, CommandError> {
    off_thread(app, "scan", move |app, services| {
        let scan: &dyn Scan = services.resolve_ref();
        let vectors: &dyn VectorIndex = services.resolve_ref();
        // The agent may name a path or a URL to index. Both are checked here before they reach
        // the worker: a local path must resolve inside the workspace, and a URL must be a public
        // host. The worker reads files as the user, so an unchecked path is an arbitrary read.
        let args = confine_scan_args(args, &root)?;
        let payload = scan.request(app, &root, "scan_pdf", args)?;
        // A finished scan writes the worker's JSONL; the vector index is rebuilt from it here,
        // so search never depends on a Python package being installed.
        if payload.get("status").and_then(Value::as_str) == Some("indexed") {
            if let Err(error) = vectors.sync(&root) {
                crate::logging::write_line(
                    app,
                    "warn",
                    "vectors",
                    &format!("the vector index was not updated: {error}"),
                );
            }
        }
        Ok(payload)
    })
    .await
}

/// Resolve a scan request's `path` inside the workspace and check its `url` is public.
fn confine_scan_args(mut args: Value, root: &str) -> Result<Value, CommandError> {
    if !args.is_object() {
        return Ok(args);
    }
    if let Some(path) = args.get("path").and_then(Value::as_str).map(str::to_string) {
        let resolved = crate::commands::workspace::scoped_read(&path, root)?;
        args["path"] = Value::String(resolved.to_string_lossy().into_owned());
    }
    if let Some(url) = args.get("url").and_then(Value::as_str) {
        // The worker downloads this itself, so the internal-host guard has to run here.
        crate::commands::proxy::check_public_url(url)?;
    }
    Ok(args)
}

/// Hybrid search over the indexed chunks.
///
/// The Rust path fuses BM25 (worker, Mojo-accelerated) with LanceDB vectors (here) using
/// RRF, then asks the worker to hydrate the ids into hits. When any piece is missing — no
/// vectors yet, no model — it falls back to the worker's own search.
#[tauri::command]
pub async fn search_library(
    app: AppHandle,
    root: String,
    query: String,
    doc_ids: Option<Vec<String>>,
    limit: Option<u32>,
) -> Result<Value, CommandError> {
    off_thread(app, "scan", move |app, services| {
        let scan: &dyn Scan = services.resolve_ref();
        let vectors: &dyn VectorIndex = services.resolve_ref();
        let limit = limit.unwrap_or(10).clamp(1, 50) as usize;

        let via_vectors = (|| -> Result<Value, CommandError> {
            let embedded = scan.request(app, &root, "embed", json!({ "text": query }))?;
            let vector: Vec<f32> = embedded
                .get("vector")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_f64)
                        .map(|value| value as f32)
                        .collect()
                })
                .unwrap_or_default();
            if vector.is_empty() {
                return Err(CommandError::new(
                    "vectors",
                    "the worker produced no query vector",
                ));
            }

            let bm25 = scan.request(
                app,
                &root,
                "bm25",
                json!({ "query": query, "docIds": doc_ids, "limit": limit * 4 }),
            )?;
            let bm25_ids: Vec<String> = bm25
                .get("ids")
                .and_then(Value::as_array)
                .map(|ids| {
                    ids.iter()
                        .filter_map(|id| id.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();

            let vector_ids = vectors.search(&root, vector, limit * 4, doc_ids.clone())?;
            if bm25_ids.is_empty() && vector_ids.is_empty() {
                return Err(CommandError::new("vectors", "nothing is indexed yet"));
            }

            let fused: Vec<String> = crate::commands::vectors::rrf(&[bm25_ids, vector_ids], 60)
                .into_iter()
                .take(limit)
                .collect();
            let hydrated = scan.request(
                app,
                &root,
                "hydrate",
                json!({ "query": query, "ids": fused }),
            )?;
            Ok(json!({
                "hits": hydrated.get("hits").cloned().unwrap_or_else(|| json!([])),
                "mode": "hybrid",
            }))
        })();

        match via_vectors {
            Ok(payload) => Ok(payload),
            Err(_) => scan.request(
                app,
                &root,
                "search",
                json!({ "query": query, "docIds": doc_ids, "limit": limit }),
            ),
        }
    })
    .await
}

/// The documents the worker has indexed.
#[tauri::command]
pub async fn scan_status(
    app: AppHandle,
    root: String,
    doc_ids: Option<Vec<String>>,
) -> Result<Value, CommandError> {
    off_thread(app, "scan", move |app, services| {
        let scan: &dyn Scan = services.resolve_ref();
        scan.request(app, &root, "status", json!({ "docIds": doc_ids }))
    })
    .await
}

/// Drop a document and its chunks.
#[tauri::command]
pub async fn scan_forget(
    app: AppHandle,
    root: String,
    doc_id: String,
) -> Result<Value, CommandError> {
    off_thread(app, "scan", move |app, services| {
        let scan: &dyn Scan = services.resolve_ref();
        scan.request(app, &root, "forget", json!({ "docId": doc_id }))
    })
    .await
}

/// Run a service call off the main thread.
///
/// A Tauri command without `async` runs on the main thread, and these commands block on the
/// Python worker for as long as a PDF takes to OCR and embed — minutes. `AppHandle` is
/// `Send + 'static` and resolves the DI module itself, which is what lets the work cross into
/// `spawn_blocking` while the window stays responsive and progress events keep painting.
async fn off_thread<T, F>(app: AppHandle, name: &'static str, work: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle, &crate::services::AppModule) -> Result<T, CommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let services = app.state::<crate::services::AppModule>();
        work(&app, services.inner())
    })
    .await
    .map_err(|e| CommandError::new(name, format!("the {name} task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Asking what is running must not start anything: a fresh worker reports itself down.
    #[test]
    fn status_reports_nothing_before_the_first_request() {
        let worker = ScanWorker::default();
        let status = worker.status();
        assert_eq!(status["worker"], false);
        assert_eq!(status["embedding"], false);
        assert!(status["root"].is_null());
    }

    #[test]
    fn a_done_line_is_classified() {
        let (id, kind) = classify(r#"{"id":"1","event":"done","result":{"status":"indexed"}}"#);
        assert_eq!(id.as_deref(), Some("1"));
        assert_eq!(kind, ReplyKind::Done);
    }

    #[test]
    fn a_progress_line_is_classified() {
        let (id, kind) = classify(r#"{"id":"1","event":"progress","phase":"embed","pct":70}"#);
        assert_eq!(id.as_deref(), Some("1"));
        assert_eq!(kind, ReplyKind::Progress);
    }

    #[test]
    fn an_error_line_is_classified() {
        let (_, kind) = classify(r#"{"id":"2","event":"error","error":"no records"}"#);
        assert_eq!(kind, ReplyKind::Error);
    }

    #[test]
    fn a_busy_worker_reports_rather_than_hangs() {
        let worker = ScanWorker::default();
        let _held = worker.worker.lock().unwrap();
        let started = std::time::Instant::now();
        let result = lock_worker(&worker, Duration::from_millis(120));
        assert!(
            result.is_err(),
            "a held worker lock must not be waited out silently"
        );
        assert!(
            started.elapsed() >= Duration::from_millis(100),
            "it should have waited for the bounded window before giving up"
        );
    }

    #[test]
    fn noise_is_unknown_rather_than_a_panic() {
        assert_eq!(classify("not json"), (None, ReplyKind::Unknown));
        assert_eq!(classify(""), (None, ReplyKind::Unknown));
        assert_eq!(
            classify(r#"{"id":"1"}"#),
            (Some("1".into()), ReplyKind::Unknown)
        );
    }
}
