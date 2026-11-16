//! SQLite storage.
//!
//! The workbench's structured data — workspaces, sessions, transcripts, tracker, compute
//! ledger — lives in one SQLite file in the app data directory rather than in webview
//! storage. It survives a cache clear, it can be inspected with any SQLite tool, and the
//! schema is owned by Drizzle ORM on the TypeScript side (`src/lib/db`).
//!
//! This module is deliberately only the transport: it executes the SQL that Drizzle builds
//! and returns rows as positional arrays, which is what drizzle's proxy driver maps. It has
//! no schema knowledge, so the schema cannot drift between two languages.
//!
//! Statements arrive one at a time over IPC and are serialised on a single connection behind
//! a mutex, which is also what lets a `begin`/`commit` issued by Drizzle's transaction API
//! wrap the statements between them.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value as Json;
use shaku::{Component, HasComponent, Interface};
use tauri::{AppHandle, Manager};

use crate::error::CommandError;

/// The file the workbench keeps its records in.
pub(crate) const DB_FILE: &str = "openlab.db";

/// How many pre-migration copies to keep beside the database.
const BACKUPS_KEPT: usize = 5;

/// A restore is staged here and applied on the next launch, before a connection opens.
const RESTORE_PENDING: &str = "openlab.db.restore-pending";

/// The storage a command runs SQL against.
pub trait Storage: Interface {
    /// Whether a connection is open right now. Cheap: it only looks.
    fn is_open(&self) -> bool;

    /// Run one statement against the open connection, opening it on first use.
    fn execute(
        &self,
        app: &AppHandle,
        sql: &str,
        params: &[Json],
        method: &str,
    ) -> Result<Option<Vec<Json>>, CommandError>;
}

/// The open connection, or `None` until the first command needs it.
#[derive(Component, Default)]
#[shaku(interface = Storage)]
pub struct Db {
    #[shaku(force_default)]
    connection: Mutex<Option<Connection>>,
}

impl Storage for Db {
    fn is_open(&self) -> bool {
        self.connection
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn execute(
        &self,
        app: &AppHandle,
        sql: &str,
        params: &[Json],
        method: &str,
    ) -> Result<Option<Vec<Json>>, CommandError> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| db_error("the database lock was poisoned"))?;
        if guard.is_none() {
            *guard = Some(open(app)?);
        }
        let connection = guard.as_ref().expect("the connection was just opened");
        run_statement(connection, sql, params, method)
    }
}

fn db_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new("db", error.to_string())
}

/// Translate one JSON parameter into the SQLite value it stands for.
///
/// The TypeScript side only ever sends nulls, numbers, strings and booleans — a value of any
/// other shape is a bug at the trust boundary, not something to coerce silently.
fn to_sql_value(value: &Json) -> Result<SqlValue, CommandError> {
    Ok(match value {
        Json::Null => SqlValue::Null,
        Json::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        Json::Number(number) => match number.as_i64() {
            Some(integer) => SqlValue::Integer(integer),
            None => SqlValue::Real(number.as_f64().unwrap_or_default()),
        },
        Json::String(text) => SqlValue::Text(text.clone()),
        other => {
            return Err(CommandError::invalid(format!(
                "unsupported SQL parameter: {other}"
            )))
        }
    })
}

/// Translate one column value back into JSON.
///
/// Columns come back positionally: drizzle's proxy driver maps them by position against the
/// column list it knows, so names would be noise. A blob is not part of the schema; if one
/// ever appears it travels as an array of bytes rather than a lossy string.
fn to_json_value(value: ValueRef<'_>) -> Json {
    match value {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(integer) => Json::from(integer),
        ValueRef::Real(real) => Json::from(real),
        ValueRef::Text(text) => Json::from(String::from_utf8_lossy(text).into_owned()),
        ValueRef::Blob(bytes) => Json::Array(bytes.iter().map(|byte| Json::from(*byte)).collect()),
    }
}

