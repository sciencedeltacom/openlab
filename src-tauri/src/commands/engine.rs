//! The scan engine's Python, installed on demand.
//!
//! The engine is optional and heavy: a pinned CPython plus Surya, which drags torch,
//! transformers and OpenCV. Shipping it inside the installer would add roughly two gigabytes to
//! every download for a pipeline that already degrades — `pdftotext`, then PyMuPDF, then plain
//! text, with a token-hash embedder and the Python BM25 twin — so it is fetched into the app's
//! data directory the first time a reader asks for it, the same way the embedding model is.
//!
//! `worker_paths` in `scan.rs` prefers this interpreter when it is present, so an install takes
//! effect on the next scan with no other wiring.
//!
//! The pinned interpreter is not the machine's own Python on purpose. A Homebrew Python carries
//! absolute `/opt/homebrew` paths and drifts a minor version at a time, and a torch wheel is
//! built for one CPython minor version; python-build-standalone is relocatable and fixed.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::CommandError;

/// The release the URL is pinned to, and the CPython it carries.
const RELEASE: &str = "20261009";
const PYTHON_TAG: &str = "cpython-3.12.15+20261009";
const RELEASE_BASE: &str = "https://github.com/astral-sh/python-build-standalone/releases/download";
const RELEASE_API: &str =
    "https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags";

/// The packages the worker actually imports.
///
/// `surya-ocr` is the extractor — it decides on its own between a text layer and OCR, and it is
/// the reason this install is large. `pymupdf` is the middle fallback for a machine that has it
/// but not Surya. LanceDB is a Rust crate here and the Mojo hot path is a compiled `.so`, so
/// neither belongs in a Python install; the README's old `lancedb mojo` line was both unused
/// and the larger half of the environment.
const PACKAGES: &[&str] = &["surya-ocr", "pymupdf"];

/// Written after a successful install, so status is a `stat` rather than a slow `import`.
const MARKER: &str = ".openlab-engine.json";

/// Where an on-demand engine lives: `<app data>/engine`.
pub(crate) fn engine_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("engine"))
}

/// The interpreter inside an engine directory. python-build-standalone puts it at `bin/python3`
/// on Unix and at the top level on Windows.
pub(crate) fn interpreter(dir: &Path) -> PathBuf {
    if cfg!(windows) {
        dir.join("python.exe")
    } else {
        dir.join("bin").join("python3")
    }
}

/// The installed interpreter, when one is present. Presence, not a marker: a half-installed
/// interpreter still runs, and the worker reports which engines it found.
pub(crate) fn installed_python(app: &AppHandle) -> Option<PathBuf> {
    let python = interpreter(&engine_dir(app)?);
    python.exists().then_some(python)
}

/// The release asset for this machine, or nothing when there is no build for it.
fn asset() -> Option<String> {
    let target = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        ("windows", "aarch64") => "aarch64-pc-windows-msvc",
        _ => return None,
    };
    Some(format!("{PYTHON_TAG}-{target}-install_only.tar.gz"))
}

/// A digest as the UI and the release API spell it, without the algorithm prefix.
fn digest_hex(value: &str) -> String {
    value
        .strip_prefix("sha256:")
        .unwrap_or(value)
        .trim()
        .to_ascii_lowercase()
}

/// True when a string is a complete SHA-256 in hex.
fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

