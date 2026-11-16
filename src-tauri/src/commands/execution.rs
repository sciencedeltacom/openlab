//! Where a command runs.
//!
//! Three modes, one shape. A command is either run as the user on this machine (`host`), in a
//! kernel sandbox that shares the machine but not the filesystem or the network (`sandbox`), or
//! inside an OCI container with its own image and limits (`container`).
//!
//! Nothing here implements an isolation primitive itself: `bubblewrap`, macOS `sandbox-exec`,
//! `docker` and `podman` do. This module only decides which one to ask, builds the argv, and
//! refuses a configuration that cannot be honoured. Building the argv rather than a shell line
//! is deliberate — every value stays one argument, so a path or an image name cannot smuggle a
//! second command.
//!
//! The user's permission decision still happens before this layer. A sandbox is protection
//! against an accident or a prompt injection, not a replacement for asking.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::CommandError;

/// Where a command runs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionMode {
    /// As the user, in the workspace. The historical behaviour.
    #[default]
    Host,
    /// Same kernel, bounded filesystem and network.
    Sandbox,
    /// An OCI container.
    Container,
}

/// Which container runtime to use.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ContainerEngine {
    #[default]
    Auto,
    Docker,
    Podman,
}

/// When an image may be pulled.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PullPolicy {
    /// Pull only when the image is not present.
    #[default]
    Missing,
    Always,
    Never,
}

/// The sandbox's knobs. Defaults are the safe ones: no network, no extra paths.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SandboxConfig {
    /// Let the command reach the network. Off by default.
    pub network: bool,
    /// Host paths mounted read-only in addition to the system.
    pub read_paths: Vec<String>,
    /// Host paths mounted read-write in addition to the workspace.
    pub write_paths: Vec<String>,
    /// Environment variables set inside the sandbox.
    pub env: HashMap<String, String>,
    /// Keep `/tmp` across commands instead of a private tmpfs.
    pub keep_tmp: bool,
}

/// The container's knobs. A container is close to a small machine, so there are more of them.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContainerConfig {
    pub engine: ContainerEngine,
    /// The image a command runs in. Required: there is no "pick something for me".
    pub image: String,
    /// Give the container a network. Off by default.
    pub network: bool,
    /// Memory ceiling in MiB.
    pub memory_mb: u32,
    /// CPU ceiling, in cores.
    pub cpus: f32,
    /// Process ceiling; stops a fork bomb from taking the machine.
    pub pids_limit: u32,
    /// Read-only root filesystem; the workspace and `/tmp` are still writable.
    pub read_only_root: bool,
    pub pull: PullPolicy,
    /// Extra binds, in `host:container[:ro]` form.
    pub mounts: Vec<String>,
    /// Environment variables set inside the container.
    pub env: HashMap<String, String>,
}

impl Default for ContainerConfig {
    fn default() -> Self {
        Self {
            engine: ContainerEngine::Auto,
            // A small, predictable default. A user who needs SciPy or R changes it once.
            image: "python:3.12-slim".to_string(),
            network: false,
            memory_mb: 4096,
            cpus: 2.0,
            pids_limit: 512,
            read_only_root: true,
            pull: PullPolicy::Missing,
            mounts: Vec::new(),
            env: HashMap::new(),
        }
    }
}

/// Everything a run needs to know about its environment.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExecutionConfig {
    pub mode: ExecutionMode,
    pub sandbox: SandboxConfig,
    pub container: ContainerConfig,
}

/// The argv to run, and the environment it needs.
#[derive(Debug, PartialEq)]
pub struct Launcher {
    pub program: String,
    pub args: Vec<String>,
    /// Values for this one child process. Container `-e` names read from here, so a secret is
    /// not in the argv (`ps` would show it) but still reaches the container.
    pub env: HashMap<String, String>,
    /// What to run if the child is killed and a container would otherwise survive.
    pub cleanup: Option<(String, Vec<String>)>,
}