/// Write a consistent snapshot of the store to `destination`.
///
/// `VACUUM INTO` rather than a file copy: the live file is in WAL mode, so a plain copy can
/// miss the write-ahead log. A destination that already exists is refused by SQLite itself.
fn snapshot(app: &AppHandle, destination: &Path) -> Result<(), CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| db_error(format!("could not resolve the app data directory: {e}")))?;
    let source = dir.join(DB_FILE);
    if !source.exists() {
        return Err(db_error("there is no store to copy yet"));
    }
    let connection = Connection::open(&source).map_err(db_error)?;
    connection
        .execute(
            "VACUUM INTO ?1",
            [destination.to_string_lossy().to_string()],
        )
        .map_err(db_error)?;
    Ok(())
}

/// Copy the store to a path the reader chose, for a second machine or a shared drive.
#[tauri::command]
pub fn db_backup_to(app: AppHandle, destination: String) -> Result<String, CommandError> {
    let path = PathBuf::from(&destination);
    if path.exists() {
        return Err(db_error(format!("{destination} is already there")));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| db_error(format!("could not create {}: {e}", parent.display())))?;
    }
    snapshot(&app, &path)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Copy the database to a timestamped file before a migration touches it.
///
/// `VACUUM INTO` rather than a file copy: the live file is in WAL mode, so a plain copy can
/// miss the write-ahead log and produce a database that does not match what the app sees.
/// Old copies are pruned so a schema change cannot fill the disk over time.
#[tauri::command]
pub fn db_backup(app: AppHandle) -> Result<Option<String>, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| db_error(format!("could not resolve the app data directory: {e}")))?;
    let source = dir.join(DB_FILE);
    if !source.exists() {
        return Ok(None);
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| db_error(format!("the clock is before the epoch: {e}")))?
        .as_secs();
    let destination = dir.join(format!("{DB_FILE}.backup-{stamp}"));
    let connection = Connection::open(&source).map_err(db_error)?;
    connection
        .execute(
            "VACUUM INTO ?1",
            [destination.to_string_lossy().to_string()],
        )
        .map_err(db_error)?;

    // Keep the newest copies. A failure to prune is not a reason to fail the backup.
    let mut backups = backup_paths(&dir);
    backups.reverse();
    while backups.len() > BACKUPS_KEPT {
        if let Some(old) = backups.first() {
            let _ = std::fs::remove_file(old);
            backups.remove(0);
        }
    }

    Ok(Some(destination.to_string_lossy().to_string()))
}

/// One copy on disk, as the backup screen lists it.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    /// Unix seconds, taken from the file name so it matches the data dir exactly.
    pub at: u64,
    pub size: u64,
}

/// The copies beside the database, newest first.
fn backup_paths(dir: &Path) -> Vec<PathBuf> {
    let mut copies: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&format!("{DB_FILE}.backup-")))
        })
        .collect();
    copies.sort();
    copies.reverse();
    copies
}

/// The timestamp in a backup's name, or `0` when it cannot be read.
fn backup_stamp(path: &Path) -> u64 {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.rsplit_once('-').map(|(_, stamp)| stamp))
        .and_then(|stamp| stamp.parse().ok())
        .unwrap_or(0)
}

/// Every copy, newest first.
#[tauri::command]
pub fn db_backups(app: AppHandle) -> Result<Vec<BackupInfo>, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| db_error(format!("could not resolve the app data directory: {e}")))?;
    Ok(backup_paths(&dir)
        .into_iter()
        .map(|path| BackupInfo {
            at: backup_stamp(&path),
            size: std::fs::metadata(&path)
                .map(|metadata| metadata.len())
                .unwrap_or(0),
            path: path.to_string_lossy().into_owned(),
        })
        .collect())
}

