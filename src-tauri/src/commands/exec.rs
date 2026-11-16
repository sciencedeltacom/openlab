//! Running a command and fetching a URL for the agent.
//!
//! Both are the sharp edges of an agent: a command runs with the user's own privileges, and a
//! fetch leaves the machine. The workspace root bounds the working directory, the command gets
//! a hard time limit, and every result is capped so one run cannot flood the transcript. The
//! user's permission decision is made above this layer; by the time a command reaches here it
//! has been approved.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::commands::execution::{self, ExecutionConfig};
use crate::error::CommandError;

/// Head kept when a pipe produces more than this.
const MAX_OUTPUT_BYTES: usize = 40 * 1024;

/// Tail kept beside the head, because a failure is nearly always reported last.
const TAIL_BYTES: usize = 6 * 1024;

/// A command is stopped after this long unless the caller asks otherwise.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

/// The longest a caller may ask for: a compute job can be a notebook run, not a keystroke.
const MAX_TIMEOUT: Duration = Duration::from_secs(60 * 60);

/// What a finished command produced.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutput {
    /// Combined stdout and stderr.
    pub output: String,
    /// The process exit code, or `-1` when it was signalled or timed out.
    pub exit_code: i32,
}

/// Cut text at the cap, keeping both ends, and say how much was dropped.
fn cap(text: String) -> String {
    let limit = MAX_OUTPUT_BYTES + TAIL_BYTES;
    if text.len() <= limit {
        return text;
    }
    // Walk back to a character boundary: `truncate` panics on a non-boundary index.
    let mut head_end = MAX_OUTPUT_BYTES;
    while head_end > 0 && !text.is_char_boundary(head_end) {
        head_end -= 1;
    }
    let mut tail_start = text.len() - TAIL_BYTES;
    while tail_start < text.len() && !text.is_char_boundary(tail_start) {
        tail_start += 1;
    }
    format!(
        "{}\n\n… {} bytes elided; the end follows …\n\n{}",
        &text[..head_end],
        text.len() - head_end - (text.len() - tail_start),
        &text[tail_start..]
    )
}

/// Read a pipe, keeping the head and a bounded tail rather than only the first N bytes.
fn read_capped<R: Read>(pipe: Option<R>) -> String {
    let Some(mut pipe) = pipe else {
        return String::new();
    };
    let mut head = Vec::new();
    let mut tail: std::collections::VecDeque<u8> = std::collections::VecDeque::new();
    let mut total = 0usize;
    let mut chunk = [0u8; 8192];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                total += read;
                let room = MAX_OUTPUT_BYTES.saturating_sub(head.len());
                let keep = room.min(read);
                head.extend_from_slice(&chunk[..keep]);
                for byte in &chunk[keep..read] {
                    if tail.len() == TAIL_BYTES {
                        tail.pop_front();
                    }
                    tail.push_back(*byte);
                }
            }
            Err(_) => break,
        }
    }
    let mut text = String::from_utf8_lossy(&head).into_owned();
    if total > head.len() {
        let kept_tail: Vec<u8> = tail.into_iter().collect();
        let elided = total.saturating_sub(head.len() + kept_tail.len());
        text.push_str(&format!(
            "\n\n… {elided} bytes elided; the end follows …\n\n{}",
            String::from_utf8_lossy(&kept_tail)
        ));
    }
    text
}

/// Resolve a working directory inside the workspace, refusing anything outside it.
fn working_dir(cwd: Option<&str>, root: &Path) -> Result<PathBuf, CommandError> {
    let Some(relative) = cwd else {
        return Ok(root.to_path_buf());
    };
    let candidate = Path::new(relative);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    let resolved = fs::canonicalize(&joined)
        .map_err(|e| CommandError::io(format!("could not open {relative}: {e}")))?;
    if !resolved.starts_with(root) {
        return Err(CommandError::invalid(format!(
            "{relative} is outside the workspace"
        )));
    }
    Ok(resolved)
}

