//! Workspace-scoped search.
//!
//! `glob` and `grep` are the two tools an agent leans on hardest, and both have the same
//! security shape: the model proposes a pattern, not a directory tree, so the search is
//! anchored to the workspace root and every result is checked to be inside it. A symlink that
//! points out of the root is skipped, not followed.
//!
//! Hidden directories, `node_modules` and `.git` are skipped by default: searching them is
//! almost never what was meant and it is where the cost is.

use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::error::CommandError;

/// Largest file `grep` will read. Bigger files are skipped rather than half-searched.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Most matches `grep` will return.
const MAX_MATCHES: usize = 200;

/// Directory names never descended into.
const SKIP_DIRS: [&str; 5] = [".git", "node_modules", "target", "dist", ".venv"];

/// Canonicalize the workspace root once, so containment is checked against the real path.
fn canonical_root(root: &str) -> Result<PathBuf, CommandError> {
    fs::canonicalize(root)
        .map_err(|e| CommandError::io(format!("could not open the workspace {root}: {e}")))
}

/// Join a path onto the root and confirm the result stays inside it.
fn within_root(path: &str, root: &Path) -> Option<PathBuf> {
    let candidate = Path::new(path);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    let resolved = fs::canonicalize(&joined).ok()?;
    resolved.starts_with(root).then_some(resolved)
}

/// Render a path relative to the root for display, falling back to the absolute path.
fn display_path(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

/// True when the walker should not enter this directory.
fn is_skipped(entry: &walkdir::DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .map(|name| SKIP_DIRS.contains(&name))
        .unwrap_or(false)
}

/// Find files by glob pattern, newest first, anchored to the workspace root.
#[tauri::command]
pub async fn glob_files(
    pattern: String,
    root: String,
    path: Option<String>,
) -> Result<Vec<String>, CommandError> {
    // Globbing stats every match on disk, so it runs off the main thread.
    tauri::async_runtime::spawn_blocking(move || glob_files_blocking(pattern, root, path))
        .await
        .map_err(|e| CommandError::new("search", format!("the glob task failed: {e}")))?
}

/// The blocking half of {@link glob_files}, kept off the main thread.
fn glob_files_blocking(
    pattern: String,
    root: String,
    path: Option<String>,
) -> Result<Vec<String>, CommandError> {
    let root = canonical_root(&root)?;
    let base = match path {
        Some(ref relative) => within_root(relative, &root)
            .ok_or_else(|| CommandError::invalid(format!("{relative} is outside the workspace")))?,
        None => root.clone(),
    };

    let full_pattern = if Path::new(&pattern).is_absolute() {
        pattern.clone()
    } else {
        base.join(&pattern).to_string_lossy().into_owned()
    };

    let mut matches: Vec<(std::time::SystemTime, String)> = Vec::new();
    let entries = glob::glob(&full_pattern)
        .map_err(|e| CommandError::invalid(format!("invalid glob pattern: {e}")))?;
    for entry in entries.flatten() {
        // A pattern can match a path outside the root through `..`; drop those rather than
        // returning a file the agent was never granted.
        if !entry.starts_with(&root) {
            continue;
        }
        if entry
            .components()
            .any(|c| SKIP_DIRS.contains(&c.as_os_str().to_str().unwrap_or("")))
        {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        matches.push((modified, display_path(&entry, &root)));
    }

    matches.sort_by_key(|a| std::cmp::Reverse(a.0));
    Ok(matches
        .into_iter()
        .take(MAX_MATCHES)
        .map(|(_, p)| p)
        .collect())
}

/// Search file contents by regular expression and return `path:line: text` rows.
#[tauri::command]
pub async fn grep_files(
    pattern: String,
    root: String,
    path: Option<String>,
    glob: Option<String>,
) -> Result<String, CommandError> {
    // Grep walks the tree and reads every candidate file, so it runs off the main thread.
    tauri::async_runtime::spawn_blocking(move || grep_files_blocking(pattern, root, path, glob))
        .await
        .map_err(|e| CommandError::new("search", format!("the grep task failed: {e}")))?
}

/// The blocking half of {@link grep_files}, kept off the main thread.
fn grep_files_blocking(
    pattern: String,
    root: String,
    path: Option<String>,
    glob: Option<String>,
) -> Result<String, CommandError> {
    let root = canonical_root(&root)?;
    let base = match path {
        Some(ref relative) => within_root(relative, &root)
            .ok_or_else(|| CommandError::invalid(format!("{relative} is outside the workspace")))?,
        None => root.clone(),
    };
    let regex = regex::Regex::new(&pattern)
        .map_err(|e| CommandError::invalid(format!("invalid regular expression: {e}")))?;

    let mut rows: Vec<String> = Vec::new();
    let walker = WalkDir::new(&base)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Never descend into the skip list, and never follow a symlink out of the root.
            if is_skipped(e) {
                return false;
            }
            if e.path().is_symlink() {
                return e.path().starts_with(&root);
            }
            true
        });

    for entry in walker.flatten() {
        if rows.len() >= MAX_MATCHES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let file_path = entry.path();
        if !file_path.starts_with(&root) {
            continue;
        }
        if let Some(glob_pattern) = &glob {
            let name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !glob_matches(glob_pattern, name) {
                continue;
            }
        }
        let metadata = match entry.metadata() {
            Ok(metadata) if metadata.len() <= MAX_FILE_BYTES => metadata,
            _ => continue,
        };
        let _ = metadata;
        let text = match fs::read_to_string(file_path) {
            Ok(text) => text,
            // A binary or non-UTF-8 file is skipped, not an error.
            Err(_) => continue,
        };
        let relative = display_path(file_path, &root);
        for (number, line) in text.lines().enumerate() {
            if regex.is_match(line) {
                rows.push(format!("{relative}:{}: {}", number + 1, line.trim()));
                if rows.len() >= MAX_MATCHES {
                    break;
                }
            }
        }
    }

    if rows.is_empty() {
        return Ok(String::new());
    }
    if rows.len() >= MAX_MATCHES {
        rows.push(format!(
            "… more than {MAX_MATCHES} matches; narrow the pattern"
        ));
    }
    Ok(rows.join("\n"))
}