/// Take a copy when the newest one is older than `hours`.
///
/// The app calls this after boot. A missing copy is due; a clock that went backwards is not a
/// reason to overwrite the newest one, so a future stamp counts as fresh.
#[tauri::command]
pub fn db_backup_if_due(
    app: AppHandle,
    hours: Option<u64>,
) -> Result<Option<String>, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| db_error(format!("could not resolve the app data directory: {e}")))?;
    if !dir.join(DB_FILE).exists() {
        return Ok(None);
    }
    let interval = hours.unwrap_or(24).max(1) * 3_600;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let newest = backup_paths(&dir)
        .first()
        .map(|path| backup_stamp(path))
        .unwrap_or(0);
    if newest > 0 && now.saturating_sub(newest) < interval {
        return Ok(None);
    }
    db_backup(app)
}

/// Refuse anything the app cannot open and understand.
fn verify_copy(path: &Path) -> Result<(), CommandError> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| db_error(format!("{} is not a database: {e}", path.display())))?;
    let verdict: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| db_error(format!("the integrity check did not run: {e}")))?;
    if !verdict.eq_ignore_ascii_case("ok") {
        return Err(db_error(format!("the copy is damaged: {verdict}")));
    }
    let has_schema: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if has_schema == 0 {
        return Err(db_error(
            "the copy has no migration record; it is not an openlab store",
        ));
    }
    Ok(())
}

/// Stage a copy to be put in place on the next launch.
///
/// Replacing the file while a connection is open is how rows disappear, so the chosen copy is
/// verified, written beside the store, and applied by {@link apply_pending_restore} before the
/// first connection opens. The current store is copied first, so a wrong choice has a way back.
#[tauri::command]
pub fn db_restore_schedule(app: AppHandle, path: String) -> Result<String, CommandError> {
    let source = PathBuf::from(&path);
    if !source.exists() {
        return Err(db_error(format!("no copy at {path}")));
    }
    verify_copy(&source)?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| db_error(format!("could not resolve the app data directory: {e}")))?;
    let pending = dir.join(RESTORE_PENDING);
    std::fs::copy(&source, &pending)
        .map_err(|e| db_error(format!("could not stage the copy: {e}")))?;
    Ok(pending.to_string_lossy().into_owned())
}

/// Apply a staged restore. Called from setup, before any connection is opened.
pub fn apply_pending_restore(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let pending = dir.join(RESTORE_PENDING);
    if !pending.exists() {
        return;
    }
    let target = dir.join(DB_FILE);
    if target.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        let safety = dir.join(format!("{DB_FILE}.backup-{stamp}"));
        let copied = Connection::open(&target)
            .and_then(|connection| {
                connection.execute("VACUUM INTO ?1", [safety.to_string_lossy().to_string()])
            })
            .is_ok();
        if !copied {
            // A plain copy is the fallback: the connection may not be openable, and keeping
            // the old file is still better than replacing it with nothing.
            let _ = std::fs::copy(&target, &safety);
        }
    }
    for sidecar in [format!("{DB_FILE}-wal"), format!("{DB_FILE}-shm")] {
        let _ = std::fs::remove_file(dir.join(sidecar));
    }
    if std::fs::rename(&pending, &target).is_err() {
        let _ = std::fs::copy(&pending, &target);
        let _ = std::fs::remove_file(&pending);
    }
}

/// Open the database file, creating the directory and configuring the connection.
fn open(app: &AppHandle) -> Result<Connection, CommandError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| db_error(format!("could not resolve the app data directory: {e}")))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| db_error(format!("could not create {}: {e}", dir.display())))?;

    let connection = Connection::open(dir.join(DB_FILE)).map_err(db_error)?;
    // A second connection may exist briefly (a rebuild, a second window); wait rather than
    // fail immediately on a writer's lock.
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(db_error)?;
    // WAL survives abrupt quits better than the rollback journal, and the reader/writer split
    // costs nothing here. Foreign keys are enforced: deleting a project should take its rows.
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(db_error)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(db_error)?;
    Ok(connection)
}

