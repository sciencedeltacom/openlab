//! Workspace file access.
//!
//! The webview cannot touch the filesystem directly, so every read and write goes
//! through here. Paths are taken as given rather than sandboxed to one root: the
//! user opened the folder, and the agent is expected to work in sibling checkouts
//! and scratch directories too. Nothing here is reachable without an explicit IPC
//! call from the UI.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::CommandError;

/// One entry returned by [`list_dir`].
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    /// Size in bytes; 0 for a directory.
    pub size: u64,
    /// Milliseconds since the Unix epoch, when the platform reports it.
    pub modified_ms: Option<u64>,
}

/// One entry returned by [`list_zip`].
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntry {
    pub name: String,
    pub is_dir: bool,
    /// Uncompressed size in bytes.
    pub size: u64,
    /// Compressed size in bytes.
    pub compressed: u64,
}

/// Largest file [`read_file`] will return. Anything larger should be streamed.
const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;

/// Largest file [`read_file_binary`] will hand back. Images are small, but a stray
/// multi-gigabyte file should not be pulled into the webview by a mis-click.
const MAX_BINARY_BYTES: u64 = 24 * 1024 * 1024;

fn canonical(path: &str) -> Result<PathBuf, CommandError> {
    if path.trim().is_empty() {
        return Err(CommandError::invalid("path is empty"));
    }
    Ok(PathBuf::from(path))
}

/// Resolve `..` segments without touching the filesystem, so a path can be checked first.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The canonical workspace root, used as the containment boundary.
fn canonical_root(root: &str) -> Result<PathBuf, CommandError> {
    fs::canonicalize(root)
        .map_err(|e| CommandError::io(format!("could not open the workspace {root}: {e}")))
}

/// Join a path onto the workspace root and prove it stays inside.
///
/// The check is done twice: lexically first, so a `..` cannot create a directory outside the
/// root before it is noticed, then again after canonicalization, so a symlink pointing out of
/// the root is refused.
pub(crate) fn scoped_read(path: &str, root: &str) -> Result<PathBuf, CommandError> {
    let root_path = canonical_root(root)?;
    let joined = if Path::new(path).is_absolute() {
        normalize(Path::new(path))
    } else {
        normalize(&root_path.join(path))
    };
    if !joined.starts_with(&root_path) {
        return Err(CommandError::invalid(format!(
            "{path} is outside the workspace"
        )));
    }
    let resolved = fs::canonicalize(&joined)
        .map_err(|e| CommandError::io(format!("could not open {path}: {e}")))?;
    if !resolved.starts_with(&root_path) {
        return Err(CommandError::invalid(format!(
            "{path} is outside the workspace"
        )));
    }
    Ok(resolved)
}

/** The same containment for a write, where the file itself may not exist yet. */
fn scoped_write(path: &str, root: &str) -> Result<PathBuf, CommandError> {
    let root_path = canonical_root(root)?;
    let joined = if Path::new(path).is_absolute() {
        normalize(Path::new(path))
    } else {
        normalize(&root_path.join(path))
    };
    if !joined.starts_with(&root_path) {
        return Err(CommandError::invalid(format!(
            "{path} is outside the workspace"
        )));
    }
    let parent = joined
        .parent()
        .ok_or_else(|| CommandError::invalid("path has no parent directory"))?;
    fs::create_dir_all(parent)
        .map_err(|e| CommandError::io(format!("could not create {}: {e}", parent.display())))?;
    let parent = fs::canonicalize(parent)
        .map_err(|e| CommandError::io(format!("could not open {}: {e}", parent.display())))?;
    if !parent.starts_with(&root_path) {
        return Err(CommandError::invalid(format!(
            "{path} is outside the workspace"
        )));
    }
    let name = joined
        .file_name()
        .ok_or_else(|| CommandError::invalid("path has no file name"))?;
    let target = parent.join(name);
    // The parent is proven inside the root, but the file itself may already be a symlink
    // pointing out of it — `fs::write` and `fs::remove_file` follow it. A read canonicalizes
    // the whole path and refuses; a write cannot, because the file may not exist yet, so it
    // checks the case that matters: an existing symlink must still land inside the root.
    if let Ok(meta) = fs::symlink_metadata(&target) {
        if meta.file_type().is_symlink() {
            let resolved = fs::canonicalize(&target)
                .map_err(|e| CommandError::io(format!("could not open {path}: {e}")))?;
            if !resolved.starts_with(&root_path) {
                return Err(CommandError::invalid(format!(
                    "{path} is outside the workspace"
                )));
            }
        }
    }
    Ok(target)
}

