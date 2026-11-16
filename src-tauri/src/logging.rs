//! Structured, redacting logs.
//!
//! The workbench keeps one log file under the app data directory and writes one JSON object
//! per line: a timestamp, a level, a scope and a message. Nothing is sent anywhere — this is a
//! file the reader (or a bug report they choose to write) can inspect, not telemetry.
//!
//! Two rules the module enforces so a caller cannot forget them:
//!
//!  - **Redaction happens here**, on the way in. A token, an `Authorization` header or the
//!    user's home path never reaches the file, even if the message carried one.
//!  - **Retention is bounded.** The live file rotates at 5 MB and at most five rotations are
//!    kept, so a log cannot grow until the disk is full.
//!
//! A crash report is opt-in (Settings → Privacy). When it is on, an uncaught failure also
//! writes a `crash-<stamp>.json` beside the log and the interface is told the path. The report
//! is local: sending it is the reader's decision, not the app's.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::CommandError;

/// The event a written line is streamed on, for the diagnostics terminal.
pub const LOG_EVENT: &str = "log://line";

/// The live log file, inside the logs directory.
const LOG_FILE: &str = "openlab.log";
/// The directory that holds the log and any crash report.
const LOGS_DIR: &str = "logs";
/// The live file is rotated once it passes this size.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
/// How many rotated files are kept beside the live one.
const KEPT_ROTATED: usize = 5;
/// How many crash reports are kept. A report is opt-in, but a loop can still make many.
const KEPT_REPORTS: usize = 10;

/// One writer at a time: rotation and append must not interleave.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Milliseconds since the epoch, the only clock the log needs.
fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// The redaction rules, compiled once.
fn rules() -> &'static [Regex] {
    static RULES: OnceLock<Vec<Regex>> = OnceLock::new();
    RULES.get_or_init(|| {
        [
            // Authorization: Bearer <token>
            r"(?i)(bearer\s+)([A-Za-z0-9._~+/=-]{8,})",
            // api_key = "...", token: "...", password: "..."
            r#"(?i)\b(api[_-]?key|access[_-]?key|secret[_-]?key|token|password|authorization)(\s*[:=]\s*)["']?([A-Za-z0-9._~+/=-]{6,})["']?"#,
            // Vendor-shaped keys that are recognisable without a label.
            r"\b(sk-[A-Za-z0-9_-]{10,}|hf_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{10,}|xox[abprs]-[A-Za-z0-9-]{10,})",
            // A JWT, wherever it appears.
            r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}",
        ]
        .iter()
        .filter_map(|pattern| Regex::new(pattern).ok())
        .collect()
    })
}

/// The substitutions: the first two keep their label, the rest replace the whole match.
fn replacements() -> [&'static str; 4] {
    ["$1[redacted]", "$1$2[redacted]", "[redacted]", "[redacted]"]
}

/// Remove credentials from one string.
///
/// `home` is passed in so a test can name a path it controls; the command passes the real one.
pub(crate) fn redact_with(text: &str, home: Option<&str>) -> String {
    let mut out = text.to_string();
    for (rule, replacement) in rules().iter().zip(replacements()) {
        out = rule.replace_all(&out, replacement).into_owned();
    }
    if let Some(home) = home {
        if home.len() > 3 {
            out = out.replace(home, "~");
        }
    }
    out
}

/// Remove credentials and the home path from one string.
pub(crate) fn redact(text: &str) -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok();
    redact_with(text, home.as_deref())
}

/// Redact every string in a JSON value, leaving its shape alone.
fn redact_value(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(redact(text)),
        Value::Array(items) => Value::Array(items.iter().map(redact_value).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), redact_value(item)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// One JSON line, redacted.
fn record(level: &str, scope: &str, message: &str, fields: Option<&Value>) -> String {
    json!({
        "at": now_ms(),
        "level": level,
        "scope": scope,
        "message": redact(message),
        "fields": fields.map(redact_value).unwrap_or(Value::Null),
    })
    .to_string()
}

/// The logs directory, created if it does not exist.
pub(crate) fn logs_dir(app: &AppHandle) -> Result<PathBuf, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::io(format!("could not resolve the app data directory: {e}")))?
        .join(LOGS_DIR);
    fs::create_dir_all(&dir)
        .map_err(|e| CommandError::io(format!("could not create {}: {e}", dir.display())))?;
    Ok(dir)
}

