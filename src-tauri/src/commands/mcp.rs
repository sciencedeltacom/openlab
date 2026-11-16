//! A minimal MCP client over stdio.
//!
//! One server, started deliberately: **Serena**, the semantic coding toolkit. The workbench
//! spawns it as a child process and speaks newline-delimited JSON-RPC to it, the same way any
//! MCP client does. The webview never chooses the binary or the arguments — a small allowlist
//! does — so a tool call cannot become "run anything".
//!
//! The shape is deliberately small: start, stop, status, list tools, call one tool. That is
//! what an agent needs, and every extra feature here would be a second way to run a process.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::error::CommandError;

/// The servers this build can start, and what each needs.
///
/// The list is the boundary: the webview names one of these ids, never a command. `npx`-based
/// servers run in the workspace; Serena is pointed at the project with `--project`.
struct ServerSpec {
    id: &'static str,
    /// The program to run. Resolved through the user-level install directories, because a
    /// window opened from Finder has a minimal `PATH`.
    command: &'static str,
    /// How the program is told to serve MCP.
    args: fn(&str) -> Vec<String>,
    /// True when the server should run with the workspace as its working directory.
    cwd_is_workspace: bool,
    /// What has to exist on the machine, as a line the reader can act on.
    requires: &'static str,
    /// The command that installs it, when this build can offer one.
    install: Option<&'static str>,
}

/// Serena: semantic code reading and editing.
fn serena_args(root: &str) -> Vec<String> {
    vec![
        "start-mcp-server".into(),
        "--context".into(),
        "ide-assistant".into(),
        "--project".into(),
        root.into(),
        "--transport".into(),
        "stdio".into(),
        "--enable-web-dashboard".into(),
        "false".into(),
    ]
}

/// Delphi: local search over code, papers and datasets.
fn npx_args(package: &str) -> Vec<String> {
    vec!["-y".into(), package.into()]
}

/// The catalogue of startable servers.
const SERVERS: [ServerSpec; 3] = [
    ServerSpec {
        id: "serena",
        command: "serena",
        args: serena_args,
        cwd_is_workspace: false,
        requires: "the Serena CLI (uv tool install --from git+https://github.com/oraios/serena serena-agent)",
        install: Some("uv tool install --from git+https://github.com/oraios/serena serena-agent"),
    },
    ServerSpec {
        id: "delphi",
        command: "npx",
        args: |_root| npx_args("@synsci/delphi-proxy"),
        cwd_is_workspace: true,
        requires: "Node.js and Docker for the index stack",
        install: None,
    },
    ServerSpec {
        id: "zotero",
        command: "npx",
        args: |_root| npx_args("zotero-mcp"),
        cwd_is_workspace: true,
        requires: "Node.js and a Zotero API key in the environment",
        install: None,
    },
];

/// The spec for an id, or an error naming what this build can start.
fn spec_for(server: &str) -> Result<&'static ServerSpec, CommandError> {
    SERVERS
        .iter()
        .find(|spec| spec.id == server)
        .ok_or_else(|| {
            mcp_error(format!(
                "`{server}` is not a server this build starts. It starts: {}.",
                SERVERS
                    .iter()
                    .map(|spec| spec.id)
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })
}

/// How long `initialize` may take. Serena may download language-server dependencies on its
/// first run, so this is generous; every later start is fast.
const INIT_TIMEOUT: Duration = Duration::from_secs(240);

/// How long one tool call may take.
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// The tail of a server's stderr kept for diagnostics.
const STDERR_TAIL: usize = 4_000;

/// Where each in-flight request's answer goes.
#[derive(Default)]
struct Pending {
    waiters: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
}

/// A running server.
struct Server {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Pending>,
    next_id: AtomicU64,
    tools: Mutex<Vec<Value>>,
    stderr_tail: Arc<Mutex<String>>,
}

/// Every server this process started.
#[derive(Default)]
pub struct Mcp {
    servers: Mutex<HashMap<String, Arc<Server>>>,
}

/// One server's state, as the interface reads it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub server: String,
    pub running: bool,
    /// The tool names the server offers, once it is running.
    pub tools: Vec<String>,
    /// Where the binary was found, so a missing install is a fact rather than a guess.
    pub binary: Option<String>,
    /// The command that installs it, when this build can offer one.
    pub install: Option<String>,
    /// What the machine has to have for it to run.
    pub requires: String,
    /// The tail of the server's own error output, when it failed.
    pub error: Option<String>,
}

/// The result of one tool call.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallResult {
    pub text: String,
    pub is_error: bool,
}

