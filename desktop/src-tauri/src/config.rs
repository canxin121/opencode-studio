use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DesktopConfig {
    #[serde(default = "default_autostart_on_boot")]
    pub autostart_on_boot: bool,
    pub backend: BackendConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BackendConfig {
    pub host: String,
    pub port: u16,
    pub cors_origins: Vec<String>,
    pub cors_allow_all: bool,
    pub backend_log_level: Option<String>,
    pub ui_password: Option<String>,

    // OpenCode connectivity overrides.
    pub opencode_host: String,
    pub opencode_port: Option<u16>,
    pub skip_opencode_start: bool,
    pub opencode_log_level: Option<String>,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            autostart_on_boot: default_autostart_on_boot(),
            backend: BackendConfig::default(),
        }
    }
}

fn default_autostart_on_boot() -> bool {
    true
}

impl Default for BackendConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 3000,
            cors_origins: Vec::new(),
            cors_allow_all: false,
            backend_log_level: None,
            ui_password: None,
            opencode_host: "127.0.0.1".to_string(),
            opencode_port: None,
            skip_opencode_start: false,
            opencode_log_level: None,
        }
    }
}

pub fn config_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("desktop-config.json"))
}

pub fn load_or_create(app: &AppHandle) -> Result<DesktopConfig, String> {
    let path = config_path(app).ok_or_else(|| "unable to resolve app config dir".to_string())?;
    ensure_parent_dir(&path)?;

    if path.exists() {
        let txt = fs::read_to_string(&path).map_err(|e| format!("read config: {e}"))?;
        let cfg =
            normalize_config(serde_json::from_str(&txt).map_err(|e| format!("parse config: {e}"))?);
        return Ok(cfg);
    }

    let cfg = normalize_config(DesktopConfig::default());
    let txt = serde_json::to_string_pretty(&cfg).map_err(|e| format!("serialize config: {e}"))?;
    fs::write(&path, format!("{txt}\n")).map_err(|e| format!("write config: {e}"))?;
    Ok(cfg)
}

pub fn save(app: &AppHandle, cfg: DesktopConfig) -> Result<DesktopConfig, String> {
    let path = config_path(app).ok_or_else(|| "unable to resolve app config dir".to_string())?;
    ensure_parent_dir(&path)?;

    let normalized = normalize_config(cfg);
    let txt =
        serde_json::to_string_pretty(&normalized).map_err(|e| format!("serialize config: {e}"))?;
    fs::write(&path, format!("{txt}\n")).map_err(|e| format!("write config: {e}"))?;
    Ok(normalized)
}

pub fn open_config_file(app: &AppHandle) -> Result<(), String> {
    let path = config_path(app).ok_or_else(|| "unable to resolve app config dir".to_string())?;
    ensure_parent_dir(&path)?;

    // If the config does not exist yet, create it.
    if !path.exists() {
        let _ = load_or_create(app)?;
    }

    use tauri_plugin_opener::OpenerExt;
    let _ = app
        .opener()
        .open_path(path.to_string_lossy().as_ref(), None::<&str>);
    Ok(())
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {parent:?}: {e}"))?;
    }
    Ok(())
}

fn normalize_config(mut cfg: DesktopConfig) -> DesktopConfig {
    cfg.backend.host = normalize_host(&cfg.backend.host);
    cfg.backend.opencode_host = normalize_host(&cfg.backend.opencode_host);
    cfg.backend.cors_origins = normalize_cors_origins(cfg.backend.cors_origins);
    cfg.backend.backend_log_level = normalize_log_level(cfg.backend.backend_log_level.take());
    cfg.backend.opencode_log_level = normalize_log_level(cfg.backend.opencode_log_level.take());
    cfg
}

fn normalize_host(raw: &str) -> String {
    let v = raw.trim();
    if v.is_empty() {
        "127.0.0.1".to_string()
    } else {
        v.to_string()
    }
}

fn normalize_cors_origins(values: Vec<String>) -> Vec<String> {
    let mut out = Vec::<String>::new();
    for raw in values {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !out.iter().any(|v| v == trimmed) {
            out.push(trimmed.to_string());
        }
    }
    out
}

fn normalize_log_level(raw: Option<String>) -> Option<String> {
    let level = raw?.trim().to_ascii_uppercase();
    match level.as_str() {
        "DEBUG" | "INFO" | "WARN" | "ERROR" => Some(level),
        _ => None,
    }
}