/// Rotate the live file when it is past `max`, naming the copy with its timestamp.
fn rotate_if_needed(path: &Path, max: u64) -> Result<(), CommandError> {
    let size = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if size <= max {
        return Ok(());
    }
    let rotated = path.with_file_name(format!("openlab-{}.log", now_ms()));
    fs::rename(path, rotated)
        .map_err(|e| CommandError::io(format!("could not rotate {}: {e}", path.display())))
}

/// Keep the newest `KEPT_ROTATED` rotations. A pruning failure is not a write failure.
fn prune(dir: &Path) {
    let mut rotated: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("openlab-") && name.ends_with(".log"))
        })
        .collect();
    rotated.sort();
    while rotated.len() > KEPT_ROTATED {
        if let Some(oldest) = rotated.first() {
            let _ = fs::remove_file(oldest);
            rotated.remove(0);
        }
    }
}

/// Keep the newest crash reports, so an error loop cannot fill the folder.
fn prune_reports(dir: &Path) {
    let mut reports: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("crash-") && name.ends_with(".json"))
        })
        .collect();
    reports.sort();
    while reports.len() > KEPT_REPORTS {
        if let Some(oldest) = reports.first() {
            let _ = fs::remove_file(oldest);
            reports.remove(0);
        }
    }
}

/// Append one line to the live file, rotating and pruning around it.
fn append(dir: &Path, line: &str) -> Result<(), CommandError> {
    let _guard = WRITE_LOCK
        .lock()
        .map_err(|_| CommandError::io("the log lock is poisoned"))?;
    let path = dir.join(LOG_FILE);
    rotate_if_needed(&path, MAX_LOG_BYTES)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| CommandError::io(format!("could not open {}: {e}", path.display())))?;
    writeln!(file, "{line}")
        .map_err(|e| CommandError::io(format!("could not write {}: {e}", path.display())))?;
    prune(dir);
    Ok(())
}

/// Write one log line, ignoring a failure where the caller has nowhere to report it.
pub(crate) fn write_line(app: &AppHandle, level: &str, scope: &str, message: &str) {
    let line = record(level, scope, message, None);
    if let Ok(dir) = logs_dir(app) {
        let _ = append(&dir, &line);
    }
    // The diagnostics terminal follows the file as it is written; a reader watching a failure
    // should not have to press refresh.
    let _ = app.emit(LOG_EVENT, &line);
}

/// The version, so a report from an older build can be told apart.
fn version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Write a crash report beside the log and return its path.
fn crash_report(
    app: &AppHandle,
    level: &str,
    scope: &str,
    message: &str,
    fields: Option<&Value>,
) -> Result<String, CommandError> {
    let dir = logs_dir(app)?;
    let path = dir.join(format!("crash-{}.json", now_ms()));
    let report = json!({
        "at": now_ms(),
        "version": version(app),
        "level": level,
        "scope": scope,
        "message": redact(message),
        "fields": fields.map(redact_value).unwrap_or(Value::Null),
    });
    let body = serde_json::to_string_pretty(&report)?;
    fs::write(&path, body)
        .map_err(|e| CommandError::io(format!("could not write {}: {e}", path.display())))?;
    prune_reports(&dir);
    Ok(path.to_string_lossy().into_owned())
}

/// Prepare the logs directory on start, and drop the oldest rotations if a previous run was
/// killed before it could.
pub fn init(app: &AppHandle) {
    if let Ok(dir) = logs_dir(app) {
        prune(&dir);
        prune_reports(&dir);
    }
}

/// Where the log lives, for a screen that offers to open it.
#[tauri::command]
pub fn logs_path(app: AppHandle) -> Result<serde_json::Value, CommandError> {
    let dir = logs_dir(&app)?;
    Ok(json!({
        "dir": dir.to_string_lossy(),
        "file": dir.join(LOG_FILE).to_string_lossy(),
    }))
}

/// The last `lines` lines of the log, so the reader can see what happened without a terminal.
#[tauri::command]
pub fn logs_tail(app: AppHandle, lines: Option<usize>) -> Result<String, CommandError> {
    let dir = logs_dir(&app)?;
    let path = dir.join(LOG_FILE);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(_) => return Ok(String::new()),
    };
    let wanted = lines.unwrap_or(200).clamp(1, 2_000);
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(wanted);
    Ok(all[start..].join("\n"))
}