/// The target platform, named rather than read from `cfg!` so the builders can be tested for
/// every platform from one machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Linux,
    Macos,
    Windows,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "windows") {
            Self::Windows
        } else {
            Self::Linux
        }
    }
}

/// Which binary exists on the PATH.
fn on_path(name: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&paths).any(|dir| {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return true;
        }
        cfg!(target_os = "windows") && dir.join(format!("{name}.exe")).is_file()
    })
}

/// What this machine can actually do, so a setting does not have to guess.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineAvailability {
    pub available: bool,
    /// The engine that would be used, when one is available.
    pub engine: Option<String>,
    /// Every engine found, in preference order.
    pub engines: Vec<String>,
}

/// The answer to "what can run a command here".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionStatus {
    pub platform: String,
    pub sandbox: EngineAvailability,
    pub container: EngineAvailability,
}

/// Detect the sandbox and container runtimes this machine offers.
pub fn status() -> ExecutionStatus {
    let platform = Platform::current();
    let sandboxes: Vec<String> = match platform {
        Platform::Linux => ["bwrap"]
            .iter()
            .filter(|name| on_path(name))
            .map(|n| n.to_string())
            .collect(),
        Platform::Macos => ["sandbox-exec"]
            .iter()
            .filter(|name| on_path(name))
            .map(|n| n.to_string())
            .collect(),
        Platform::Windows => Vec::new(),
    };
    let containers: Vec<String> = ["docker", "podman"]
        .iter()
        .filter(|name| on_path(name))
        .map(|n| n.to_string())
        .collect();

    ExecutionStatus {
        platform: match platform {
            Platform::Linux => "linux",
            Platform::Macos => "macos",
            Platform::Windows => "windows",
        }
        .to_string(),
        sandbox: EngineAvailability {
            available: !sandboxes.is_empty(),
            engine: sandboxes.first().cloned(),
            engines: sandboxes,
        },
        container: EngineAvailability {
            available: !containers.is_empty(),
            engine: containers.first().cloned(),
            engines: containers,
        },
    }
}

/// The Tauri command behind Settings → Sandbox / Container.
#[tauri::command]
pub fn execution_status() -> ExecutionStatus {
    status()
}

/// The shell that runs a command line, as argv.
fn shell(command: &str, platform: Platform) -> Vec<String> {
    match platform {
        Platform::Windows => vec!["cmd".into(), "/C".into(), command.into()],
        _ => vec!["sh".into(), "-lc".into(), command.into()],
    }
}

/// Pick a container engine, given what the machine has.
pub fn resolve_engine(
    engine: ContainerEngine,
    docker: bool,
    podman: bool,
) -> Result<&'static str, CommandError> {
    let found = match engine {
        ContainerEngine::Docker => docker.then_some("docker"),
        ContainerEngine::Podman => podman.then_some("podman"),
        // Rootless Podman first: no daemon, no licence question, and the same OCI flags.
        ContainerEngine::Auto => podman.then_some("podman").or(docker.then_some("docker")),
    };
    found.ok_or_else(|| {
        CommandError::invalid(match engine {
            ContainerEngine::Docker => {
                "Docker is not on the PATH. Install Docker or choose Podman.".to_string()
            }
            ContainerEngine::Podman => {
                "Podman is not on the PATH. Install Podman or choose Docker.".to_string()
            }
            ContainerEngine::Auto => {
                "No container runtime was found. Install Podman (recommended) or Docker."
                    .to_string()
            }
        })
    })
}

/// Quote a path for a Seatbelt profile.
fn seatbelt_path(path: &Path) -> String {
    let text = path
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    format!("\"{text}\"")
}

