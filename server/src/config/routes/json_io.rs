use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

pub(super) async fn read_jsonc_value(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    let raw = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| e.to_string())?;
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    let parsed: Value = json5::from_str(raw).map_err(|e| e.to_string())?;
    Ok(parsed)
}

pub(super) async fn write_json_value(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Saving JSONC via this endpoint rewrites as JSON and strips comments.
    // Create a timestamped backup when overwriting an existing .jsonc file.
    if path.exists() && path.extension().and_then(|s| s.to_str()) == Some("jsonc") {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let file_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("opencode.jsonc");
        let backup_path = path.with_file_name(format!("{file_name}.bak.{stamp}"));
        let _ = tokio::fs::copy(path, &backup_path).await;
    }

    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, json)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp, path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::write_json_value;
    use serde_json::json;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[tokio::test]
    async fn write_json_value_creates_backup_for_existing_jsonc() {
        let dir = tempdir().expect("tempdir");
        let path: PathBuf = dir.path().join("opencode.jsonc");

        // Seed an existing JSONC file with comments.
        tokio::fs::write(&path, "// comment\n{\n  a: 1,\n}\n")
            .await
            .expect("write seed");

        write_json_value(&path, &json!({"a": 2}))
            .await
            .expect("write");

        // The target is now JSON (pretty printed).
        let out = tokio::fs::read_to_string(&path).await.expect("read");
        assert!(out.contains("\"a\": 2"));

        // There should be a timestamped backup alongside the file.
        let mut found_backup = false;
        let mut rd = tokio::fs::read_dir(dir.path()).await.expect("readdir");
        while let Some(ent) = rd.next_entry().await.expect("next") {
            let name = ent.file_name().to_string_lossy().into_owned();
            if name.starts_with("opencode.jsonc.bak.") {
                found_backup = true;
                let bak = tokio::fs::read_to_string(ent.path())
                    .await
                    .expect("read backup");
                assert!(bak.contains("// comment"));
            }
        }
        assert!(found_backup, "expected a .bak timestamped file");
    }

    #[tokio::test]
    async fn write_json_value_does_not_create_backup_for_json() {
        let dir = tempdir().expect("tempdir");
        let path: PathBuf = dir.path().join("opencode.json");

        tokio::fs::write(&path, "{\n  \"a\": 1\n}\n")
            .await
            .expect("write seed");

        write_json_value(&path, &json!({"a": 2}))
            .await
            .expect("write");

        let mut rd = tokio::fs::read_dir(dir.path()).await.expect("readdir");
        while let Some(ent) = rd.next_entry().await.expect("next") {
            let name = ent.file_name().to_string_lossy().into_owned();
            assert!(!name.starts_with("opencode.json.bak."));
        }
    }
}