/// Where a program is, if it is installed.
///
/// A window opened from Finder has a minimal `PATH`, so the usual user-level install
/// directories are searched before the environment.
fn find_binary(name: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(&home).join(".local/bin").join(name));
        // npx often lives beside a node installed with a version manager.
        candidates.push(
            PathBuf::from(&home)
                .join(".local/share/mise/shims")
                .join(name),
        );
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin").join(name));
    candidates.push(PathBuf::from("/usr/local/bin").join(name));
    candidates.push(PathBuf::from("/usr/bin").join(name));
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .or_else(|| {
            std::env::var_os("PATH").and_then(|path| {
                std::env::split_paths(&path)
                    .map(|dir| dir.join(name))
                    .find(|candidate| candidate.is_file())
            })
        })
}

/// Read the child's stderr into a bounded tail, so a failure can say what happened.
fn drain_stderr(mut stderr: impl Read + Send + 'static, tail: Arc<Mutex<String>>) {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match stderr.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if let Ok(mut kept) = tail.lock() {
                        kept.push_str(&String::from_utf8_lossy(&buffer[..read]));
                        if kept.len() > STDERR_TAIL {
                            let cut = kept.len() - STDERR_TAIL;
                            *kept = kept[cut..].to_string();
                        }
                    }
                }
            }
        }
    });
}

/// Read the child's stdout, routing each answer to the request that is waiting for it.
fn drain_stdout(stdout: impl Read + Send + 'static, pending: Arc<Pending>) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            // A response carries an id and no method; anything else is a notification.
            if message.get("method").is_some() {
                continue;
            }
            let Some(id) = message.get("id").and_then(Value::as_u64) else {
                continue;
            };
            if let Ok(mut waiters) = pending.waiters.lock() {
                if let Some(sender) = waiters.remove(&id) {
                    let _ = sender.send(message);
                }
            }
        }
        // The process ended: every waiter gets an error rather than hanging.
        if let Ok(mut waiters) = pending.waiters.lock() {
            waiters.clear();
        }
    });
}

/// Send one request and wait for its answer.
fn request(
    server: &Server,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, CommandError> {
    let id = server.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let (sender, receiver) = mpsc::channel();
    server
        .pending
        .waiters
        .lock()
        .map_err(|_| mcp_error("the request table is poisoned"))?
        .insert(id, sender);

    let line = serde_json::to_string(&json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    }))?;
    {
        let mut stdin = server
            .stdin
            .lock()
            .map_err(|_| mcp_error("the server's input is poisoned"))?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| mcp_error(format!("could not write to the server: {e}")))?;
    }

    let message = receiver.recv_timeout(timeout).map_err(|_| {
        if let Ok(mut waiters) = server.pending.waiters.lock() {
            waiters.remove(&id);
        }
        let tail = server
            .stderr_tail
            .lock()
            .map(|text| text.clone())
            .unwrap_or_default();
        mcp_error(format!(
            "{method} did not answer within {}s{}",
            timeout.as_secs(),
            if tail.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", tail.trim())
            }
        ))
    })?;

    if let Some(error) = message.get("error") {
        return Err(mcp_error(format!(
            "{method} failed: {}",
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
        )));
    }
    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

fn mcp_error(message: impl Into<String>) -> CommandError {
    CommandError::new("mcp", message.into())
}

/// The tool names a `tools/list` answer carries.
fn tool_names(tools: &[Value]) -> Vec<String> {
    tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_string))
        .collect()
}

/// Start one process and finish the handshake, returning it with the tools it offers.
async fn spawn(
    spec: &ServerSpec,
    binary: &PathBuf,
    root: &str,
) -> Result<Arc<Server>, CommandError> {
    let mut command = Command::new(binary);
    command.args((spec.args)(root));
    if spec.cwd_is_workspace && !root.trim().is_empty() {
        command.current_dir(root);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| mcp_error(format!("could not start Serena: {e}")))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| mcp_error("Serena has no input pipe"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| mcp_error("Serena has no output pipe"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| mcp_error("Serena has no error pipe"))?;

    let pending = Arc::new(Pending::default());
    let stderr_tail = Arc::new(Mutex::new(String::new()));
    drain_stdout(stdout, pending.clone());
    drain_stderr(stderr, stderr_tail.clone());

    let running = Arc::new(Server {
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        pending,
        next_id: AtomicU64::new(0),
        tools: Mutex::new(Vec::new()),
        stderr_tail,
    });

    let handshake = {
        let running = running.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<Vec<Value>, CommandError> {
            request(
                &running,
                "initialize",
                json!({
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": { "name": "openlab", "version": env!("CARGO_PKG_VERSION") },
                }),
                INIT_TIMEOUT,
            )?;
            // The notification has no answer; it tells the server the handshake is done.
            let line = serde_json::to_string(&json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {},
            }))?;
            {
                let mut stdin = running
                    .stdin
                    .lock()
                    .map_err(|_| mcp_error("the server's input is poisoned"))?;
                stdin
                    .write_all(line.as_bytes())
                    .and_then(|_| stdin.write_all(b"\n"))
                    .and_then(|_| stdin.flush())
                    .map_err(|e| mcp_error(format!("could not write to the server: {e}")))?;
            }
            let listed = request(&running, "tools/list", json!({}), CALL_TIMEOUT)?;
            Ok(listed
                .get("tools")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default())
        })
        .await
        .map_err(|e| mcp_error(format!("the Serena start task failed: {e}")))?
    };

    match handshake {
        Ok(tools) => {
            if let Ok(mut stored) = running.tools.lock() {
                *stored = tools;
            }
            Ok(running)
        }
        Err(error) => {
            // A server that failed to start must not be left running.
            if let Ok(mut child) = running.child.lock() {
                let _ = child.kill();
            }
            let tail = running
                .stderr_tail
                .lock()
                .map(|text| text.clone())
                .unwrap_or_default();
            Err(mcp_error(format!(
                "{}{}",
                error.message,
                if tail.trim().is_empty() {
                    String::new()
                } else {
                    format!(": {}", tail.trim())
                }
            )))
        }
    }
}