/// Match a filename against a simple glob, supporting `*` and `?`.
fn glob_matches(pattern: &str, name: &str) -> bool {
    fn helper(pattern: &[u8], name: &[u8]) -> bool {
        match pattern {
            [] => name.is_empty(),
            [b'*', rest @ ..] => {
                helper(rest, name) || (!name.is_empty() && helper(pattern, &name[1..]))
            }
            [b'?', rest @ ..] => !name.is_empty() && helper(rest, &name[1..]),
            [ch, rest @ ..] => name.first() == Some(ch) && helper(rest, &name[1..]),
        }
    }
    helper(pattern.as_bytes(), name.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_globs_match() {
        assert!(glob_matches("*.rs", "main.rs"));
        assert!(glob_matches("*.rs", "main.rs"));
        assert!(!glob_matches("*.rs", "main.ts"));
        assert!(glob_matches("test_?.py", "test_1.py"));
        assert!(!glob_matches("test_?.py", "test_12.py"));
        assert!(glob_matches("*", "anything"));
    }

    /// The plan reader depends on `**` reaching a nested folder *and* the folder's own
    /// files, so the pattern `.openlab/plan/**/*.md` has to match both.
    #[test]
    fn a_double_star_globs_the_folder_and_what_is_under_it() {
        let root = std::env::temp_dir().join(format!("openlab-glob-{}", std::process::id()));
        fs::create_dir_all(root.join(".openlab/plan/waves")).unwrap();
        fs::write(root.join(".openlab/plan/backlog.md"), b"# Backlog\n").unwrap();
        fs::write(root.join(".openlab/plan/waves/003-x.md"), b"# W3\n").unwrap();
        fs::write(root.join(".openlab/plan/notes.txt"), b"ignored\n").unwrap();

        let found = glob_files_blocking(
            ".openlab/plan/**/*.md".into(),
            root.to_string_lossy().into_owned(),
            None,
        )
        .unwrap();
        let mut sorted = found.clone();
        sorted.sort();
        assert_eq!(
            sorted,
            vec![
                ".openlab/plan/backlog.md".to_string(),
                ".openlab/plan/waves/003-x.md".to_string()
            ]
        );

        fs::remove_dir_all(&root).ok();
    }
}