/// Execute one statement and collect its rows, in the shape drizzle's proxy expects.
///
/// `get` answers with the row itself (or `None` when there is none) — drizzle's proxy treats
/// that reply as one row, not as a list of them. `all` and `values` answer with a list of rows.
fn run_statement(
    connection: &Connection,
    sql: &str,
    params: &[Json],
    method: &str,
) -> Result<Option<Vec<Json>>, CommandError> {
    let values = params
        .iter()
        .map(to_sql_value)
        .collect::<Result<Vec<_>, _>>()?;

    if method == "run" {
        // No rows are read for a write; the caller only needs it to have happened.
        connection
            .execute(sql, rusqlite::params_from_iter(values))
            .map_err(db_error)?;
        return Ok(Some(Vec::new()));
    }

    let mut statement = connection.prepare(sql).map_err(db_error)?;
    let columns = statement.column_count();
    let mut rows = statement
        .query(rusqlite::params_from_iter(values))
        .map_err(db_error)?;

    let mut collected = Vec::new();
    while let Some(row) = rows.next().map_err(db_error)? {
        let mut record = Vec::with_capacity(columns);
        for index in 0..columns {
            record.push(to_json_value(row.get_ref(index).map_err(db_error)?));
        }
        if method == "get" {
            return Ok(Some(record));
        }
        collected.push(Json::Array(record));
    }
    if method == "get" {
        // No row to answer with; drizzle's `get` maps this to `undefined`.
        return Ok(None);
    }
    Ok(Some(collected))
}