/// Start one of the servers this build knows, against a workspace.
#[tauri::command]
pub async fn mcp_start(
    state: tauri::State<'_, Mcp>,
    server: String,
    root: String,
) -> Result<McpStatus, CommandError> {
    let spec = spec_for(&server)?;
    if root.trim().is_empty() {
        return Err(mcp_error(format!(
            "{} needs a workspace folder to run against",
            spec.id
        )));
    }
    {
        let servers = state
            .servers
            .lock()
            .map_err(|_| mcp_error("the server table is poisoned"))?;
        if let Some(running) = servers.get(&server) {
            let names = tool_names(
                &running
                    .tools
                    .lock()
                    .map(|tools| tools.clone())
                    .unwrap_or_default(),
            );
            return Ok(McpStatus {
                server,
                running: true,
                tools: names,
                binary: None,
                install: spec.install.map(str::to_string),
                requires: spec.requires.to_string(),
                error: None,
            });
        }
    }

    let binary = find_binary(spec.command)
        .ok_or_else(|| mcp_error(format!("{} is not installed: {}", spec.id, spec.requires)))?;

    let binary_for_error = binary.clone();
    let running = spawn(spec, &binary, &root).await?;
    let tools = running
        .tools
        .lock()
        .map(|tools| tools.clone())
        .unwrap_or_default();

    let names = tool_names(&tools);
    state
        .servers
        .lock()
        .map_err(|_| mcp_error("the server table is poisoned"))?
        .insert(server.clone(), running);

    Ok(McpStatus {
        server,
        running: true,
        tools: names,
        binary: Some(binary_for_error.to_string_lossy().into_owned()),
        install: spec.install.map(str::to_string),
        requires: spec.requires.to_string(),
        error: None,
    })
}

/// Install a server this build knows how to install.
///
/// Only Serena has a command this build can run; the others come with their own package
/// manager, and the error says which. The install runs the fixed command in `requires`, not
/// anything the caller sends.
#[tauri::command]
pub async fn mcp_install(server: String) -> Result<String, CommandError> {
    let spec = spec_for(&server)?;
    let Some(install) = spec.install else {
        return Err(mcp_error(format!(
            "{} is installed with its own package manager: {}",
            spec.id, spec.requires
        )));
    };
    let mut parts = install.split_whitespace();
    let program = parts
        .next()
        .ok_or_else(|| mcp_error("the install command is empty"))?;
    let args: Vec<String> = parts.map(str::to_string).collect();
    let binary = find_binary(program).ok_or_else(|| {
        mcp_error(format!(
            "{program} is not installed; install it, then try again"
        ))
    })?;

    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new(binary)
            .args(args)
            .output()
            .map_err(|e| mcp_error(format!("could not run the installer: {e}")))
    })
    .await
    .map_err(|e| mcp_error(format!("the install task failed: {e}")))??;

    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    let tail: String = {
        let trimmed = text.trim();
        let start = trimmed.len().saturating_sub(2_000);
        trimmed[start..].to_string()
    };
    if !output.status.success() {
        return Err(mcp_error(format!("the installer failed: {tail}")));
    }
    Ok(tail)
}