/// The macOS Seatbelt profile.
///
/// `allow default` keeps the system readable and usable — a research script needs its
/// interpreter and its libraries. What is denied is what an accident or an injected instruction
/// would reach for: writes outside the workspace, the network, and the credential directories.
pub fn seatbelt_profile(root: &Path, cwd: &Path, config: &SandboxConfig) -> String {
    let mut rules = vec![
        "(version 1)".to_string(),
        "(allow default)".to_string(),
        "(deny file-write*)".to_string(),
        format!("(allow file-write* (subpath {}))", seatbelt_path(root)),
        format!("(allow file-write* (subpath {}))", seatbelt_path(cwd)),
        "(allow file-write* (subpath \"/tmp\") (subpath \"/private/tmp\") (subpath \"/var/folders\"))".to_string(),
        "(allow file-write* (literal \"/dev/null\") (literal \"/dev/stdout\") (literal \"/dev/stderr\"))".to_string(),
    ];
    for path in &config.write_paths {
        rules.push(format!(
            "(allow file-write* (subpath {}))",
            seatbelt_path(Path::new(path))
        ));
    }
    if !config.network {
        rules.push("(deny network*)".to_string());
    }
    // The files that make a stolen key worth stealing. Reads are denied even though the rest of
    // the home directory stays readable, because a research script has no business there.
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for secret in [
            ".ssh",
            ".aws",
            ".gnupg",
            ".config/gcloud",
            ".mcp-auth",
            "Library/Keychains",
        ] {
            rules.push(format!(
                "(deny file-read* (subpath {}))",
                seatbelt_path(&home.join(secret))
            ));
        }
    }
    rules.join("\n")
}

/// The `bubblewrap` argv (Linux).
pub fn bubblewrap_args(
    root: &Path,
    cwd: &Path,
    command: &str,
    config: &SandboxConfig,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--unshare-all".into(),
        "--die-with-parent".into(),
        "--new-session".into(),
        // The system is readable, the workspace is the one writable island.
        "--ro-bind".into(),
        "/".into(),
        "/".into(),
        "--dev".into(),
        "/dev".into(),
        "--proc".into(),
        "/proc".into(),
    ];

    if config.keep_tmp {
        args.extend(["--bind".into(), "/tmp".into(), "/tmp".into()]);
    } else {
        args.extend(["--tmpfs".into(), "/tmp".into()]);
    }

    for path in &config.write_paths {
        args.extend(["--bind".into(), path.clone(), path.clone()]);
    }
    for path in &config.read_paths {
        args.extend(["--ro-bind".into(), path.clone(), path.clone()]);
    }
    args.extend([
        "--bind".into(),
        root.display().to_string(),
        root.display().to_string(),
    ]);

    // `--unshare-all` includes the network, so sharing it has to be said explicitly.
    if config.network {
        args.push("--share-net".into());
    }

    // A clean environment: the user's shell exports are not part of a sandboxed run unless
    // they were configured. PATH is kept because a command that cannot find `python` is not
    // useful; HOME points at the private tmp.
    args.extend(["--clearenv".into()]);
    for (key, value) in [
        (
            "PATH",
            std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into()),
        ),
        ("HOME", "/tmp".to_string()),
        (
            "TERM",
            std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".into()),
        ),
        (
            "LANG",
            std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into()),
        ),
    ] {
        args.extend(["--setenv".into(), key.to_string(), value]);
    }
    for (key, value) in &config.env {
        args.extend(["--setenv".into(), key.clone(), value.clone()]);
    }

    args.push("--chdir".into());
    args.push(cwd.display().to_string());
    args.push("--".into());
    args.extend(shell(command, Platform::Linux));
    args
}

