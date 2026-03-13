use std::fs;
use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tokio::sync::Mutex;

use crate::AppHandle;
use crate::config::{self, DesktopConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendStatus {
    pub running: bool,
    pub url: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Default)]
pub struct BackendManager {
    inner: Arc<Mutex<BackendInner>>,
    start_lock: Arc<Mutex<()>>,
}

#[derive(Default)]
struct BackendInner {
    child: Option<tauri_plugin_shell::process::CommandChild>,
    pid: Option<u32>,
    url: Option<String>,
    last_error: Option<String>,
}

impl BackendManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn status(&self) -> BackendStatus {
        let guard = self.inner.lock().await;
        BackendStatus {
            running: guard.child.is_some(),
            url: guard.url.clone(),
            last_error: guard.last_error.clone(),
        }
    }

    pub async fn ensure_started(&self, app: &AppHandle) -> Result<BackendStatus, String> {
        let _start_guard = self.start_lock.lock().await;

        {
            let guard = self.inner.lock().await;
            if guard.child.is_some() {
                return Ok(BackendStatus {
                    running: true,
                    url: guard.url.clone(),
                    last_error: guard.last_error.clone(),
                });
            }
        }

        let cfg = config::load_or_create(app).unwrap_or_default();
        let runtime_config_path = config::runtime_config_path(app)
            .ok_or_else(|| "unable to resolve runtime config path".to_string())?;
        let (child, url) = match spawn_backend_service(app, &cfg, &runtime_config_path).await {
            Ok(started) => started,
            Err(err) => {
                let mut guard = self.inner.lock().await;
                guard.child = None;
                guard.pid = None;
                guard.url = None;
                guard.last_error = Some(err.clone());
                append_backend_log_line(app, &format!("[desktop] backend start failed: {err}"));
                return Err(err);
            }
        };

        let pid = child.pid();

        // Publish the child handle before probing /health so concurrent callers and
        // shutdown paths can see and manage the in-flight backend.
        {
            let mut guard = self.inner.lock().await;
            guard.pid = Some(pid);
            guard.child = Some(child);
            guard.url = Some(url.clone());
            guard.last_error = None;
        }

        if let Err(err) = wait_for_health(&url).await {
            let _ = self.stop(app).await;
            let mut guard = self.inner.lock().await;
            guard.last_error = Some(err.clone());
            append_backend_log_line(app, &format!("[desktop] backend start failed: {err}"));
            return Err(err);
        }

        Ok(self.status().await)
    }

    pub async fn stop(&self, app: &AppHandle) -> Result<(), String> {
        let (mut child, pid) = {
            let mut guard = self.inner.lock().await;
            guard.url = None;
            (guard.child.take(), guard.pid.take())
        };

        if let Some(c) = child.take() {
            let pid = c.pid();
            kill_process_tree(pid);
            // Try to kill directly as a fallback in case taskkill misses.
            let _ = c.kill();
            #[cfg(target_os = "windows")]
            force_cleanup_port_windows(app);
            wait_for_port_release(app).await;
            return Ok(());
        }

        if let Some(pid) = pid {
            kill_process_tree(pid);
            #[cfg(target_os = "windows")]
            force_cleanup_port_windows(app);
            wait_for_port_release(app).await;
        }

        let _ = app; // reserved for future graceful shutdown.
        Ok(())
    }

    pub async fn restart(&self, app: &AppHandle) -> Result<BackendStatus, String> {
        let _ = self.stop(app).await;
        self.ensure_started(app).await
    }
}

pub fn open_logs_dir(app: &AppHandle) -> Result<(), String> {
    let dir = logs_dir(app).ok_or_else(|| "unable to resolve log dir".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {dir:?}: {e}"))?;
    use tauri_plugin_opener::OpenerExt;
    let _ = app
        .opener()
        .reveal_item_in_dir(dir.to_string_lossy().as_ref());
    Ok(())
}

fn logs_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_log_dir().ok()
}