/// Run one SQL statement against the workbench database.
///
/// `method` is drizzle's verb: `run` for a write, `get`/`all`/`values` for reads. The reply
/// is the list of rows, each row a positional array; drizzle maps it back to typed records.
#[tauri::command]
pub async fn db_execute(
    app: AppHandle,
    sql: String,
    params: Vec<Json>,
    method: String,
) -> Result<Option<Vec<Json>>, CommandError> {
    // The statement blocks on the connection's mutex and on SQLite itself, so it leaves the
    // main thread; the module is resolved here because `State` cannot cross into the closure.
    tauri::async_runtime::spawn_blocking(move || {
        let services = app.state::<crate::services::AppModule>();
        let storage: &dyn Storage = services.resolve_ref();
        storage.execute(&app, &sql, &params, &method)
    })
    .await
    .map_err(|e| CommandError::new("db", format!("the database task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parameters_translate_to_sqlite_values() {
        assert_eq!(to_sql_value(&Json::Null).unwrap(), SqlValue::Null);
        assert_eq!(to_sql_value(&json!(true)).unwrap(), SqlValue::Integer(1));
        assert_eq!(to_sql_value(&json!(7)).unwrap(), SqlValue::Integer(7));
        assert_eq!(to_sql_value(&json!(1.5)).unwrap(), SqlValue::Real(1.5));
        assert_eq!(
            to_sql_value(&json!("task")).unwrap(),
            SqlValue::Text("task".into())
        );
        assert!(to_sql_value(&json!([1, 2])).is_err());
    }

    #[test]
    fn statements_round_trip_rows_and_values() {
        let connection = Connection::open_in_memory().unwrap();
        run_statement(
            &connection,
            "create table tasks (id text primary key, title text, priority integer)",
            &[],
            "run",
        )
        .unwrap();

        // The transaction verbs drizzle's proxy issues travel this same path.
        run_statement(&connection, "begin", &[], "run").unwrap();
        run_statement(
            &connection,
            "insert into tasks (id, title, priority) values (?, ?, ?)",
            &[json!("t1"), json!("Dock the panel"), json!(2)],
            "run",
        )
        .unwrap();
        run_statement(&connection, "commit", &[], "run").unwrap();

        let all = run_statement(
            &connection,
            "select id, title, priority from tasks",
            &[],
            "all",
        )
        .unwrap();
        assert_eq!(all, Some(vec![json!(["t1", "Dock the panel", 2])]));

        // `get` answers with the row itself, because that is how drizzle's proxy maps it.
        let get = run_statement(
            &connection,
            "select title from tasks where id = ?",
            &[json!("t1")],
            "get",
        )
        .unwrap();
        assert_eq!(get, Some(vec![json!("Dock the panel")]));

        let none = run_statement(
            &connection,
            "select title from tasks where id = ?",
            &[json!("missing")],
            "get",
        )
        .unwrap();
        assert_eq!(none, None);
    }

    /// The migrations the app ships, run through the same transport drizzle uses.
    ///
    /// `verify-storage.ts` exercises the SQL against `bun:sqlite`; this is the other half:
    /// the generated files through `run_statement`, which is the path the packaged app takes.
    #[test]
    fn shipped_migrations_apply_through_the_transport() {
        let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../drizzle");
        let journal_path = folder.join("meta/_journal.json");
        if !journal_path.exists() {
            return;
        }
        let journal: Json =
            serde_json::from_str(&std::fs::read_to_string(&journal_path).expect("journal"))
                .expect("journal json");
        let entries = journal["entries"].as_array().expect("entries");

        let connection = Connection::open_in_memory().expect("open");
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .expect("foreign keys");
        for entry in entries {
            let tag = entry["tag"].as_str().expect("tag");
            let sql =
                std::fs::read_to_string(folder.join(format!("{tag}.sql"))).expect("migration");
            for statement in sql
                .split("--> statement-breakpoint")
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                run_statement(&connection, statement, &[], "run")
                    .unwrap_or_else(|error| panic!("{tag}: {}", error.message));
            }
        }

        // A table the schema promises, read back through the transport.
        let rows = run_statement(&connection, "select count(*) from projects", &[], "get")
            .expect("projects table");
        assert_eq!(rows, Some(vec![json!(0)]));

        // And the parameter round-trip the state writer relies on.
        run_statement(
            &connection,
            "insert into projects (id, name, path, icon, createdAt, lastOpenedAt) values (?, ?, ?, ?, ?, ?)",
            &[
                json!("p-1"),
                json!("Lab"),
                json!("/tmp/lab"),
                json!("flask"),
                json!(1),
                json!(1),
            ],
            "run",
        )
        .expect("insert");
        let name = run_statement(
            &connection,
            "select name from projects where id = ?",
            &[json!("p-1")],
            "get",
        )
        .expect("select");
        assert_eq!(name, Some(vec![json!("Lab")]));
    }

    #[test]
    fn a_busy_method_falls_through() {
        // "run" on a pragma or DDL must not try to collect rows.
        let connection = Connection::open_in_memory().unwrap();
        let rows = run_statement(&connection, "pragma user_version = 7", &[], "run").unwrap();
        assert_eq!(rows, Some(vec![]));
    }

    #[test]
    fn a_restore_requires_a_real_store() {
        let dir = std::env::temp_dir().join(format!("openlab-restore-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let good = dir.join("good.db");
        {
            let connection = Connection::open(&good).unwrap();
            connection
                .execute(
                    "create table __drizzle_migrations (id integer primary key)",
                    [],
                )
                .unwrap();
        }
        assert!(verify_copy(&good).is_ok());

        let junk = dir.join("junk.db");
        std::fs::write(&junk, "not sqlite").unwrap();
        assert!(verify_copy(&junk).is_err());

        let empty = dir.join("empty.db");
        Connection::open(&empty).unwrap();
        assert!(verify_copy(&empty).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_backup_stamp_comes_from_the_name() {
        assert_eq!(
            backup_stamp(Path::new("openlab.db.backup-1700000000")),
            1_700_000_000
        );
        assert_eq!(backup_stamp(Path::new("openlab.db")), 0);
    }
}