/// Run a command in the workspace and return its output and exit code.
///
/// `env` is how a compute target's credentials reach the CLI that needs them: the values come
/// from the OS keyring and are set on this one child process, never written to disk and never
/// inherited by anything else. The agent's own tool calls pass none.
///
/// `env_vault` is the same thing without the credential crossing the IPC boundary: each entry
/// names an environment variable and the vault key it is read from, and the value is resolved
/// here. A key that reached the webview would be a key any script in the webview could read.
///
/// `execution` chooses where the command runs: as the user, in a sandbox, or in a container.
/// A missing value is the historical behaviour (this machine), so an older caller keeps working.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn run_command(
    app: AppHandle,
    command: String,
    cwd: Option<String>,
    root: String,
    env: Option<HashMap<String, String>>,
    env_vault: Option<HashMap<String, String>>,
    execution: Option<ExecutionConfig>,
    timeout_secs: Option<u64>,
) -> Result<RunOutput, CommandError> {
    // A compose box wants a command to fail fast; a job submitted to a target may be a
    // notebook that runs for half an hour. The caller says which, and the cap stays bounded.
    let timeout = timeout_secs
        .map(|secs| Duration::from_secs(secs.clamp(5, MAX_TIMEOUT.as_secs())))
        .unwrap_or(COMMAND_TIMEOUT);
    tauri::async_runtime::spawn_blocking(move || {
        run_blocking(&app, command, cwd, root, env, env_vault, execution, timeout)
    })
    .await
    .map_err(|e| CommandError::new("exec", format!("the command task failed: {e}")))?
}

/// The blocking half of {@link run_command}, so a long command never occupies the loop.
#[allow(clippy::too_many_arguments)]
fn run_blocking(
    app: &AppHandle,
    command: String,
    cwd: Option<String>,
    root: String,
    env: Option<HashMap<String, String>>,
    env_vault: Option<HashMap<String, String>>,
    execution: Option<ExecutionConfig>,
    timeout: Duration,
) -> Result<RunOutput, CommandError> {
    let root = fs::canonicalize(&root)
        .map_err(|e| CommandError::io(format!("could not open the workspace {root}: {e}")))?;
    let working = working_dir(cwd.as_deref(), &root)?;

    let mut process_env = env.unwrap_or_default();
    for (name, provider) in env_vault.unwrap_or_default() {
        if let Some(value) = crate::commands::secrets::read_secret(app, &provider)? {
            process_env.insert(name, value);
        }
    }

    // Where the command runs. The argv is built before anything is spawned, so a refusal
    // (no runtime, an empty image, a forbidden mount) costs nothing.
    let env_keys: Vec<String> = process_env.keys().cloned().collect();
    let launcher = execution::launch(
        execution.as_ref(),
        &command,
        &working,
        &root,
        &env_keys,
        execution::Platform::current(),
    )?;
    process_env.extend(launcher.env.clone());

    let mut process = Command::new(&launcher.program);
    process
        .args(&launcher.args)
        .current_dir(&working)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !process_env.is_empty() {
        process.envs(process_env);
    }
    let mut child = process
        .spawn()
        .map_err(|e| CommandError::new("exec", format!("could not start the command: {e}")))?;

    // Drain both pipes on their own threads: a child that fills a pipe buffer would otherwise
    // block forever while this thread waits for it to exit. The pipes are taken first so the
    // threads own them and `child` stays usable for `try_wait` and `kill`.
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stdout = std::thread::spawn(move || read_capped(stdout_pipe));
    let stderr = std::thread::spawn(move || read_capped(stderr_pipe));

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    // A container outlives its CLI: `docker run` being killed leaves the
                    // container running, so the launcher names one to remove.
                    if let Some((program, args)) = &launcher.cleanup {
                        let _ = Command::new(program)
                            .args(args)
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .status();
                    }
                    timed_out = true;
                    break child.wait().ok();
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => {
                return Err(CommandError::new(
                    "exec",
                    format!("the command failed: {e}"),
                ))
            }
        }
    };

    let mut output = stdout.join().unwrap_or_default();
    let errors = stderr.join().unwrap_or_default();
    if !errors.is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(&errors);
    }
    if timed_out {
        output.push_str(&format!(
            "\n… the command exceeded {}s and was stopped",
            timeout.as_secs()
        ));
    }
    if output.trim().is_empty() {
        output = "(no output)".to_string();
    }

    Ok(RunOutput {
        output: cap(output),
        exit_code: status.and_then(|s| s.code()).unwrap_or(-1),
    })
}

/// Most headers one fetch may carry. A manifest is data, not a reason to build a request.
const MAX_FETCH_HEADERS: usize = 24;

/// One header pair, refused rather than ignored when it cannot be sent.
fn request_header(
    name: &str,
    value: &str,
) -> Result<(reqwest::header::HeaderName, reqwest::header::HeaderValue), CommandError> {
    let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
        .map_err(|_| CommandError::invalid(format!("{name} is not a valid header name")))?;
    let value = reqwest::header::HeaderValue::from_str(value)
        .map_err(|_| CommandError::invalid(format!("{name} has an invalid value")))?;
    Ok((name, value))
}

