use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::studio_db;

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

    // Preserve unknown fields so we can round-trip the settings file even when
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

async fn read_settings_file(path: &Path) -> Option<Settings> {
    let raw = tokio::fs::read_to_string(path).await.ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str::<Settings>(trimmed).ok()
}

async fn file_mtime_ms(path: &Path) -> u64 {
    let meta = match tokio::fs::metadata(path).await {
        Ok(meta) => meta,
        Err(_) => return 0,
    };
    let modified = match meta.modified() {
        Ok(m) => m,
        Err(_) => return 0,
    };
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn settings_disk_candidates() -> Vec<PathBuf> {
    let mut out = Vec::<PathBuf>::new();
    for path in crate::persistence_paths::studio_settings_path_candidates() {
        out.push(path.clone());
        // Prior versions used atomic writes via `*.json.tmp`.
        out.push(path.with_extension("json.tmp"));
    }

    let mut deduped = Vec::<PathBuf>::new();
    let mut seen = HashSet::<PathBuf>::new();
    for path in out {
        if seen.insert(path.clone()) {
            deduped.push(path);
        }
    }
    deduped
}

async fn read_best_settings_from_disk() -> Option<Settings> {
    let mut best: Option<(u64, Settings)> = None;
    for path in settings_disk_candidates() {
        let Some(settings) = read_settings_file(&path).await else {
            continue;
        };
        let ts = file_mtime_ms(&path).await;
        match best.as_ref() {
            None => best = Some((ts, settings)),
            Some((best_ts, _)) if ts > *best_ts => best = Some((ts, settings)),
            _ => {}
        }
    }
    best.map(|(_, settings)| settings)
}

pub async fn init_settings(db: &studio_db::StudioDb) -> Settings {
    if let Ok(Some(settings)) = db.get_json::<Settings>(studio_db::KV_KEY_SETTINGS).await {
        return settings;
    }

    if let Some(settings) = read_best_settings_from_disk().await {
        let _ = db.set_json(studio_db::KV_KEY_SETTINGS, &settings).await;
        return settings;
    }

    let settings = Settings::default();
    let _ = db.set_json(studio_db::KV_KEY_SETTINGS, &settings).await;
    settings
}

pub async fn persist_settings(db: &studio_db::StudioDb, settings: &Settings) -> Result<(), String> {
    db.set_json(studio_db::KV_KEY_SETTINGS, settings).await
}
