//! Service lifecycle.
//!
//! One command, for the way the app stops using its heavy services without exiting:
//! `services_idle` when the window is hidden or the reader has been away. It reaches
//! [`crate::services`], which knows what each service can put down and pick up again.

use tauri::State;

use crate::services::AppModule;

/// Release what the heavy services can rebuild — the scan worker, its embedding server, the
/// vector connection. The next scan or search respawns them.
#[tauri::command]
pub fn services_idle(services: State<'_, AppModule>) {
    crate::services::on_idle(&services);
}