/// Fetch a URL with GET and return its body as text.
///
/// `headers` are literal values an extension declared. `vault_headers` maps a header name to a
/// vault key: the value is read here and never crosses the IPC boundary, so an extension can
/// authenticate without its key entering the webview.
#[tauri::command]
pub async fn fetch_url(
    app: AppHandle,
    url: String,
    headers: Option<HashMap<String, String>>,
    vault_headers: Option<HashMap<String, String>>,
) -> Result<String, CommandError> {
    // The agent's own fetch is the highest-risk outbound request, so it takes the same
    // public-host guard and no-redirect client as the connector proxy.
    let parsed = crate::commands::proxy::check_public_url(&url)?;
    let client = crate::commands::proxy::guarded_client(Duration::from_secs(30))?;
    let literal = headers.unwrap_or_default();
    let vault = vault_headers.unwrap_or_default();
    if literal.len() + vault.len() > MAX_FETCH_HEADERS {
        return Err(CommandError::invalid(format!(
            "a fetch may carry at most {MAX_FETCH_HEADERS} headers"
        )));
    }
    let mut request = client
        .get(parsed)
        .header("User-Agent", "openlab/1.0 (research workbench)");
    for (name, value) in literal {
        let (name, value) = request_header(&name, &value)?;
        request = request.header(name, value);
    }
    for (name, provider) in vault {
        // Only an extension's own namespace may be reached here. The keyring holds provider
        // keys and other credentials under their own names, and this command has no endpoint
        // binding to prove the value is going where it belongs.
        if !provider.starts_with("extension:") {
            return Err(CommandError::invalid(
                "a fetch may only read an extension credential",
            ));
        }
        let secret = crate::commands::secrets::read_secret(&app, &provider)?.ok_or_else(|| {
            CommandError::new(
                "credential",
                format!("no credential is stored for {provider}; add it on the extension page"),
            )
        })?;
        let (name, value) = request_header(&name, &secret)?;
        request = request.header(name, value);
    }
    let response = request
        .send()
        .await
        .map_err(|e| CommandError::new("network", format!("could not reach {url}: {e}")))?;
    let status = response.status();
    if !status.is_success() {
        return Err(CommandError::new(
            "network",
            format!("the server answered {status} for {url}"),
        ));
    }
    let text = response
        .text()
        .await
        .map_err(|e| CommandError::new("network", format!("could not read {url}: {e}")))?;
    Ok(cap(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_cap_keeps_both_ends() {
        let short = cap("hello".to_string());
        assert_eq!(short, "hello");
        let long = cap(format!(
            "HEAD{}TAIL",
            "x".repeat(MAX_OUTPUT_BYTES + TAIL_BYTES)
        ));
        assert!(long.starts_with("HEAD"));
        assert!(long.ends_with("TAIL"));
        assert!(long.contains("bytes elided"));
    }

    #[test]
    fn a_captured_pipe_keeps_the_tail_past_the_head() {
        let body = format!("HEAD{}TAIL", "x".repeat(MAX_OUTPUT_BYTES + 2048));
        let text = read_capped(Some(std::io::Cursor::new(body.into_bytes())));
        assert!(text.starts_with("HEAD"));
        assert!(text.ends_with("TAIL"));
        assert!(text.contains("bytes elided"));
    }

    #[test]
    fn fetch_refuses_an_internal_or_non_http_url() {
        // The guard runs before a request is made, so no network is needed to prove it.
        for url in [
            "http://127.0.0.1:8787/admin",
            "http://169.254.169.254/latest/meta-data",
            "file:///etc/passwd",
        ] {
            assert!(
                crate::commands::proxy::check_public_url(url).is_err(),
                "{url}"
            );
        }
    }

    #[test]
    fn header_pairs_are_validated_before_a_fetch() {
        assert!(request_header("Authorization", "Bearer x").is_ok());
        assert!(request_header("bad header", "x").is_err());
        assert!(request_header("Authorization", "line\nbreak").is_err());
    }

    #[test]
    fn working_directory_refuses_escape() {
        let root = std::env::temp_dir();
        let root = fs::canonicalize(&root).unwrap();
        assert!(working_dir(Some(".."), &root).is_err());
        assert!(working_dir(None, &root).is_ok());
    }
}
