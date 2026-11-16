//! Git integration.
//!
//! Shelling out to the user's own `git` rather than linking libgit2 keeps the build
//! small and means whatever the user has configured (hooks, credential helpers,
//! `core.autocrlf`, LFS) behaves exactly as it does in their terminal.
//!
//! Status is parsed from `--porcelain=v1 -z`: NUL-delimited, never localised, and
//! the only status format that survives paths containing spaces or newlines.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

use crate::error::CommandError;

/// Repository identity and position.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub is_repo: bool,
    /// Absolute path to the work tree root, when inside a repository.
    pub root: Option<String>,
    /// Branch name, or `None` when HEAD is detached.
    pub branch: Option<String>,
    pub ahead: i32,
    pub behind: i32,
}

/// One changed path.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    /// Index status character (`M`, `A`, `D`, `R`, `?`, ` `).
    pub index: String,
    /// Work-tree status character.
    pub worktree: String,
    /// True when the staged copy differs from HEAD.
    pub staged: bool,
    /// Original path for renames and copies.
    pub original_path: Option<String>,
}

/// Everything the Git panel needs in one round trip.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub info: GitInfo,
    pub files: Vec<GitFileStatus>,
}

/// Run `git` in `cwd` and return stdout, or a `git`-kinded error carrying stderr.
fn git(cwd: &str, args: &[&str]) -> Result<String, CommandError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        // Keep output stable regardless of the user's language and pager.
        .env("GIT_PAGER", "cat")
        .env("LC_ALL", "C")
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                CommandError::git("git was not found on PATH")
            } else {
                CommandError::git(format!("could not run git: {e}"))
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(CommandError::git(if stderr.is_empty() {
            format!("git {} failed with {}", args.join(" "), output.status)
        } else {
            stderr
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn ensure_dir(cwd: &str) -> Result<(), CommandError> {
    if !Path::new(cwd).is_dir() {
        return Err(CommandError::invalid(format!("{cwd} is not a directory")));
    }
    Ok(())
}

/// Repository identity, ahead/behind counts and branch for `cwd`.
///
/// Not a command of its own: it blocks on `git`, so [`git_status`] reaches it from the blocking
/// thread rather than the UI thread.
fn git_info(cwd: String) -> Result<GitInfo, CommandError> {
    ensure_dir(&cwd)?;

    if git(&cwd, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(GitInfo {
            is_repo: false,
            root: None,
            branch: None,
            ahead: 0,
            behind: 0,
        });
    }

    let root = git(&cwd, &["rev-parse", "--show-toplevel"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    // `--abbrev-ref HEAD` prints "HEAD" when detached, which is not a branch name.
    let branch = git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "HEAD");

    let (mut ahead, mut behind) = (0, 0);
    if branch.is_some() {
        if let Ok(counts) = git(
            &cwd,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        ) {
            let mut parts = counts.split_whitespace();
            if let (Some(a), Some(b)) = (parts.next(), parts.next()) {
                ahead = a.parse().unwrap_or(0);
                behind = b.parse().unwrap_or(0);
            }
        }
    }

    Ok(GitInfo {
        is_repo: true,
        root,
        branch,
        ahead,
        behind,
    })
}

/// Working tree status. Untracked files are expanded so the tree shows real paths.
#[tauri::command]
pub async fn git_status(cwd: String) -> Result<GitStatus, CommandError> {
    // `git status` runs a child process and walks the tree, so it must not hold the main thread.
    tauri::async_runtime::spawn_blocking(move || git_status_blocking(cwd))
        .await
        .map_err(|e| CommandError::new("git", format!("the git status task failed: {e}")))?
}

/// The blocking half of {@link git_status}, kept off the main thread.
fn git_status_blocking(cwd: String) -> Result<GitStatus, CommandError> {
    let info = git_info(cwd.clone())?;
    if !info.is_repo {
        return Ok(GitStatus {
            info,
            files: Vec::new(),
        });
    }

    let raw = git(
        &cwd,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;

    Ok(GitStatus {
        info,
        files: parse_porcelain(&raw),
    })
}

/// Parse `git status --porcelain=v1 -z` output.
///
/// The `-z` form is NUL-delimited and never quoted, which is the only status format that
/// survives paths containing spaces, quotes or newlines. Rename and copy entries carry a
/// second NUL-delimited record holding the original path, so this consumes records in
/// pairs rather than mapping one record to one file.
pub fn parse_porcelain(raw: &str) -> Vec<GitFileStatus> {
    let mut files = Vec::new();
    let mut chunks = raw.split('\0').filter(|chunk| !chunk.is_empty());

    while let Some(chunk) = chunks.next() {
        // Two status characters, a space, then the path.
        if chunk.len() < 3 {
            continue;
        }
        let bytes = chunk.as_bytes();
        let index = (bytes[0] as char).to_string();
        let worktree = (bytes[1] as char).to_string();
        let path = chunk[2..].trim_start_matches(' ').to_string();

        // `R` (renamed) and `C` (copied) are followed by the original path.
        let carries_origin =
            matches!(index.as_str(), "R" | "C") || matches!(worktree.as_str(), "R" | "C");
        let original_path = if carries_origin {
            chunks.next().map(str::to_string)
        } else {
            None
        };

        files.push(GitFileStatus {
            staged: index != " " && index != "?",
            index,
            worktree,
            path,
            original_path,
        });
    }

    files
}

/// Stage the given paths.
#[tauri::command]
pub async fn git_stage(cwd: String, paths: Vec<String>) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || git_stage_blocking(cwd, paths))
        .await
        .map_err(|e| CommandError::new("git", format!("the git stage task failed: {e}")))?
}

/// The blocking half of {@link git_stage}, kept off the main thread.
fn git_stage_blocking(cwd: String, paths: Vec<String>) -> Result<(), CommandError> {
    ensure_dir(&cwd)?;
    let mut args = vec!["add", "--"];
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    args.extend(refs);
    git(&cwd, &args).map(|_| ())
}

/// Unstage the given paths, restoring the index entry from HEAD.
#[tauri::command]
pub async fn git_unstage(cwd: String, paths: Vec<String>) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || git_unstage_blocking(cwd, paths))
        .await
        .map_err(|e| CommandError::new("git", format!("the git unstage task failed: {e}")))?
}

/// The blocking half of {@link git_unstage}, kept off the main thread.
fn git_unstage_blocking(cwd: String, paths: Vec<String>) -> Result<(), CommandError> {
    ensure_dir(&cwd)?;
    let mut args = vec!["restore", "--staged", "--"];
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    args.extend(refs);
    git(&cwd, &args).map(|_| ())
}

/// Stage everything and commit. Returns the short hash of the new commit.
#[tauri::command]
pub async fn git_commit(
    cwd: String,
    message: String,
    add_all: bool,
) -> Result<String, CommandError> {
    tauri::async_runtime::spawn_blocking(move || git_commit_blocking(cwd, message, add_all))
        .await
        .map_err(|e| CommandError::new("git", format!("the git commit task failed: {e}")))?
}

/// The blocking half of {@link git_commit}, kept off the main thread.
fn git_commit_blocking(
    cwd: String,
    message: String,
    add_all: bool,
) -> Result<String, CommandError> {
    ensure_dir(&cwd)?;
    if message.trim().is_empty() {
        return Err(CommandError::invalid("a commit message is required"));
    }
    if add_all {
        git(&cwd, &["add", "-A"])?;
    }
    git(&cwd, &["commit", "-m", message.trim()])?;
    git(&cwd, &["rev-parse", "--short", "HEAD"]).map(|hash| hash.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build `-z` output: records separated by NUL, which is what git emits.
    fn z(records: &[&str]) -> String {
        records.join("\0") + "\0"
    }

    #[test]
    fn parses_a_modified_unstaged_file() {
        let files = parse_porcelain(&z(&[" M src/lib.rs"]));
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].index, " ");
        assert_eq!(files[0].worktree, "M");
        assert!(!files[0].staged);
        assert_eq!(files[0].path, "src/lib.rs");
        assert!(files[0].original_path.is_none());
    }

    #[test]
    fn parses_a_staged_addition() {
        let files = parse_porcelain(&z(&["A  new.txt"]));
        assert_eq!(files[0].index, "A");
        assert!(files[0].staged);
        assert_eq!(files[0].path, "new.txt");
    }

    #[test]
    fn a_file_can_be_both_staged_and_modified() {
        let files = parse_porcelain(&z(&["MM both.txt"]));
        assert_eq!(files[0].index, "M");
        assert_eq!(files[0].worktree, "M");
        assert!(files[0].staged);
    }

    #[test]
    fn parses_an_untracked_file() {
        let files = parse_porcelain(&z(&["?? scratch/"]));
        assert_eq!(files[0].index, "?");
        assert!(!files[0].staged);
        assert_eq!(files[0].path, "scratch/");
    }

    #[test]
    fn keeps_spaces_in_paths() {
        // The whole reason for `-z`: a path with a space must survive intact.
        let files = parse_porcelain(&z(&[" M docs/my paper.md"]));
        assert_eq!(files[0].path, "docs/my paper.md");
    }

    #[test]
    fn consumes_the_origin_record_of_a_rename() {
        let files = parse_porcelain(&z(&["R  new/name.rs", "old/name.rs"]));
        assert_eq!(
            files.len(),
            1,
            "the origin record must not become its own file"
        );
        assert_eq!(files[0].index, "R");
        assert_eq!(files[0].path, "new/name.rs");
        assert_eq!(files[0].original_path.as_deref(), Some("old/name.rs"));
    }

    #[test]
    fn a_rename_does_not_swallow_the_next_file() {
        let files = parse_porcelain(&z(&["R  b.rs", "a.rs", " M c.rs"]));
        assert_eq!(files.len(), 2);
        assert_eq!(files[1].path, "c.rs");
        assert!(files[1].original_path.is_none());
    }

    #[test]
    fn parses_a_whole_working_tree() {
        let files = parse_porcelain(&z(&[
            " M src/a.rs",
            "A  src/b.rs",
            "?? notes.md",
            "D  gone.rs",
            "R  moved.rs",
            "was/moved.rs",
        ]));
        assert_eq!(files.len(), 5);
        assert_eq!(
            files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(),
            ["src/a.rs", "src/b.rs", "notes.md", "gone.rs", "moved.rs"]
        );
        // ` M` is a work-tree modification only; `A`, `D` and `R` are staged.
        assert_eq!(files.iter().filter(|f| f.staged).count(), 3);
    }

    #[test]
    fn ignores_trailing_and_empty_records() {
        assert!(parse_porcelain("").is_empty());
        assert!(parse_porcelain("\0\0").is_empty());
        // A truncated record is dropped rather than panicking on the slice.
        assert!(parse_porcelain("M").is_empty());
    }
}