/// The digest the downloaded archive must have.
///
/// A pinned hash from the release API is the normal path; `OPENLAB_ENGINE_SHA256` overrides it
/// for a lab mirror, and a custom URL without a hash is refused rather than installed blind.
async fn expected_sha256(_url: &str) -> Result<String, CommandError> {
    if let Ok(explicit) = std::env::var("OPENLAB_ENGINE_SHA256") {
        let digest = digest_hex(&explicit);
        if !is_sha256(&digest) {
            return Err(CommandError::invalid(
                "OPENLAB_ENGINE_SHA256 must be a 64-character SHA-256 hex digest",
            ));
        }
        return Ok(digest);
    }
    if std::env::var("OPENLAB_ENGINE_URL").is_ok() {
        return Err(CommandError::invalid(
            "OPENLAB_ENGINE_URL is set but OPENLAB_ENGINE_SHA256 is not; refusing an unverified download",
        ));
    }

    let asset = asset()
        .ok_or_else(|| CommandError::invalid("there is no pinned Python build for this machine"))?;
    let client = crate::commands::proxy::guarded_client(Duration::from_secs(30))?;
    let response = client
        .get(format!("{RELEASE_API}/{RELEASE}"))
        .header("User-Agent", "openlab/1.0 (research workbench)")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| {
            CommandError::new(
                "engine",
                format!("could not read the release manifest: {e}"),
            )
        })?;
    let body = response.text().await.map_err(|e| {
        CommandError::new(
            "engine",
            format!("could not read the release manifest: {e}"),
        )
    })?;
    let manifest: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
        CommandError::new("engine", format!("the release manifest is not JSON: {e}"))
    })?;
    let digest = manifest["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|candidate| candidate["name"].as_str() == Some(asset.as_str()))
                .and_then(|candidate| candidate["digest"].as_str())
        })
        .map(digest_hex)
        .unwrap_or_default();
    if !is_sha256(&digest) {
        return Err(CommandError::new(
            "engine",
            format!(
                "the release manifest has no SHA-256 for {asset}; refusing an unverified download"
            ),
        ));
    }
    Ok(digest)
}

/// The download URL, overridable so a lab mirror can serve it without a new build.
fn download_url() -> Result<String, CommandError> {
    if let Ok(explicit) = std::env::var("OPENLAB_ENGINE_URL") {
        return Ok(explicit);
    }
    let asset = asset().ok_or_else(|| {
        CommandError::invalid(format!(
            "there is no pinned Python build for {} {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ))
    })?;
    Ok(format!("{RELEASE_BASE}/{RELEASE}/{asset}"))
}

/// What the interface needs to decide whether to offer the install.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// An interpreter is present and its packages finished installing.
    pub installed: bool,
    /// The interpreter path, when there is one.
    pub python: Option<String>,
    /// The install directory, so the interface can point at it.
    pub path: Option<String>,
    /// The packages an install puts in place.
    pub packages: Vec<String>,
}

/// One line of install progress, forwarded to the interface.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineProgress {
    /// `download`, `extract` or `install`.
    phase: String,
    /// Percent, on the download phase only.
    pct: Option<u8>,
    /// The line pip printed, on the install phase.
    line: Option<String>,
}

fn emit(app: &AppHandle, phase: &str, pct: Option<u8>, line: Option<&str>) {
    let _ = app.emit(
        "scan://engine",
        EngineProgress {
            phase: phase.to_string(),
            pct,
            line: line.map(str::to_string),
        },
    );
}

fn status_of(app: &AppHandle) -> EngineStatus {
    let dir = engine_dir(app);
    let python = installed_python(app);
    EngineStatus {
        installed: dir
            .as_ref()
            .map(|dir| dir.join(MARKER).exists())
            .unwrap_or(false),
        python: python.map(|path| path.display().to_string()),
        path: dir.map(|dir| dir.display().to_string()),
        packages: PACKAGES.iter().map(|name| name.to_string()).collect(),
    }
}

/// Whether the engine is installed, and where.
#[tauri::command]
pub fn scan_engine_status(app: AppHandle) -> EngineStatus {
    status_of(&app)
}

