//! openlab application entry point.

mod commands;
mod error;
mod logging;
mod services;

use commands::{
    chat, cloud, db, engine, exec, execution, git, guard, mcp, oauth, proxy, scan, search, secrets,
    services as lifecycle, system, workspace,
};
use tauri::Manager;

/// Build and run the Tauri application.
pub fn run() {
    tauri::Builder::default()
        // First, as the plugin requires: a second launch hands its arguments to the first
        // process and exits instead of opening a window that would write the same database.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Streams in flight, so the stop button can reach one that is parked on `await`. It is a
        // `HashSet` of ids, so it stays managed on its own rather than in the service module.
        .manage(chat::ChatCancellations::default())
        // The MCP servers this process started, so a second launch does not spawn a second one.
        .manage(mcp::Mcp::default())
        // Every stateful service, wired once: the database, the credential vault, the scan
        // worker and its embedding server, and the vector index.
        .manage(services::build())
        .invoke_handler(tauri::generate_handler![
            // workspace
            workspace::list_dir,
            workspace::read_file,
            workspace::read_file_binary,
            workspace::list_zip,
            workspace::write_file,
            workspace::rename_file,
            workspace::remove_file,
            workspace::path_exists,
            workspace::file_size,
            // search
            search::glob_files,
            search::grep_files,
            // execution and network
            exec::run_command,
            exec::fetch_url,
            execution::execution_status,
            // automatic review of a tool call
            guard::guard_judge,
            // connector transport
            proxy::proxy_request,
            // git
            git::git_status,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            // credentials
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secrets_status,
            // model providers
            chat::chat_stream,
            chat::chat_cancel,
            // cloud stores
            cloud::api_request,
            cloud::download_url,
            cloud::upload_file,
            cloud::s3_list,
            cloud::s3_presign,
            // account connections (OAuth)
            oauth::oauth_client_set,
            oauth::oauth_connect,
            oauth::oauth_status,
            oauth::oauth_disconnect,
            // storage
            db::db_execute,
            db::db_backup,
            db::db_backups,
            db::db_backup_if_due,
            db::db_restore_schedule,
            db::db_backup_to,
            // MCP servers (Serena)
            mcp::mcp_start,
            mcp::mcp_install,
            mcp::mcp_stop,
            mcp::mcp_status,
            mcp::mcp_list_tools,
            mcp::mcp_call,
            // diagnostics
            logging::log_write,
            logging::logs_path,
            logging::logs_tail,
            logging::crash_reports,
            // what is running
            system::system_status,
            // service lifecycle
            lifecycle::services_idle,
            // the scan engine's Python, installed on demand
            engine::scan_engine_status,
            engine::scan_engine_install,
            // the PDF scan pipeline
            scan::scan_health,
            scan::scan_pdf,
            scan::search_library,
            scan::scan_status,
            scan::scan_forget,
        ])
        .setup(|app| {
            // A staged restore lands before any connection is opened. The store it replaces is
            // copied inside the applier, so the choice is reversible.
            db::apply_pending_restore(app.handle());
            // The log directory is prepared before anything that might fail, so the first
            // failure of a run has somewhere to go.
            logging::init(app.handle());
            system::mark_started();
            logging::write_line(app.handle(), "info", "app", "openlab started");
            // Release the heavy services after the app has been quiet for a while.
            services::spawn_watchdog(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("openlab failed to start")
        .run(|app, event| {
            // Close the worker and the embedding server as the app goes away, so neither is
            // left orphaned holding memory.
            if let tauri::RunEvent::Exit = event {
                mcp::on_stop(app);
                logging::write_line(app, "info", "app", "openlab stopped");
                let module = app.state::<services::AppModule>();
                services::on_stop(&module);
            }
        });
}