/** Resolve a path for one command: inside the root when one is given, otherwise as-is. */
fn scoped(path: &str, root: Option<&String>) -> Result<PathBuf, CommandError> {
    match root {
        Some(root) => scoped_read(path, root),
        None => canonical(path),
    }
}

/// List a directory, directories first and then alphabetically.
#[tauri::command]
pub fn list_dir(path: String, root: Option<String>) -> Result<Vec<DirEntry>, CommandError> {
    let dir = scoped(&path, root.as_ref())?;
    let entries = fs::read_dir(&dir)
        .map_err(|e| CommandError::io(format!("could not read {}: {e}", dir.display())))?;

    let mut result: Vec<DirEntry> = Vec::new();
    for entry in entries.flatten() {
        let file_type = entry.file_type().ok();
        let is_dir = file_type.map(|t| t.is_dir()).unwrap_or(false);
        // `DirEntry::metadata` does not follow a symlink, so a link's own size is reported.
        let metadata = entry.metadata().ok();
        let modified_ms = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64);
        result.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir,
            is_symlink: file_type.map(|t| t.is_symlink()).unwrap_or(false),
            size: if is_dir {
                0
            } else {
                metadata.map(|m| m.len()).unwrap_or(0)
            },
            modified_ms,
        });
    }

    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(result)
}

/// Read a UTF-8 text file, refusing anything implausibly large.
#[tauri::command]
pub fn read_file(path: String, root: Option<String>) -> Result<String, CommandError> {
    let file = scoped(&path, root.as_ref())?;
    let metadata = fs::metadata(&file)?;
    if metadata.len() > MAX_READ_BYTES {
        return Err(CommandError::invalid(format!(
            "{} is {} bytes; the text reader stops at {MAX_READ_BYTES}",
            file.display(),
            metadata.len()
        )));
    }
    fs::read_to_string(&file)
        .map_err(|e| CommandError::io(format!("could not read {}: {e}", file.display())))
}

/// Read a binary file (an image) as raw bytes.
///
/// The frontend turns this into a blob URL. Returning raw bytes rather than a base64
/// string keeps the payload small and avoids a data-URL copy of the file in memory.
#[tauri::command]
pub async fn read_file_binary(
    path: String,
    root: Option<String>,
) -> Result<tauri::ipc::Response, CommandError> {
    // The file may be up to `MAX_BINARY_BYTES`, so it is read off the main thread.
    tauri::async_runtime::spawn_blocking(move || read_file_binary_blocking(path, root))
        .await
        .map_err(|e| CommandError::new("workspace", format!("the file read task failed: {e}")))?
}

/// The blocking half of {@link read_file_binary}, kept off the main thread.
fn read_file_binary_blocking(
    path: String,
    root: Option<String>,
) -> Result<tauri::ipc::Response, CommandError> {
    let file = scoped(&path, root.as_ref())?;
    let metadata = fs::metadata(&file)?;
    if metadata.len() > MAX_BINARY_BYTES {
        return Err(CommandError::invalid(format!(
            "{} is {} bytes; the binary reader stops at {MAX_BINARY_BYTES}",
            file.display(),
            metadata.len()
        )));
    }
    let bytes = fs::read(&file)
        .map_err(|e| CommandError::io(format!("could not read {}: {e}", file.display())))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// List the entries inside a zip archive, in the order the archive stores them.
#[tauri::command]
pub async fn list_zip(path: String, root: Option<String>) -> Result<Vec<ZipEntry>, CommandError> {
    // Reading an archive's central directory touches the disk, so it is done off the main thread.
    tauri::async_runtime::spawn_blocking(move || list_zip_blocking(path, root))
        .await
        .map_err(|e| CommandError::new("workspace", format!("the zip listing task failed: {e}")))?
}

/// The blocking half of {@link list_zip}, kept off the main thread.
fn list_zip_blocking(path: String, root: Option<String>) -> Result<Vec<ZipEntry>, CommandError> {
    let file = scoped(&path, root.as_ref())?;
    let handle = fs::File::open(&file)
        .map_err(|e| CommandError::io(format!("could not open {}: {e}", file.display())))?;
    let mut archive = zip::ZipArchive::new(handle).map_err(|e| {
        CommandError::invalid(format!("{} is not a readable archive: {e}", file.display()))
    })?;

    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|e| {
            CommandError::io(format!(
                "could not read entry {index} in {}: {e}",
                file.display()
            ))
        })?;
        // zip 9 decodes the name and can fail on a header that claims UTF-8 but is not. The
        // raw bytes are still there, so the entry is listed lossily instead of hidden.
        let name = match entry.name() {
            Ok(name) => name.into_owned(),
            Err(_) => String::from_utf8_lossy(entry.name_raw()).into_owned(),
        };
        entries.push(ZipEntry {
            name,
            is_dir: entry.is_dir(),
            size: entry.size(),
            compressed: entry.compressed_size(),
        });
    }
    Ok(entries)
}