/// Fetch the pinned Python and the worker's packages into the app's data directory.
///
/// Long: the interpreter is tens of megabytes and the packages are closer to a gigabyte, so the
/// whole thing runs off the main thread and narrates itself over `scan://engine`.
#[tauri::command]
pub async fn scan_engine_install(app: AppHandle) -> Result<EngineStatus, CommandError> {
    let dir = engine_dir(&app)
        .ok_or_else(|| CommandError::new("engine", "there is no app data directory"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| CommandError::io(format!("could not create {}: {e}", dir.display())))?;
    let python = interpreter(&dir);

    if !python.exists() {
        let url = download_url()?;
        let archive = dir.join("cpython.tar.gz");
        emit(&app, "download", Some(0), None);
        download(&app, &url, &archive).await?;

        emit(&app, "extract", None, None);
        let (archive_for_task, dir_for_task) = (archive.clone(), dir.clone());
        tauri::async_runtime::spawn_blocking(move || extract(&archive_for_task, &dir_for_task))
            .await
            .map_err(|e| CommandError::new("engine", format!("the extract task failed: {e}")))??;
        let _ = std::fs::remove_file(&archive);
    }

    if !python.exists() {
        return Err(CommandError::new(
            "engine",
            format!("the archive held no interpreter at {}", python.display()),
        ));
    }

    let (app_for_task, python_for_task) = (app.clone(), python.clone());
    tauri::async_runtime::spawn_blocking(move || pip(&app_for_task, &python_for_task))
        .await
        .map_err(|e| CommandError::new("engine", format!("the install task failed: {e}")))??;

    write_marker(&dir)?;
    Ok(status_of(&app))
}

/// Stream the archive to disk, reporting the percentage as it goes.
async fn download(app: &AppHandle, url: &str, dest: &Path) -> Result<(), CommandError> {
    use futures_util::StreamExt;

    // The same guarded client every other outbound request uses, so a redirect cannot carry the
    // download to an internal host. The timeout is generous: this is a big file.
    let expected = expected_sha256(url).await?;
    let client = crate::commands::proxy::guarded_client(Duration::from_secs(3600))?;
    let response = client
        .get(url)
        .header("User-Agent", "openlab/1.0 (research workbench)")
        .send()
        .await
        .map_err(|e| CommandError::new("engine", format!("could not reach {url}: {e}")))?;
    let status = response.status();
    if !status.is_success() {
        return Err(CommandError::new(
            "engine",
            format!("the download answered {status}: {url}"),
        ));
    }
    let total = response.content_length();
    let mut file = std::fs::File::create(dest)
        .map_err(|e| CommandError::io(format!("could not write {}: {e}", dest.display())))?;
    let mut written = 0u64;
    let mut reported = u8::MAX;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| CommandError::new("engine", format!("the download failed: {e}")))?;
        file.write_all(&chunk)
            .map_err(|e| CommandError::io(format!("could not write {}: {e}", dest.display())))?;
        hasher.update(&chunk);
        written += chunk.len() as u64;
        if let Some(total) = total.filter(|total| *total > 0) {
            let pct = ((written * 100) / total).min(100) as u8;
            if pct != reported {
                reported = pct;
                emit(app, "download", Some(pct), None);
            }
        }
    }

    let actual = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual != expected {
        let _ = std::fs::remove_file(dest);
        return Err(CommandError::new(
            "engine",
            format!("the archive's SHA-256 is {actual}, not the pinned {expected}; it was not installed"),
        ));
    }
    Ok(())
}

/// Unpack the archive into the engine directory.
///
/// python-build-standalone's `install_only` tarball holds a single `python/` folder, so
/// `--strip-components=1` lands `bin/` and `lib/` directly in `dir`. `tar` is on every target —
/// macOS, Linux, and Windows 10 and later ship bsdtar — which is why this is not a gzip crate.
fn extract(archive: &Path, dir: &Path) -> Result<(), CommandError> {
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(dir)
        .arg("--strip-components=1")
        .stdin(Stdio::null())
        .status()
        .map_err(|e| CommandError::new("engine", format!("could not run tar: {e}")))?;
    if !status.success() {
        return Err(CommandError::new(
            "engine",
            "the archive could not be unpacked",
        ));
    }
    Ok(())
}

