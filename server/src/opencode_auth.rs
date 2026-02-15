use std::path::{Path, PathBuf};

use serde_json::Value;

fn opencode_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    Path::new(&home)
        .join(".local")
        .join("share")
        .join("opencode")
}

fn auth_file_path() -> PathBuf {
    opencode_data_dir().join("auth.json")
}

fn read_auth_file_inner() -> Result<Value, String> {
    let path = auth_file_path();
    if !path.exists() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    serde_json::from_str::<Value>(trimmed)
        .map_err(|_| "Failed to read OpenCode auth configuration".to_string())
}

pub fn get_provider_auth(provider_id: &str) -> Result<Option<Value>, String> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return Err("Provider ID is required".to_string());
    }
    let auth = read_auth_file_inner()?;
    Ok(auth.get(provider_id).cloned())
}
