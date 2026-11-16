//! Tauri command surface.
//!
//! Each module owns one concern; `lib.rs` only registers them. Commands are thin:
//! they validate, delegate, and map failures into [`crate::error::CommandError`].

pub mod chat;
pub mod cloud;
pub mod db;
pub mod engine;
pub mod exec;
pub mod execution;
pub mod git;
pub mod guard;
pub mod mcp;
pub mod oauth;
pub mod proxy;
pub mod scan;
pub mod search;
pub mod secrets;
pub mod services;
pub mod system;
pub mod vectors;
pub mod workspace;