/// Install the packages into the fetched interpreter, forwarding pip's narration.
fn pip(app: &AppHandle, python: &Path) -> Result<(), CommandError> {
    emit(
        app,
        "install",
        None,
        Some("resolving the OCR and PDF packages"),
    );
    let mut child = Command::new(python)
        .args([
            "-m",
            "pip",
            "install",
            "--no-input",
            "--disable-pip-version-check",
        ])
        .args(PACKAGES)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| CommandError::new("engine", format!("could not run pip: {e}")))?;

    // pip narrates on stdout and reports failures on stderr. Both pipes are drained at once —
    // a full pipe buffer would otherwise block the child forever — with stdout on its own
    // thread so its lines can become progress events.
    let stdout = child.stdout.take();
    let progress_app = app.clone();
    let reader = std::thread::spawn(move || {
        let Some(stdout) = stdout else {
            return;
        };
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                emit(&progress_app, "install", None, Some(&line));
            }
        }
    });
    let mut errors = String::new();
    if let Some(stderr) = child.stderr.take() {
        let _ = BufReader::new(stderr).read_to_string(&mut errors);
    }
    let status = child
        .wait()
        .map_err(|e| CommandError::new("engine", format!("pip did not finish: {e}")))?;
    let _ = reader.join();
    if !status.success() {
        let reason = errors.trim();
        return Err(CommandError::new(
            "engine",
            if reason.is_empty() {
                "the package install failed".to_string()
            } else {
                reason.to_string()
            },
        ));
    }
    Ok(())
}

/// Record a finished install so `status` does not have to import torch to answer.
fn write_marker(dir: &Path) -> Result<(), CommandError> {
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0);
    let body = format!("{{\"packages\":{:?},\"at\":{at}}}", PACKAGES);
    std::fs::write(dir.join(MARKER), body)
        .map_err(|e| CommandError::io(format!("could not write the install marker: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_digest_is_normalised_and_checked() {
        let digest = "sha256:e00bd455298fa53be93f37b5eecb482b07d578731e1bd4491777f6a6cc5af297";
        assert_eq!(digest_hex(digest).len(), 64);
        assert!(is_sha256(&digest_hex(digest)));
        assert!(!is_sha256("sha256:abc"));
        assert!(!is_sha256(&"z".repeat(64)));
    }

    /// Every desktop target the bundle names has a pinned asset, and the tag is in the name.
    #[test]
    fn asset_names_carry_the_pinned_tag() {
        if let Some(asset) = asset() {
            assert!(asset.starts_with(PYTHON_TAG));
            assert!(asset.ends_with("-install_only.tar.gz"));
        }
    }

    /// The interpreter path is the one python-build-standalone lays down.
    #[test]
    fn interpreter_is_where_the_archive_puts_it() {
        let path = interpreter(Path::new("/tmp/engine"));
        if cfg!(windows) {
            assert!(path.ends_with("python.exe"));
        } else {
            assert!(path.ends_with("bin/python3"));
        }
    }

    /// The archive carries a single `python/` folder, and `--strip-components=1` must land the
    /// interpreter exactly where [`interpreter`] looks for it. Fails loudly if the layout or the
    /// tar invocation ever drifts.
    #[test]
    fn extract_strips_the_archive_prefix() {
        let base = std::env::temp_dir().join(format!("openlab-engine-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let source = base.join("source").join("python").join("bin");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("python3"), b"#!/bin/sh\n").unwrap();

        let archive = base.join("python.tar.gz");
        let status = Command::new("tar")
            .arg("-czf")
            .arg(&archive)
            .arg("-C")
            .arg(base.join("source"))
            .arg("python")
            .status()
            .expect("tar is on every target");
        assert!(status.success());

        let target = base.join("engine");
        std::fs::create_dir_all(&target).unwrap();
        extract(&archive, &target).unwrap();
        assert!(
            interpreter(&target).exists(),
            "the interpreter is not where it belongs"
        );

        let _ = std::fs::remove_dir_all(&base);
    }
}