/// The crash reports beside the log, newest first.
#[tauri::command]
pub fn crash_reports(app: AppHandle) -> Result<Vec<serde_json::Value>, CommandError> {
    let dir = logs_dir(&app)?;
    let mut reports: Vec<(u128, PathBuf)> = fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("crash-") && name.ends_with(".json"))
        })
        .map(|path| {
            let stamp = path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| name.trim_start_matches("crash-").strip_suffix(".json"))
                .and_then(|stamp| stamp.parse::<u128>().ok())
                .unwrap_or(0);
            (stamp, path)
        })
        .collect();
    reports.sort_by_key(|(stamp, _)| std::cmp::Reverse(*stamp));
    Ok(reports
        .into_iter()
        .map(|(at, path)| {
            json!({
                "at": at,
                "path": path.to_string_lossy(),
                "size": fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0),
            })
        })
        .collect())
}

/// Write a structured log line, and optionally a crash report.
///
/// `report` is the opt-in from Settings → Privacy; when it is on the caller also gets the path
/// of the report so it can be shown. The line is always written: a local log is not telemetry.
#[tauri::command]
pub fn log_write(
    app: AppHandle,
    level: String,
    scope: String,
    message: String,
    fields: Option<Value>,
    report: Option<bool>,
) -> Result<Option<String>, CommandError> {
    let dir = logs_dir(&app)?;
    // A level the interface does not know is kept as `info` rather than written verbatim.
    let level = match level.as_str() {
        "debug" | "info" | "warn" | "error" => level.clone(),
        _ => "info".to_string(),
    };
    let line = record(&level, &scope, &message, fields.as_ref());
    append(&dir, &line)?;
    let _ = app.emit(LOG_EVENT, &line);
    if report.unwrap_or(false) {
        return crash_report(&app, &level, &scope, &message, fields.as_ref()).map(Some);
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bearer_token_is_redacted() {
        let line = redact_with("GET /v1 with Authorization: Bearer abcdef1234567890", None);
        assert!(!line.contains("abcdef1234567890"));
        assert!(line.contains("[redacted]"));
    }

    #[test]
    fn key_assignments_are_redacted_and_labels_stay() {
        let line = redact_with(
            "token=sk-live-0123456789abcdef and api_key: 'hunter22'",
            None,
        );
        assert!(!line.contains("sk-live-0123456789abcdef"));
        assert!(!line.contains("hunter22"));
        assert!(line.contains("token="));
        assert!(line.contains("api_key"));
    }

    #[test]
    fn a_vendor_key_and_a_jwt_are_redacted_without_a_label() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart";
        let line = redact_with(&format!("hf_abcdefghijkl and {jwt}"), None);
        assert!(!line.contains("hf_abcdefghijkl"));
        assert!(!line.contains("eyJhbGciOiJIUzI1NiJ9"));
    }

    #[test]
    fn the_home_path_is_shortened() {
        let line = redact_with(
            "could not read /Users/ada/lab/notes.txt",
            Some("/Users/ada"),
        );
        assert_eq!(line, "could not read ~/lab/notes.txt");
    }

    #[test]
    fn a_line_records_its_scope_and_redacts_its_fields() {
        let line = record(
            "error",
            "boot",
            "failed with token=supersecret",
            Some(&json!({ "url": "https://x.test?api_key=abcdef123" })),
        );
        assert!(line.contains("\"scope\":\"boot\""));
        assert!(!line.contains("supersecret"));
        assert!(!line.contains("abcdef123"));
    }

    #[test]
    fn rotation_names_the_copy_with_the_timestamp() {
        let dir = std::env::temp_dir().join(format!("openlab-log-rotate-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(LOG_FILE);
        fs::write(&path, "x".repeat(64)).unwrap();
        rotate_if_needed(&path, 8).unwrap();
        assert!(!path.exists());
        let rotated = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with("openlab-"));
        assert!(rotated);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn crash_reports_are_pruned_to_the_newest() {
        let dir = std::env::temp_dir().join(format!("openlab-crash-prune-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        for index in 0..(KEPT_REPORTS + 2) {
            fs::write(dir.join(format!("crash-{index}.json")), "{}").unwrap();
        }
        prune_reports(&dir);
        let left = fs::read_dir(&dir).unwrap().flatten().count();
        assert_eq!(left, KEPT_REPORTS);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn retention_keeps_the_newest_rotations() {
        let dir = std::env::temp_dir().join(format!("openlab-log-prune-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        for index in 0..(KEPT_ROTATED + 3) {
            fs::write(dir.join(format!("openlab-{index}.log")), "x").unwrap();
        }
        prune(&dir);
        let left = fs::read_dir(&dir).unwrap().flatten().count();
        assert_eq!(left, KEPT_ROTATED);
        let _ = fs::remove_dir_all(&dir);
    }
}
