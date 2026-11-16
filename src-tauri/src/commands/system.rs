//! What is running right now.
//!
//! The diagnostics page answers "which services are alive, and what are they holding" without
//! starting anything: every field here is read from state that already exists. A status command
//! that spawns the worker to ask it would be the opposite of useful.
//!
//! The heavy services release themselves when the app is idle (`services::on_idle`), so "closed"
//! is a normal answer rather than a fault; the page says so.

use std::path::Path;
use std::sync::OnceLock;
use std::time::Instant;

use serde_json::{json, Value};
use shaku::HasComponent;
use tauri::{AppHandle, Manager};

use crate::commands::db::{Storage, DB_FILE};
use crate::commands::scan::Scan;
use crate::commands::vectors::VectorIndex;
use crate::error::CommandError;
use crate::services::AppModule;

/// When the process started, for an uptime the reader can see.
static STARTED: OnceLock<Instant> = OnceLock::new();

/// Remember the start, called once from setup.
pub fn mark_started() {
    let _ = STARTED.set(Instant::now());
}

/// The size of one file, or zero when it is not there.
fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

/// Every service, as the diagnostics page reads it.
#[tauri::command]
pub fn system_status(app: AppHandle) -> Result<Value, CommandError> {
    let module = app.state::<AppModule>();
    let storage: &dyn Storage = module.resolve_ref();
    let scan: &dyn Scan = module.resolve_ref();
    let vectors: &dyn VectorIndex = module.resolve_ref();

    let data_dir = app.path().app_data_dir().ok();
    let database = data_dir.as_ref().map(|dir| dir.join(DB_FILE));
    let log_file = data_dir
        .as_ref()
        .map(|dir| dir.join("logs").join("openlab.log"));

    Ok(json!({
        "app": {
            "version": app.package_info().version.to_string(),
            "pid": std::process::id(),
            "uptimeSecs": STARTED.get().map(|at| at.elapsed().as_secs()).unwrap_or(0),
            "dataDir": data_dir.as_ref().map(|dir| dir.to_string_lossy()),
        },
        "database": {
            "path": database.as_ref().map(|path| path.to_string_lossy()),
            "sizeBytes": database.as_ref().map(|path| file_size(path)).unwrap_or(0),
            // The connection opens on first use and is closed when the app is idle.
            "open": storage.is_open(),
        },
        "scan": {
            "worker": scan.status(),
            "engine": crate::commands::engine::scan_engine_status(app.clone()),
        },
        "vectors": { "open": vectors.is_open() },
        "logs": {
            "sizeBytes": log_file.as_ref().map(|path| file_size(path)).unwrap_or(0),
        },
    }))
}