fn backend_log_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = logs_dir(app)?;
    Some(dir.join("backend.log"))
}

async fn spawn_backend_service(
    app: &AppHandle,
    cfg: &DesktopConfig,
    runtime_config_path: &Path,
) -> Result<(tauri_plugin_shell::process::CommandChild, String), String> {
    // If the bundled backend service is unavailable, startup fails and desktop commands can
    // still report status/manage retries.
    let backend_cmd = match app.shell().sidecar("opencode-studio") {
        Ok(cmd) => cmd,
        Err(_) => {
            return Err("backend service not available in this build".to_string());
        }
    };

    let ui_dir = match cfg.backend.ui_dir.as_deref().map(str::trim) {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => resolve_ui_dir(app)?,
    };
    let port = pick_port(cfg.backend.port)?;
    let connect_host = normalize_connect_host(&cfg.backend.host);
    let url = format!("http://{}:{}", connect_host, port);

    let data_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("resolve app config dir: {e}"))?;
    let home_env = resolve_home_env();

    let mut cmd = backend_cmd
        .args([
            "--host",
            cfg.backend.host.as_str(),
            "--port",
            &port.to_string(),
            "--config",
            runtime_config_path.to_string_lossy().as_ref(),
            "--ui-dir",
            ui_dir.to_string_lossy().as_ref(),
        ])
        .env(
            "OPENCODE_STUDIO_DATA_DIR",
            data_dir.to_string_lossy().as_ref(),
        );

    cmd = cmd.env(
        "RUST_LOG",
        backend_rust_log_filter(cfg.backend.backend_log_level.as_deref()),
    );

    if let Some(home) = home_env.as_deref() {
        cmd = cmd.env("HOME", home);
    }

    if let Some(pw) = cfg.backend.ui_password.as_deref() {
        if !pw.trim().is_empty() {
            cmd = cmd.args(["--ui-password", pw]);
        }
    }

    if cfg.backend.skip_opencode_start {
        cmd = cmd.args(["--skip-opencode-start"]);
    }

    if let Some(opencode_port) = cfg.backend.opencode_port {
        cmd = cmd
            .args(["--opencode-host", cfg.backend.opencode_host.as_str()])
            .args(["--opencode-port", &opencode_port.to_string()]);
    }

    if let Some(level) = normalize_log_level(cfg.backend.opencode_log_level.as_deref()) {
        cmd = cmd
            .env("OPENCODE_STUDIO_OPENCODE_LOG_LEVEL", level)
            .env("OPENCODE_LOG_LEVEL", level)
            .env("OPENCODE_STUDIO_OPENCODE_LOGS", "true")
            .args(["--opencode-log-level", level]);
    } else {
        cmd = cmd.env("OPENCODE_STUDIO_OPENCODE_LOGS", "false");
    }

    for origin in merge_cors_origins(cfg) {
        cmd = cmd.args(["--cors-origin", &origin]);
    }

    if cfg.backend.cors_allow_all {
        cmd = cmd.args(["--cors-allow-all"]);
    }

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn backend: {e}"))?;
    let child_pid = child.pid();

    // Stream backend output to a log file (best-effort).
    let log_path = backend_log_path(app);
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut file = log_path.and_then(|p| {
            let _ = fs::create_dir_all(p.parent().unwrap_or_else(|| std::path::Path::new(".")));
            fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(p)
                .ok()
        });

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    if let Some(f) = file.as_mut() {
                        let _ = f.write_all(&line);
                        let _ = f.write_all(b"\n");
                    }
                }
                CommandEvent::Error(err) => {
                    let msg = format!("[backend error] {err}");
                    if let Some(f) = file.as_mut() {
                        let _ = f.write_all(msg.as_bytes());
                        let _ = f.write_all(b"\n");
                    }
                    let manager = app_handle.state::<BackendManager>().inner().clone();
                    let mut guard = manager.inner.lock().await;
                    if guard.pid == Some(child_pid) {
                        guard.last_error = Some(err.to_string());
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let msg = format!(
                        "[backend terminated] code={:?} signal={:?}",
                        payload.code, payload.signal
                    );
                    if let Some(f) = file.as_mut() {
                        let _ = f.write_all(msg.as_bytes());
                        let _ = f.write_all(b"\n");
                    }
                    let manager = app_handle.state::<BackendManager>().inner().clone();
                    let mut guard = manager.inner.lock().await;
                    if guard.pid == Some(child_pid) {
                        guard.child = None;
                        guard.pid = None;
                        guard.url = None;
                        guard.last_error = Some(msg);
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok((child, url))
}

fn kill_process_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .status();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let pid_str = pid.to_string();
        let _ = StdCommand::new("pkill")
            .args(["-TERM", "-P", pid_str.as_str()])
            .status();
        let _ = StdCommand::new("kill")
            .args(["-TERM", pid_str.as_str()])
            .status();
        if !wait_for_process_exit(pid, 20, 100) {
            let _ = StdCommand::new("pkill")
                .args(["-KILL", "-P", pid_str.as_str()])
                .status();
            let _ = StdCommand::new("kill")
                .args(["-KILL", pid_str.as_str()])
                .status();
            let _ = wait_for_process_exit(pid, 10, 100);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn wait_for_process_exit(pid: u32, rounds: usize, wait_ms: u64) -> bool {
    let pid_str = pid.to_string();
    for _ in 0..rounds {
        let running = StdCommand::new("kill")
            .args(["-0", pid_str.as_str()])
            .status()
            .ok()
            .map(|status| status.success())
            .unwrap_or(false);
        if !running {
            return true;
        }
        std::thread::sleep(Duration::from_millis(wait_ms));
    }
    false
}

fn append_backend_log_line(app: &AppHandle, line: &str) {
    let Some(path) = backend_log_path(app) else {
        return;
    };
    let _ = fs::create_dir_all(path.parent().unwrap_or_else(|| Path::new(".")));
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn resolve_ui_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // In packaged builds, resources are available.
    if let Ok(resource_dir) = app.path().resource_dir() {
        for candidate in ui_dir_candidates(&resource_dir) {
            if candidate.join("index.html").is_file() {
                return Ok(candidate);
            }
        }
    }

    // Dev fallback: assume repo layout.
    let cwd = std::env::current_dir().map_err(|e| format!("cwd: {e}"))?;
    let candidate = cwd.join("web").join("dist");
    if candidate.join("index.html").is_file() {
        return Ok(candidate);
    }

    Err("unable to locate UI dist directory".to_string())
}

fn ui_dir_candidates(resource_dir: &Path) -> Vec<PathBuf> {
    vec![
        resource_dir.join("dist"),
        resource_dir.join("web").join("dist"),
        resource_dir.join("_up_").join("dist"),
        resource_dir.join("_up_").join("web").join("dist"),
        resource_dir
            .join("_up_")
            .join("_up_")
            .join("web")
            .join("dist"),
    ]
}

fn pick_port(preferred: u16) -> Result<u16, String> {
    let port = if preferred == 0 { 3210 } else { preferred };

    // Keep the backend on the configured port. If it's already taken,
    // tell the user to pick a new port.
    if can_bind_port(port) {
        return Ok(port);
    }

    #[cfg(target_os = "windows")]
    {
        if recover_windows_ghost_port(port) {
            return Ok(port);
        }
    }

    Err(format!(
        "backend port {port} is not available. Edit the desktop runtime config file (opencode-studio.toml) to change the port, or stop the other process using it."
    ))
}

fn can_bind_port(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

async fn wait_for_port_release(app: &AppHandle) {
    let cfg = config::load_or_create(app).unwrap_or_default();
    let port = if cfg.backend.port == 0 {
        3210
    } else {
        cfg.backend.port
    };

    for _ in 0..30 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(target_os = "windows")]
fn try_cleanup_stale_backend_on_port(port: u16) -> bool {
    let pids = listening_pids_on_port_windows(port);
    if pids.is_empty() {
        return false;
    }

    let mut killed_any = false;
    for pid in pids {
        if pid == std::process::id() {
            continue;
        }

        // Only auto-kill if this looks like our stale backend.
        if let Some(image_name) = process_name_for_pid_windows(pid) {
            let normalized = image_name.trim().to_ascii_lowercase();
            if !normalized.contains("opencode-studio") {
                continue;
            }
        } else {
            // If a PID exists in TCP table but process lookup fails, still attempt a best-effort kill.
            // This can happen transiently during process teardown on Windows.
        }

        let ok = StdCommand::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .status()
            .ok()
            .map(|s| s.success())
            .unwrap_or(false);
        killed_any = killed_any || ok;
    }
    killed_any
}

#[cfg(target_os = "windows")]
fn recover_windows_ghost_port(port: u16) -> bool {
    if can_bind_port(port) {
        return true;
    }

    if try_cleanup_stale_backend_on_port(port) && wait_for_bind_available(port, 80, 100) {
        return true;
    }

    // If HTTP.sys owns the port (PID 4), restart the HTTP service as a best effort.
    if listening_pids_on_port_windows(port)
        .iter()
        .any(|pid| *pid == 4)
        && restart_http_service_windows()
        && wait_for_bind_available(port, 60, 100)
    {
        return true;
    }

    // Last best-effort recovery for stale network stack state.
    let _ = StdCommand::new("wsl").arg("--shutdown").status();
    let _ = restart_windows_service("hns");
    let _ = restart_windows_service("winnat");

    wait_for_bind_available(port, 80, 100)
}

#[cfg(target_os = "windows")]
fn wait_for_bind_available(port: u16, rounds: usize, wait_ms: u64) -> bool {
    for _ in 0..rounds {
        if can_bind_port(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(wait_ms));
    }
    false
}

#[cfg(target_os = "windows")]
fn restart_http_service_windows() -> bool {
    let stop_ok = StdCommand::new("net")
        .args(["stop", "http", "/y"])
        .status()
        .ok()
        .map(|s| s.success())
        .unwrap_or(false);

    let start_ok = StdCommand::new("net")
        .args(["start", "http"])
        .status()
        .ok()
        .map(|s| s.success())
        .unwrap_or(false);

    stop_ok || start_ok
}

#[cfg(target_os = "windows")]
fn restart_windows_service(service: &str) -> bool {
    let status = StdCommand::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("$s=Get-Service -Name '{service}' -ErrorAction SilentlyContinue; if ($s) {{ try {{ Restart-Service -Name '{service}' -Force -ErrorAction Stop; exit 0 }} catch {{ exit 1 }} }} else {{ exit 0 }}"),
        ])
        .status();
    status.ok().map(|s| s.success()).unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn force_cleanup_port_windows(app: &AppHandle) {
    let cfg = config::load_or_create(app).unwrap_or_default();
    let port = if cfg.backend.port == 0 {
        3210
    } else {
        cfg.backend.port
    };
    for pid in listening_pids_on_port_windows(port) {
        if pid == std::process::id() {
            continue;
        }
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .status();
    }
}

#[cfg(target_os = "windows")]
fn listening_pids_on_port_windows(port: u16) -> Vec<u32> {
    let mut out = Vec::new();
    let output = StdCommand::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
        .ok();
    let Some(output) = output else {
        return out;
    };
    if !output.status.success() {
        return out;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 {
            continue;
        }
        // TCP 127.0.0.1:3210 0.0.0.0:0 LISTENING 12345
        if !(cols[3].eq_ignore_ascii_case("LISTENING")
            || cols[3].to_ascii_uppercase().contains("LISTEN"))
        {
            continue;
        }
        if !windows_addr_matches_port(cols[1], port) {
            continue;
        }
        if let Ok(pid) = cols[4].parse::<u32>() {
            if !out.iter().any(|v| v == &pid) {
                out.push(pid);
            }
        }
    }
    out
}

#[cfg(target_os = "windows")]
fn windows_addr_matches_port(addr: &str, port: u16) -> bool {
    let port_suffix = format!(":{port}");
    addr.ends_with(&port_suffix)
}

#[cfg(target_os = "windows")]
fn process_name_for_pid_windows(pid: u32) -> Option<String> {
    let output = StdCommand::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next()?.trim();
    if first.is_empty()
        || first
            .eq_ignore_ascii_case("INFO: No tasks are running which match the specified criteria.")
    {
        return None;
    }
    // "Image Name","PID","Session Name","Session#","Mem Usage"
    let trimmed = first.trim_matches('"');
    let mut parts = trimmed.split("\",\"");
    let image = parts.next()?.trim();
    if image.is_empty() {
        None
    } else {
        Some(image.to_string())
    }
}

fn normalize_connect_host(host: &str) -> String {
    let value = host.trim();
    match value {
        "" | "0.0.0.0" => "127.0.0.1".to_string(),
        "::" | "[::]" => "::1".to_string(),
        _ => value.to_string(),
    }
}

async fn wait_for_health(base_url: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("reqwest client: {e}"))?;

    let health_url = format!("{}/health", base_url.trim_end_matches('/'));
    let started = std::time::Instant::now();
    let deadline = Duration::from_secs(15);

    loop {
        if started.elapsed() > deadline {
            return Err(format!("backend healthcheck timed out: {health_url}"));
        }

        match client.get(&health_url).send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => {
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
}

fn resolve_home_env() -> Option<String> {
    let home = std::env::var("HOME")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if home.is_some() {
        return home;
    }

    let user_profile = std::env::var("USERPROFILE")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if user_profile.is_some() {
        return user_profile;
    }

    let home_drive = std::env::var("HOMEDRIVE")
        .ok()
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
    let home_path = std::env::var("HOMEPATH")
        .ok()
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
    let combined = format!("{home_drive}{home_path}").trim().to_string();
    if combined.is_empty() {
        None
    } else {
        Some(combined)
    }
}

fn merge_cors_origins(cfg: &DesktopConfig) -> Vec<String> {
    let mut origins = Vec::<String>::new();
    let mut push_unique = |origin: &str| {
        if !origins.iter().any(|v| v == origin) {
            origins.push(origin.to_string());
        }
    };

    for raw in &cfg.backend.cors_origins {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        push_unique(trimmed);
    }

    // Desktop app UI is served by Tauri's local protocol and calls the backend over HTTP.
    // Allow common Tauri window origins by default so local desktop fetches are not blocked
    // by browser CORS when users change backend ports.
    for desktop_origin in [
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ] {
        push_unique(desktop_origin);
    }

    if cfg!(debug_assertions) {
        for dev_origin in ["http://localhost:5173", "http://127.0.0.1:5173"] {
            push_unique(dev_origin);
        }
    }

    origins
}

fn normalize_log_level(raw: Option<&str>) -> Option<&'static str> {
    let v = raw?.trim();
    if v.eq_ignore_ascii_case("debug") {
        Some("DEBUG")
    } else if v.eq_ignore_ascii_case("info") {
        Some("INFO")
    } else if v.eq_ignore_ascii_case("warn") {
        Some("WARN")
    } else if v.eq_ignore_ascii_case("error") {
        Some("ERROR")
    } else {
        None
    }
}

fn backend_rust_log_filter(raw: Option<&str>) -> &'static str {
    match normalize_log_level(raw) {
        Some("DEBUG") => "debug,tower_http=debug",
        Some("WARN") => "warn,tower_http=warn",
        Some("ERROR") => "error,tower_http=error",
        _ => "info,tower_http=info",
    }
}
