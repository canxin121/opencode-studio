use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DesktopConfig {
    pub backend: BackendConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BackendConfig {
    pub host: String,
    pub port: u16,
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
            backend: BackendConfig::default(),
        }
    }
}

impl Default for BackendConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 3000,
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
        let cfg: DesktopConfig =
            serde_json::from_str(&txt).map_err(|e| format!("parse config: {e}"))?;
        return Ok(cfg);
    }

    let cfg = DesktopConfig::default();
    let txt = serde_json::to_string_pretty(&cfg).map_err(|e| format!("serialize config: {e}"))?;
    fs::write(&path, format!("{txt}\n")).map_err(|e| format!("write config: {e}"))?;
    Ok(cfg)
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
