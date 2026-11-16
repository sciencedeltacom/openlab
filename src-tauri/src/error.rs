//! Error type shared by every Tauri command.
//!
//! Commands never panic: a failure crosses the IPC boundary as a serialisable
//! `{ kind, message }` pair so the UI can branch on `kind` and show `message`
//! to the user without parsing a string.

use serde::Serialize;

/// A command failure that is safe to show a user.
#[derive(Debug, Serialize)]
pub struct CommandError {
    /// Stable machine-readable category, e.g. `"io"`, `"git"`, `"not-found"`.
    pub kind: &'static str,
    /// Human-readable explanation. Never contains secrets.
    pub message: String,
}

impl CommandError {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// The operating system refused the operation (permissions, missing path).
    pub fn io(message: impl Into<String>) -> Self {
        Self::new("io", message)
    }

    /// A `git` invocation failed or returned an unexpected shape.
    pub fn git(message: impl Into<String>) -> Self {
        Self::new("git", message)
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid", message)
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

impl std::error::Error for CommandError {}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        CommandError::io(error.to_string())
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(error: serde_json::Error) -> Self {
        CommandError::new("json", error.to_string())
    }
}