/// The container argv. Every value is its own argument, so nothing is re-parsed by a shell.
pub fn container_args(
    _engine: &str,
    root: &Path,
    cwd: &Path,
    command: &str,
    config: &ContainerConfig,
    env_keys: &[String],
    name: &str,
) -> Result<Vec<String>, CommandError> {
    let image = config.image.trim();
    if image.is_empty() {
        return Err(CommandError::invalid(
            "a container needs an image; set one in Settings → Container",
        ));
    }
    if config.memory_mb < 128 {
        return Err(CommandError::invalid(
            "a container needs at least 128 MiB of memory",
        ));
    }
    if config.cpus <= 0.0 {
        return Err(CommandError::invalid(
            "a container needs at least one CPU share",
        ));
    }

    let mut args: Vec<String> = vec![
        "run".into(),
        "--rm".into(),
        "--init".into(),
        "--name".into(),
        name.to_string(),
        "--network".into(),
        if config.network { "bridge" } else { "none" }.into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--security-opt".into(),
        "no-new-privileges".into(),
        "--pids-limit".into(),
        config.pids_limit.to_string(),
        "--memory".into(),
        format!("{}m", config.memory_mb),
        "--cpus".into(),
        format!("{}", config.cpus),
    ];

    if config.read_only_root {
        args.extend(["--read-only".into(), "--tmpfs".into(), "/tmp".into()]);
    }

    // The workspace keeps the same path inside, so a result written by the command names the
    // file the reader will open outside.
    args.extend([
        "-v".into(),
        format!("{}:{}", root.display(), root.display()),
    ]);
    for mount in &config.mounts {
        let mount = mount.trim();
        if mount.is_empty() {
            continue;
        }
        if mount.contains("docker.sock") || mount.contains("podman.sock") {
            return Err(CommandError::invalid(
                "the container socket cannot be mounted into a container",
            ));
        }
        if !mount.starts_with('/') {
            return Err(CommandError::invalid(format!(
                "{mount} must start with an absolute host path"
            )));
        }
        args.extend(["-v".into(), mount.to_string()]);
    }

    // Run as the workspace's owner rather than the image's default user, so files the command
    // writes back are the reader's, not root's.
    #[cfg(unix)]
    if let Ok(metadata) = fs::metadata(root) {
        use std::os::unix::fs::MetadataExt;
        args.extend([
            "--user".into(),
            format!("{}:{}", metadata.uid(), metadata.gid()),
        ]);
    }

    // A name, not a value: the value is in the process environment, so it never appears in
    // `ps` and cannot be read out of the container's argv.
    for key in env_keys {
        args.extend(["-e".into(), key.clone()]);
    }

    if config.pull != PullPolicy::Missing {
        args.extend([
            "--pull".into(),
            match config.pull {
                PullPolicy::Always => "always",
                PullPolicy::Never => "never",
                PullPolicy::Missing => "missing",
            }
            .into(),
        ]);
    }

    args.extend(["-w".into(), cwd.display().to_string(), image.to_string()]);
    args.extend(shell(command, Platform::Linux));
    Ok(args)
}

