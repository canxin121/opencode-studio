use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub projects: Vec<Project>,

    // Optional configuration knobs used by GitHub device flow.
    #[serde(default)]
    pub github_client_id: Option<String>,
    #[serde(default)]
    pub github_scopes: Option<String>,

    // Preserve unknown fields so we can round-trip settings.json even when
    // only a subset is explicitly modeled.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub path: String,
    #[serde(default)]
    pub added_at: i64,
    #[serde(default)]
    pub last_opened_at: i64,
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn opencode_studio_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OPENCODE_STUDIO_DATA_DIR")
        && !dir.trim().is_empty()
    {
        return PathBuf::from(dir);
    }

    home_dir().join(".config").join("opencode-studio")
}

pub fn settings_path() -> PathBuf {
    opencode_studio_data_dir().join("settings.json")
}

async fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let raw = tokio::fs::read_to_string(path).await.ok()?;
    serde_json::from_str(&raw).ok()
}

fn parse_settings(value: serde_json::Value) -> Settings {
    serde_json::from_value::<Settings>(value).unwrap_or_default()
}

pub async fn init_settings() -> (PathBuf, Settings) {
    let path = settings_path();

    if let Some(value) = read_json_file(&path).await {
        return (path, parse_settings(value));
    }

    (path, Settings::default())
}

pub async fn persist_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");

    tokio::fs::write(&tmp, json)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp, path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
