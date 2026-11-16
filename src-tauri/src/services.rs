//! The services the app keeps alive, and how they are asked to let go.
//!
//! Stateful work in this app is a handful of long-lived things: a SQLite connection, the
//! credential vault, the PDF scan worker and its embedding server, and the LanceDB connection.
//! They are wired through [Shaku](https://docs.rs/shaku), a compile-time dependency-injection
//! module, so construction lives in one place and the graph is checked at build time.
//!
//! Shaku has no lifecycle of its own, so [`Service`] adds the one this app needs. A machine that
//! has scanned a PDF must not keep a gigabyte of Python and a loaded model resident once the
//! reader has moved on: `on_idle` releases what a service can rebuild, `on_stop` closes it for
//! good.
//!
//! Only the services that hold a *heavy* resource implement it. The SQLite connection and the
//! vault are kilobytes and, worse, a `begin`/`commit` can span two commands — closing either on
//! a timer could drop a transaction. So the watchdog only touches the worker, the embedding
//! server and the Lance connection, and only when no work is in flight.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use shaku::{module, HasComponent, Interface};
use tauri::{AppHandle, Manager};

use crate::commands::db::Db;
use crate::commands::scan::{Scan, ScanWorker};
use crate::commands::secrets::Vault;
use crate::commands::vectors::{VectorIndex, Vectors};

/// How long a heavy service may sit unused before it is released.
const IDLE_TTL: Duration = Duration::from_secs(120);

/// How often the watchdog looks.
const WATCH_INTERVAL: Duration = Duration::from_secs(15);

/// A service that can release its resources.
pub trait Service: Interface {
    /// Let go of what can be rebuilt later, keeping the service usable.
    fn on_idle(&self) {}

    /// Close everything; the app is going away.
    fn on_stop(&self) {
        self.on_idle();
    }
}

module! {
    pub AppModule {
        components = [Db, Vault, ScanWorker, Vectors],
        providers = []
    }
}

/// Build the module. Every component's state starts empty and is filled on first use.
pub fn build() -> AppModule {
    AppModule::builder().build()
}

/// Ask the heavy services to release what they can rebuild.
pub fn on_idle(module: &AppModule) {
    let scan: &dyn Scan = module.resolve_ref();
    scan.on_idle();
    let vectors: &dyn VectorIndex = module.resolve_ref();
    vectors.on_idle();
}

/// Close every service.
pub fn on_stop(module: &AppModule) {
    let scan: &dyn Scan = module.resolve_ref();
    scan.on_stop();
    let vectors: &dyn VectorIndex = module.resolve_ref();
    vectors.on_stop();
}

/// Whether any work is in flight, and when the app was last active.
static BUSY: AtomicBool = AtomicBool::new(false);
static LAST_ACTIVITY: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Record that the app is active right now.
pub fn touch() {
    LAST_ACTIVITY.store(now_ms(), Ordering::Relaxed);
}

/// Marks work in flight, so the watchdog never evicts a service mid-scan.
///
/// Dropped at the end of the operation, whether it succeeded or not.
pub struct Busy;

impl Busy {
    pub fn start() -> Self {
        BUSY.store(true, Ordering::SeqCst);
        touch();
        Self
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
        touch();
    }
}

/// True when nothing is running and the app has been quiet for the whole TTL.
fn should_release() -> bool {
    if BUSY.load(Ordering::SeqCst) {
        return false;
    }
    let last = LAST_ACTIVITY.load(Ordering::Relaxed);
    last != 0 && now_ms().saturating_sub(last) >= IDLE_TTL.as_millis() as u64
}

/// Release the heavy services after a period of quiet.
///
/// The interface also asks for a release when the window is hidden; this is the backstop for a
/// window that is never hidden — a scan that finished and a reader who walked away.
pub fn spawn_watchdog(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(WATCH_INTERVAL);
        if should_release() {
            let module = app.state::<AppModule>();
            on_idle(&module);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_release_needs_quiet_and_no_work() {
        // No activity recorded yet: nothing to release.
        LAST_ACTIVITY.store(0, Ordering::Relaxed);
        assert!(!should_release());

        // Active just now: too soon.
        touch();
        assert!(!should_release());

        // Quiet for longer than the TTL: release.
        let old = now_ms().saturating_sub(IDLE_TTL.as_millis() as u64 + 1);
        LAST_ACTIVITY.store(old, Ordering::Relaxed);
        assert!(should_release());

        // Work in flight: never.
        let busy = Busy::start();
        LAST_ACTIVITY.store(old, Ordering::Relaxed);
        assert!(!should_release());
        drop(busy);
    }
}