/// Build the launcher for one command.
pub fn launch(
    config: Option<&ExecutionConfig>,
    command: &str,
    cwd: &Path,
    root: &Path,
    env_keys: &[String],
    platform: Platform,
) -> Result<Launcher, CommandError> {
    let mode = config.map(|config| config.mode).unwrap_or_default();
    match mode {
        ExecutionMode::Host => {
            let mut argv = shell(command, platform);
            let program = argv.remove(0);
            Ok(Launcher {
                program,
                args: argv,
                env: HashMap::new(),
                cleanup: None,
            })
        }
        ExecutionMode::Sandbox => {
            let sandbox = config
                .map(|config| &config.sandbox)
                .cloned()
                .unwrap_or_default();
            match platform {
                Platform::Linux => {
                    if !on_path("bwrap") {
                        return Err(CommandError::invalid(
                            "bubblewrap is not installed. Install `bubblewrap` or switch to the real environment.",
                        ));
                    }
                    Ok(Launcher {
                        program: "bwrap".into(),
                        args: bubblewrap_args(root, cwd, command, &sandbox),
                        env: HashMap::new(),
                        cleanup: None,
                    })
                }
                Platform::Macos => {
                    if !on_path("sandbox-exec") {
                        return Err(CommandError::invalid(
                            "macOS sandbox-exec is not available; switch to the real environment or a container.",
                        ));
                    }
                    let profile = seatbelt_profile(root, cwd, &sandbox);
                    let mut args = vec!["-p".into(), profile];
                    args.extend(shell(command, Platform::Macos));
                    Ok(Launcher {
                        program: "sandbox-exec".into(),
                        args,
                        env: sandbox.env.clone(),
                        cleanup: None,
                    })
                }
                Platform::Windows => Err(CommandError::invalid(
                    "the Windows sandbox is not available yet; use a container or the real environment.",
                )),
            }
        }
        ExecutionMode::Container => {
            let container = config
                .map(|config| &config.container)
                .cloned()
                .unwrap_or_default();
            let engine = resolve_engine(container.engine, on_path("docker"), on_path("podman"))?;
            // Unique enough to address the one container if the command is killed.
            let name = format!("openlab-{}", std::process::id());
            let args = container_args(engine, root, cwd, command, &container, env_keys, &name)?;
            Ok(Launcher {
                program: engine.to_string(),
                args,
                env: container.env.clone(),
                cleanup: Some((engine.to_string(), vec!["rm".into(), "-f".into(), name])),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        PathBuf::from("/work/lab")
    }

    fn cwd() -> PathBuf {
        PathBuf::from("/work/lab/analysis")
    }

    fn sandbox(network: bool) -> SandboxConfig {
        SandboxConfig {
            network,
            ..SandboxConfig::default()
        }
    }

    fn container() -> ContainerConfig {
        ContainerConfig::default()
    }

    #[test]
    fn host_runs_the_shell_as_before() {
        let launcher =
            launch(None, "echo hi", &cwd(), &root(), &[], Platform::Linux).expect("launch");
        assert_eq!(launcher.program, "sh");
        assert_eq!(launcher.args, vec!["-lc", "echo hi"]);
        assert!(launcher.cleanup.is_none());
    }

    #[test]
    fn bubblewrap_unshares_the_network_by_default() {
        let args = bubblewrap_args(&root(), &cwd(), "echo hi", &sandbox(false));
        assert!(args.contains(&"--unshare-all".to_string()));
        assert!(!args.contains(&"--share-net".to_string()));
        assert!(args.contains(&"--die-with-parent".to_string()));
    }

    #[test]
    fn bubblewrap_shares_the_network_only_when_asked() {
        let args = bubblewrap_args(&root(), &cwd(), "echo hi", &sandbox(true));
        assert!(args.contains(&"--share-net".to_string()));
    }

    #[test]
    fn bubblewrap_binds_the_system_read_only_and_the_workspace_writable() {
        let args = bubblewrap_args(&root(), &cwd(), "echo hi", &sandbox(false));
        let pairs: Vec<(&str, &str)> = args
            .windows(2)
            .filter_map(|pair| Some((pair.first()?.as_str(), pair.get(1)?.as_str())))
            .collect();
        assert!(pairs.contains(&("--ro-bind", "/")));
        assert!(pairs.contains(&("--bind", "/work/lab")));
        assert!(args.contains(&"--chdir".to_string()));
        assert!(args.contains(&"/work/lab/analysis".to_string()));
    }

    #[test]
    fn bubblewrap_can_be_given_extra_paths() {
        let config = SandboxConfig {
            read_paths: vec!["/data".into()],
            write_paths: vec!["/scratch".into()],
            ..SandboxConfig::default()
        };
        let args = bubblewrap_args(&root(), &cwd(), "echo hi", &config);
        let pairs: Vec<(String, String)> = args
            .windows(2)
            .map(|pair| (pair[0].clone(), pair[1].clone()))
            .collect();
        assert!(pairs.contains(&("--ro-bind".into(), "/data".into())));
        assert!(pairs.contains(&("--bind".into(), "/scratch".into())));
    }

    #[test]
    fn bubblewrap_clears_the_environment_but_keeps_a_path() {
        let config = SandboxConfig {
            env: HashMap::from([("LAB_TOKEN".to_string(), "abc".to_string())]),
            ..SandboxConfig::default()
        };
        let args = bubblewrap_args(&root(), &cwd(), "echo hi", &config);
        assert!(args.contains(&"--clearenv".to_string()));
        assert!(args.contains(&"LAB_TOKEN".to_string()));
        assert!(args.contains(&"PATH".to_string()));
    }

    #[test]
    fn seatbelt_denies_the_network_and_writes_outside_the_workspace() {
        let profile = seatbelt_profile(&root(), &cwd(), &sandbox(false));
        assert!(profile.contains("(deny network*)"));
        assert!(profile.contains("(deny file-write*)"));
        assert!(profile.contains("/work/lab"));
        assert!(profile.contains("\"/work/lab/analysis\""));
    }

    #[test]
    fn seatbelt_allows_the_network_when_asked() {
        let profile = seatbelt_profile(&root(), &cwd(), &sandbox(true));
        assert!(!profile.contains("(deny network*)"));
    }

    #[test]
    fn seatbelt_denies_the_credential_directories() {
        // HOME is the runner's, so the assertion names the directories rather than a path.
        let profile = seatbelt_profile(&root(), &cwd(), &sandbox(false));
        assert!(profile.contains(".ssh"));
        assert!(profile.contains(".aws"));
        assert!(profile.contains("Keychains"));
    }

    #[test]
    fn a_container_needs_an_image() {
        let config = ContainerConfig {
            image: "   ".into(),
            ..ContainerConfig::default()
        };
        let error = container_args(
            "docker",
            &root(),
            &cwd(),
            "echo hi",
            &config,
            &[],
            "openlab-1",
        )
        .expect_err("an empty image is refused");
        assert!(error.message.contains("image"));
    }

    #[test]
    fn a_container_drops_capabilities_and_closes_the_network() {
        let args = container_args(
            "docker",
            &root(),
            &cwd(),
            "echo hi",
            &container(),
            &[],
            "openlab-1",
        )
        .expect("args");
        assert!(args.contains(&"--cap-drop".to_string()));
        assert!(args.contains(&"--security-opt".to_string()));
        assert!(args.contains(&"no-new-privileges".to_string()));
        let network = args
            .iter()
            .position(|arg| arg == "--network")
            .expect("network flag");
        assert_eq!(args[network + 1], "none");
    }

    #[test]
    fn a_container_binds_the_workspace_at_the_same_path() {
        let args = container_args(
            "docker",
            &root(),
            &cwd(),
            "echo hi",
            &container(),
            &[],
            "openlab-1",
        )
        .expect("args");
        let bound = args.iter().position(|arg| arg == "-v").expect("-v");
        assert_eq!(args[bound + 1], "/work/lab:/work/lab");
        let workdir = args.iter().position(|arg| arg == "-w").expect("-w");
        assert_eq!(args[workdir + 1], "/work/lab/analysis");
    }

    #[test]
    fn a_container_passes_env_by_name_not_value() {
        let args = container_args(
            "podman",
            &root(),
            &cwd(),
            "echo hi",
            &container(),
            &["OPENAI_API_KEY".to_string()],
            "openlab-1",
        )
        .expect("args");
        let flag = args.iter().position(|arg| arg == "-e").expect("-e");
        assert_eq!(args[flag + 1], "OPENAI_API_KEY");
        assert!(!args.join(" ").contains("sk-"));
    }

    #[test]
    fn the_container_socket_cannot_be_mounted() {
        let config = ContainerConfig {
            mounts: vec!["/var/run/docker.sock:/var/run/docker.sock".into()],
            ..ContainerConfig::default()
        };
        let error = container_args(
            "docker",
            &root(),
            &cwd(),
            "echo hi",
            &config,
            &[],
            "openlab-1",
        )
        .expect_err("the socket is refused");
        assert!(error.message.contains("socket"));
    }

    #[test]
    fn a_relative_mount_is_refused() {
        let config = ContainerConfig {
            mounts: vec!["data:/data".into()],
            ..ContainerConfig::default()
        };
        assert!(container_args(
            "docker",
            &root(),
            &cwd(),
            "echo hi",
            &config,
            &[],
            "openlab-1"
        )
        .is_err());
    }

    #[test]
    fn a_container_is_read_only_by_default_and_has_a_tmp() {
        let args = container_args(
            "docker",
            &root(),
            &cwd(),
            "echo hi",
            &container(),
            &[],
            "openlab-1",
        )
        .expect("args");
        assert!(args.contains(&"--read-only".to_string()));
        let tmp = args.iter().position(|arg| arg == "--tmpfs").expect("tmpfs");
        assert_eq!(args[tmp + 1], "/tmp");
    }

    #[test]
    fn auto_prefers_podman_then_docker() {
        assert_eq!(
            resolve_engine(ContainerEngine::Auto, false, true).expect("podman"),
            "podman"
        );
        assert_eq!(
            resolve_engine(ContainerEngine::Auto, true, false).expect("docker"),
            "docker"
        );
        assert!(resolve_engine(ContainerEngine::Auto, false, false).is_err());
    }

    #[test]
    fn an_explicit_engine_that_is_missing_is_an_error() {
        assert!(resolve_engine(ContainerEngine::Docker, false, true).is_err());
        assert!(resolve_engine(ContainerEngine::Podman, true, false).is_err());
    }

    #[test]
    fn a_container_launcher_cleans_up_after_a_kill() {
        // `launch` checks the PATH; the pure builders above are where the argv is pinned.
        // Auto picks whatever this machine actually has, so the test is meaningful on every
        // development machine and skips where no runtime exists.
        if !status().container.available {
            return;
        }
        let config = ExecutionConfig {
            mode: ExecutionMode::Container,
            ..ExecutionConfig::default()
        };
        let launcher = launch(
            Some(&config),
            "echo hi",
            &cwd(),
            &root(),
            &[],
            Platform::Linux,
        )
        .expect("launch");
        let (program, args) = launcher
            .cleanup
            .expect("a container names itself for cleanup");
        assert!(!program.is_empty());
        assert_eq!(
            args,
            vec![
                "rm".to_string(),
                "-f".to_string(),
                format!("openlab-{}", std::process::id())
            ]
        );
    }

    /// A real `sandbox-exec` run, not just the profile text: the profile must be accepted by
    /// the system and must let an ordinary read-only command through.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_macos_sandbox_actually_runs_a_command() {
        if !on_path("sandbox-exec") {
            return;
        }
        let workspace =
            std::env::temp_dir().join(format!("openlab-sandbox-{}", std::process::id()));
        fs::create_dir_all(&workspace).expect("workspace");
        let config = ExecutionConfig {
            mode: ExecutionMode::Sandbox,
            ..ExecutionConfig::default()
        };
        let launcher = launch(
            Some(&config),
            "echo ok",
            &workspace,
            &workspace,
            &[],
            Platform::Macos,
        )
        .expect("launch");
        let output = std::process::Command::new(&launcher.program)
            .args(&launcher.args)
            .output()
            .expect("run");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("ok"));
        let _ = fs::remove_dir_all(&workspace);
    }

    /// The other half: a write outside the workspace is refused by the kernel, not by the UI.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_macos_sandbox_refuses_a_write_outside_the_workspace() {
        if !on_path("sandbox-exec") {
            return;
        }
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        let workspace =
            std::env::temp_dir().join(format!("openlab-sandbox-{}", std::process::id()));
        let outside =
            PathBuf::from(home).join(format!("openlab-escape-{}.txt", std::process::id()));
        fs::create_dir_all(&workspace).expect("workspace");
        let config = ExecutionConfig {
            mode: ExecutionMode::Sandbox,
            ..ExecutionConfig::default()
        };
        let command = format!("echo escaped > {}", outside.display());
        let launcher = launch(
            Some(&config),
            &command,
            &workspace,
            &workspace,
            &[],
            Platform::Macos,
        )
        .expect("launch");
        let output = std::process::Command::new(&launcher.program)
            .args(&launcher.args)
            .output()
            .expect("run");
        assert!(
            !outside.exists(),
            "the sandbox let a write out of the workspace"
        );
        assert!(
            !output.status.success() || String::from_utf8_lossy(&output.stderr).contains("denied")
        );
        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&workspace);
    }
}
