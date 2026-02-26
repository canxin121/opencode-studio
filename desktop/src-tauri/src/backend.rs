use std::fs;
use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
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
}

#[derive(Default)]
struct BackendInner {
  child: Option<tauri_plugin_shell::process::CommandChild>,
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
    let (child, url) = spawn_sidecar(app, &cfg).await?;

    {
      let mut guard = self.inner.lock().await;
      guard.child = Some(child);
      guard.url = Some(url.clone());
      guard.last_error = None;
    }

    Ok(self.status().await)
  }

  pub async fn stop(&self, app: &AppHandle) -> Result<(), String> {
    let mut child = {
      let mut guard = self.inner.lock().await;
      guard.url = None;
      guard.child.take()
    };

    if let Some(c) = child.take() {
      // Try to kill the backend.
      let _ = c.kill();
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
  let _ = app.opener().reveal_item_in_dir(dir.to_string_lossy().as_ref());
  Ok(())
}

fn logs_dir(app: &AppHandle) -> Option<PathBuf> {
  app.path().app_log_dir().ok()
}

fn backend_log_path(app: &AppHandle) -> Option<PathBuf> {
  let dir = logs_dir(app)?;
  Some(dir.join("backend.log"))
}

async fn spawn_sidecar(
  app: &AppHandle,
  cfg: &DesktopConfig,
) -> Result<(tauri_plugin_shell::process::CommandChild, String), String> {
  // If the sidecar is not bundled, startup fails and desktop commands can
  // still report status/manage retries.
  let sidecar = match app.shell().sidecar("opencode-studio") {
    Ok(cmd) => cmd,
    Err(_) => {
      return Err("backend sidecar not available in this build".to_string());
    }
  };

  let ui_dir = resolve_ui_dir(app)?;
  let port = pick_port(cfg.backend.port)?;
  let url = format!("http://{}:{}", cfg.backend.host, port);

  let data_dir = app
    .path()
    .app_config_dir()
    .map_err(|e| format!("resolve app config dir: {e}"))?;
  let home_env = resolve_home_env();

  let mut cmd = sidecar
    .args([
      "--host",
      cfg.backend.host.as_str(),
      "--port",
      &port.to_string(),
      "--ui-dir",
      ui_dir.to_string_lossy().as_ref(),
    ])
    .env("OPENCODE_STUDIO_DATA_DIR", data_dir.to_string_lossy().as_ref());

  cmd = cmd.env("RUST_LOG", backend_rust_log_filter(cfg.backend.backend_log_level.as_deref()));

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

  // Stream backend output to a log file (best-effort).
  let log_path = backend_log_path(app);
  let app_handle = app.clone();
  tauri::async_runtime::spawn(async move {
    let mut file = log_path
      .and_then(|p| {
        let _ = fs::create_dir_all(p.parent().unwrap_or_else(|| std::path::Path::new(".")));
        fs::OpenOptions::new().create(true).append(true).open(p).ok()
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
          let _ = err;
        }
        CommandEvent::Terminated(payload) => {
          // Persist crash info.
          let _ = payload;
          let _ = app_handle;
          break;
        }
        _ => {}
      }
    }
  });

  // Healthcheck.
  wait_for_health(&url).await?;

  Ok((child, url))
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
  let port = if preferred == 0 { 3000 } else { preferred };

  // In the full desktop build we default the webview URL to http://127.0.0.1:<port>,
  // so we MUST keep the backend on the configured port. If it's already taken,
  // tell the user to pick a new port.
  if TcpListener::bind(("127.0.0.1", port)).is_ok() {
    return Ok(port);
  }

  Err(format!(
    "backend port {port} is not available. Edit desktop-config.json to change the port, or stop the other process using it."
  ))
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
  let home = std::env::var("HOME").ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
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

  let home_drive = std::env::var("HOMEDRIVE").ok().map(|v| v.trim().to_string()).unwrap_or_default();
  let home_path = std::env::var("HOMEPATH").ok().map(|v| v.trim().to_string()).unwrap_or_default();
  let combined = format!("{home_drive}{home_path}").trim().to_string();
  if combined.is_empty() {
    None
  } else {
    Some(combined)
  }
}

fn merge_cors_origins(cfg: &DesktopConfig) -> Vec<String> {
  let mut origins = Vec::<String>::new();

  for raw in &cfg.backend.cors_origins {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
      continue;
    }
    if !origins.iter().any(|v| v == trimmed) {
      origins.push(trimmed.to_string());
    }
  }

  if cfg!(debug_assertions) {
    for dev_origin in ["http://localhost:5173", "http://127.0.0.1:5173"] {
      if !origins.iter().any(|v| v == dev_origin) {
        origins.push(dev_origin.to_string());
      }
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