/// Stop a server this process started.
#[tauri::command]
pub fn mcp_stop(state: tauri::State<'_, Mcp>, server: String) -> Result<(), CommandError> {
    let running = state
        .servers
        .lock()
        .map_err(|_| mcp_error("the server table is poisoned"))?
        .remove(&server);
    if let Some(running) = running {
        if let Ok(mut child) = running.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}

/// What is running, and where the binary was found.
#[tauri::command]
pub fn mcp_status(state: tauri::State<'_, Mcp>) -> Result<Vec<McpStatus>, CommandError> {
    let servers = state
        .servers
        .lock()
        .map_err(|_| mcp_error("the server table is poisoned"))?;
    Ok(SERVERS
        .iter()
        .map(|spec| {
            let running = servers.get(spec.id);
            McpStatus {
                server: spec.id.to_string(),
                running: running.is_some(),
                tools: running
                    .and_then(|running| running.tools.lock().ok().map(|tools| tool_names(&tools)))
                    .unwrap_or_default(),
                binary: find_binary(spec.command).map(|path| path.to_string_lossy().into_owned()),
                install: spec.install.map(str::to_string),
                requires: spec.requires.to_string(),
                error: None,
            }
        })
        .collect())
}

/// The tools one server offers, with the schema the model needs to call them.
#[tauri::command]
pub fn mcp_list_tools(
    state: tauri::State<'_, Mcp>,
    server: String,
) -> Result<Vec<Value>, CommandError> {
    let servers = state
        .servers
        .lock()
        .map_err(|_| mcp_error("the server table is poisoned"))?;
    let running = servers
        .get(&server)
        .ok_or_else(|| mcp_error(format!("{server} is not running")))?;
    Ok(running
        .tools
        .lock()
        .map(|tools| tools.clone())
        .unwrap_or_default())
}

/// Call one tool.
#[tauri::command]
pub async fn mcp_call(
    state: tauri::State<'_, Mcp>,
    server: String,
    tool: String,
    arguments: Value,
) -> Result<McpCallResult, CommandError> {
    let running = {
        let servers = state
            .servers
            .lock()
            .map_err(|_| mcp_error("the server table is poisoned"))?;
        servers
            .get(&server)
            .cloned()
            .ok_or_else(|| mcp_error(format!("{server} is not running")))
    }?;

    let answer = tauri::async_runtime::spawn_blocking(move || {
        request(
            &running,
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
            CALL_TIMEOUT,
        )
    })
    .await
    .map_err(|e| mcp_error(format!("the tool call task failed: {e}")))??;

    let is_error = answer
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let text = answer
        .get("content")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| match part.get("type").and_then(Value::as_str) {
                    Some("text") => part.get("text").and_then(Value::as_str).map(str::to_string),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| {
            if is_error {
                "The tool reported an error with no message.".into()
            } else {
                "The tool returned nothing.".into()
            }
        });

    Ok(McpCallResult { text, is_error })
}

/// Stop every server when the app goes away, so none is left orphaned.
pub fn on_stop(app: &AppHandle) {
    use tauri::Manager;
    let state = app.state::<Mcp>();
    let mut servers = match state.servers.lock() {
        Ok(servers) => servers,
        Err(_) => return,
    };
    for (_, running) in servers.drain() {
        if let Ok(mut child) = running.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serena_is_started_with_a_fixed_shape() {
        let args = (SERVERS[0].args)("/tmp/lab");
        assert_eq!(args[0], "start-mcp-server");
        assert!(args.contains(&"--project".to_string()));
        assert!(args.contains(&"/tmp/lab".to_string()));
        assert!(args.contains(&"stdio".to_string()));
        assert!(args.contains(&"false".to_string()));
    }

    #[test]
    fn tool_names_skip_anything_without_one() {
        let tools = json!([{ "name": "find_symbol" }, { "description": "no name" }]);
        assert_eq!(tool_names(tools.as_array().unwrap()), vec!["find_symbol"]);
    }

    /// Starts a real Serena process. Run with `cargo test -- --ignored` where it is installed.
    #[test]
    #[ignore = "starts a real Serena process"]
    fn starts_serena_and_lists_tools() {
        let root = std::env::temp_dir().join(format!("openlab-serena-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let spec = spec_for("serena").unwrap();
        let binary = find_binary(spec.command).expect("serena is installed");
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let running = runtime
            .block_on(spawn(spec, &binary, root.to_string_lossy().as_ref()))
            .expect("serena starts");
        let names = tool_names(&running.tools.lock().unwrap());
        assert!(
            names.iter().any(|name| name == "find_symbol"),
            "tools: {names:?}"
        );
        assert!(
            names.iter().any(|name| name == "replace_symbol_body"),
            "tools: {names:?}"
        );
        if let Ok(mut child) = running.child.lock() {
            let _ = child.kill();
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn install_is_only_offered_where_a_command_exists() {
        // OHDSI is an HTTP endpoint and has no install command; an unknown id is refused
        // before anything runs. Neither path touches the network.
        assert!(mcp_install("ohdsi".into()).await.is_err());
        assert!(mcp_install("not-a-server".into()).await.is_err());
    }

    #[test]
    fn only_a_listed_server_can_be_started() {
        assert!(spec_for("serena").is_ok());
        assert!(spec_for("delphi").is_ok());
        assert!(spec_for("rm -rf /").is_err());
    }
}