/// Write a UTF-8 text file, creating parent directories as needed.
#[tauri::command]
pub fn write_file(
    path: String,
    contents: String,
    root: Option<String>,
) -> Result<(), CommandError> {
    let file = match root.as_ref() {
        Some(root) => scoped_write(&path, root)?,
        None => canonical(&path)?,
    };
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&file, contents)
        .map_err(|e| CommandError::io(format!("could not write {}: {e}", file.display())))
}

/// Remove a file inside the workspace.
///
/// A record that leaves the app has to leave the repository with it: a wave's plan file
/// that outlives the wave is a file someone will read and believe. Deleting a file that is
/// already gone is not an error — the caller wanted it absent.
#[tauri::command]
pub fn remove_file(path: String, root: Option<String>) -> Result<(), CommandError> {
    let file = match root.as_ref() {
        Some(root) => scoped_write(&path, root)?,
        None => canonical(&path)?,
    };
    match fs::remove_file(&file) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::io(format!(
            "could not remove {}: {error}",
            file.display()
        ))),
    }
}

/// Rename a file inside the workspace.
///
/// A file is what it is called, so its name is editable — and both ends of the rename are
/// resolved inside the root, so a rename can neither reach out of the workspace nor pull a
/// file into it. Renaming onto an existing file is refused rather than overwriting it: the
/// reader asked for a new name, not for the loss of whatever was there.
#[tauri::command]
pub fn rename_file(from: String, to: String, root: Option<String>) -> Result<(), CommandError> {
    let (source, target) = match root.as_ref() {
        Some(root) => (scoped_write(&from, root)?, scoped_write(&to, root)?),
        None => (canonical(&from)?, canonical(&to)?),
    };
    if target.exists() {
        return Err(CommandError::invalid(format!(
            "{} already exists",
            target.display()
        )));
    }
    fs::rename(&source, &target)
        .map_err(|e| CommandError::io(format!("could not rename {}: {e}", source.display())))
}

/// Whether a path exists. Cheap enough for the UI to poll.
#[tauri::command]
pub fn path_exists(path: String, root: Option<String>) -> Result<bool, CommandError> {
    // With a root, the question is "is this name free inside the workspace" — and a name
    // outside it is not free, it is refused. Without one, the path is taken as given.
    match root.as_ref() {
        Some(root) => Ok(scoped_read(&path, root).is_ok()),
        None => Ok(Path::new(&path).exists()),
    }
}

/// The size of a file inside the workspace, for an attachment that is a reference.
#[tauri::command]
pub fn file_size(path: String, root: Option<String>) -> Result<u64, CommandError> {
    let file = scoped(&path, root.as_ref())?;
    fs::metadata(&file)
        .map(|metadata| metadata.len())
        .map_err(|e| CommandError::io(format!("could not measure {}: {e}", file.display())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A zip written here and read back, so the archive table is proven end to end.
    #[test]
    fn lists_the_entries_of_a_zip() {
        let path = std::env::temp_dir().join(format!("openlab-zip-{}.zip", std::process::id()));
        {
            let mut writer = zip::ZipWriter::new(fs::File::create(&path).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            writer.add_directory("data/", options).unwrap();
            writer.start_file("data/readme.txt", options).unwrap();
            writer.write_all(b"hello").unwrap();
            writer.finish().unwrap();
        }

        let entries = list_zip_blocking(path.to_string_lossy().into_owned(), None).unwrap();
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert!(names.contains(&"data/"));
        assert!(names.contains(&"data/readme.txt"));

        let file = entries
            .iter()
            .find(|entry| entry.name == "data/readme.txt")
            .unwrap();
        assert!(!file.is_dir);
        assert_eq!(file.size, 5);

        fs::remove_file(&path).ok();
    }

    /// A listing carries the size the browser shows and sorts directories first.
    #[test]
    fn lists_a_directory_with_sizes() {
        let root = std::env::temp_dir().join(format!("openlab-list-{}", std::process::id()));
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("hello.txt"), b"hello world").unwrap();

        let entries = list_dir(root.to_string_lossy().into_owned(), None).unwrap();
        let file = entries
            .iter()
            .find(|entry| entry.name == "hello.txt")
            .unwrap();
        assert!(!file.is_dir);
        assert_eq!(file.size, 11);
        assert!(file.modified_ms.is_some());

        let dir = entries.iter().find(|entry| entry.name == "sub").unwrap();
        assert!(dir.is_dir);
        assert_eq!(dir.size, 0);
        assert_eq!(
            entries.first().unwrap().name,
            "sub",
            "directories come first"
        );

        fs::remove_dir_all(&root).ok();
    }

    /// A read walks the same containment check as the text reader.
    #[test]
    fn a_path_outside_the_workspace_is_refused() {
        let root = std::env::temp_dir();
        let error = scoped_read("../etc/passwd", &root.to_string_lossy()).unwrap_err();
        assert_eq!(error.kind, "invalid");
    }

    /// Renaming a file, and refusing a rename that leaves the workspace.
    #[test]
    fn renames_a_file_inside_the_workspace() {
        let root = std::env::temp_dir().join(format!("openlab-rename-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let root_text = root.to_string_lossy().into_owned();
        write_file(
            "notes/old.md".into(),
            "the assay holds".into(),
            Some(root_text.clone()),
        )
        .unwrap();

        rename_file(
            "notes/old.md".into(),
            "notes/new.md".into(),
            Some(root_text.clone()),
        )
        .unwrap();
        assert!(!root.join("notes/old.md").exists());
        assert_eq!(
            read_file("notes/new.md".into(), Some(root_text.clone())).unwrap(),
            "the assay holds"
        );

        // The name the reader asked for is taken; keeping what is there beats overwriting it.
        write_file(
            "notes/taken.md".into(),
            "keep me".into(),
            Some(root_text.clone()),
        )
        .unwrap();
        let taken = rename_file(
            "notes/new.md".into(),
            "notes/taken.md".into(),
            Some(root_text.clone()),
        )
        .unwrap_err();
        assert_eq!(taken.kind, "invalid");
        assert_eq!(
            read_file("notes/taken.md".into(), Some(root_text.clone())).unwrap(),
            "keep me"
        );

        let refused = rename_file(
            "notes/new.md".into(),
            "../outside.md".into(),
            Some(root_text.clone()),
        )
        .unwrap_err();
        assert_eq!(refused.kind, "invalid");
        assert!(root.join("notes/new.md").exists());
    }

    /// Removing a plan file, and removing one that is already gone.
    #[test]
    fn removes_a_file_inside_the_workspace() {
        let root = std::env::temp_dir().join(format!("openlab-remove-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let root_text = root.to_string_lossy().into_owned();
        write_file(
            ".openlab/plan/waves/001-x.md".into(),
            "---\n".into(),
            Some(root_text.clone()),
        )
        .unwrap();
        assert!(root.join(".openlab/plan/waves/001-x.md").exists());

        remove_file(
            ".openlab/plan/waves/001-x.md".into(),
            Some(root_text.clone()),
        )
        .unwrap();
        assert!(!root.join(".openlab/plan/waves/001-x.md").exists());
        // Absent is the state the caller asked for, so a second call is not a failure.
        remove_file(
            ".openlab/plan/waves/001-x.md".into(),
            Some(root_text.clone()),
        )
        .unwrap();

        let refused = remove_file("../outside.md".into(), Some(root_text)).unwrap_err();
        assert_eq!(refused.kind, "invalid");

        fs::remove_dir_all(&root).ok();
    }
}
