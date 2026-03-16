use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

const DB_BUSY_TIMEOUT_MS: u64 = 15000;
const DB_POOL_MAX_CONNECTIONS: u32 = 8;
const DB_POOL_ACQUIRE_TIMEOUT_MS: u64 = 1500;
const DB_POOL_IDLE_TIMEOUT_SECS: u64 = 120;

pub(crate) const KV_KEY_SETTINGS: &str = "settings";
pub(crate) const KV_KEY_CHAT_SIDEBAR_PREFERENCES: &str = "ui.chatSidebar.preferences";
pub(crate) const KV_KEY_TERMINAL_UI_STATE: &str = "ui.terminal.state";
pub(crate) const KV_KEY_TERMINAL_SESSION_REGISTRY: &str = "terminal.sessionRegistry";
pub(crate) const KV_KEY_WORKSPACE_PREVIEW_STUDIO_STATE: &str = "workspacePreview.state.studio";

pub(crate) const STUDIO_DB_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone)]
pub(crate) struct StudioDb {
    path: PathBuf,
    pool: SqlitePool,
}

impl StudioDb {
    pub(crate) async fn open() -> Result<Self, String> {
        let selected = crate::persistence_paths::studio_db_path();
        let path = maybe_migrate_legacy_db_path(selected).await;
        Self::open_at_path(path).await
    }

    pub(crate) async fn open_at_path(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|err| err.to_string())?;
        }

        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .busy_timeout(Duration::from_millis(DB_BUSY_TIMEOUT_MS))
            .pragma("journal_mode", "WAL")
            .pragma("synchronous", "NORMAL")
            .pragma("foreign_keys", "ON")
            .pragma("temp_store", "MEMORY");

        let pool = SqlitePoolOptions::new()
            .max_connections(DB_POOL_MAX_CONNECTIONS)
            .acquire_timeout(Duration::from_millis(DB_POOL_ACQUIRE_TIMEOUT_MS))
            .idle_timeout(Some(Duration::from_secs(DB_POOL_IDLE_TIMEOUT_SECS)))
            .connect_with(options)
            .await
            .map_err(|err| err.to_string())?;

        initialize_schema(&pool).await?;

        Ok(Self { path, pool })
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    #[allow(dead_code)]
    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub(crate) async fn get_value(&self, key: &str) -> Result<Option<Value>, String> {
        let key = normalize_kv_key(key)?;
        let raw = sqlx::query_scalar::<_, String>(
            "SELECT value_json FROM studio_kv WHERE key = ? LIMIT 1",
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| err.to_string())?;

        let Some(raw) = raw else {
            return Ok(None);
        };
        serde_json::from_str::<Value>(&raw)
            .map(Some)
            .map_err(|err| err.to_string())
    }

    pub(crate) async fn set_value(&self, key: &str, value: &Value) -> Result<(), String> {
        let key = normalize_kv_key(key)?;
        let payload = serde_json::to_string(value).map_err(|err| err.to_string())?;
        let now = now_unix_ms();
        sqlx::query(
            "INSERT INTO studio_kv (key, value_json, updated_at) VALUES (?, ?, ?)\n             ON CONFLICT(key) DO UPDATE SET\n               value_json = excluded.value_json,\n               updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(payload)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub(crate) async fn get_json<T: DeserializeOwned>(
        &self,
        key: &str,
    ) -> Result<Option<T>, String> {
        let Some(value) = self.get_value(key).await? else {
            return Ok(None);
        };
        serde_json::from_value::<T>(value)
            .map(Some)
            .map_err(|err| err.to_string())
    }

    pub(crate) async fn set_json<T: Serialize>(&self, key: &str, value: &T) -> Result<(), String> {
        let json = serde_json::to_value(value).map_err(|err| err.to_string())?;
        self.set_value(key, &json).await
    }
}

fn sqlite_sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
    let mut buf = db_path.as_os_str().to_os_string();
    buf.push(suffix);
    PathBuf::from(buf)
}

async fn maybe_migrate_legacy_db_path(selected: PathBuf) -> PathBuf {
    let legacy_name = crate::persistence_paths::LEGACY_STUDIO_DB_FILE;
    let legacy_typo = crate::persistence_paths::LEGACY_STUDIO_DB_FILE_TYPO;
    let new_name = crate::persistence_paths::STUDIO_DB_FILE;

    let is_legacy = selected
        .file_name()
        .and_then(|v| v.to_str())
        .is_some_and(|name| name == legacy_name || name == legacy_typo);
    if !is_legacy {
        return selected;
    }

    let legacy_meta = match tokio::fs::metadata(&selected).await {
        Ok(meta) => meta,
        Err(_) => return selected,
    };
    if !legacy_meta.is_file() {
        return selected;
    }

    let new_path = selected.with_file_name(new_name);
    let new_meta = tokio::fs::metadata(&new_path).await.ok();
    let new_is_empty_file = new_meta
        .as_ref()
        .is_some_and(|m| m.is_file() && m.len() == 0);

    if new_meta.is_some() && !new_is_empty_file {
        // New DB already exists and is not empty; keep using legacy-selected path.
        return selected;
    }

    if new_is_empty_file {
        // Cleanup an empty placeholder so rename can succeed.
        let _ = tokio::fs::remove_file(&new_path).await;
        let _ = tokio::fs::remove_file(sqlite_sidecar_path(&new_path, "-wal")).await;
        let _ = tokio::fs::remove_file(sqlite_sidecar_path(&new_path, "-shm")).await;
    }

    let legacy_wal = sqlite_sidecar_path(&selected, "-wal");
    let legacy_wal_has_data = tokio::fs::metadata(&legacy_wal)
        .await
        .ok()
        .is_some_and(|m| m.is_file() && m.len() > 0);

    // Best-effort checkpoint so we don't lose data on rename.
    if let Err(error) = try_checkpoint_wal(&selected).await {
        if legacy_wal_has_data {
            tracing::warn!(
                target: "opencode_studio.storage",
                legacy = %selected.display(),
                error = %error,
                "Legacy studio db has a WAL file but could not checkpoint; skipping db rename"
            );
            return selected;
        }

        tracing::debug!(
            target: "opencode_studio.storage",
            legacy = %selected.display(),
            error = %error,
            "Failed to checkpoint legacy studio db WAL; attempting rename anyway"
        );
    }

    if let Err(error) = tokio::fs::rename(&selected, &new_path).await {
        tracing::warn!(
            target: "opencode_studio.storage",
            legacy = %selected.display(),
            new = %new_path.display(),
            error = %error,
            "Failed to rename legacy studio db"
        );
        return selected;
    }

    for suffix in ["-wal", "-shm"] {
        let old_sidecar = sqlite_sidecar_path(&selected, suffix);
        let new_sidecar = sqlite_sidecar_path(&new_path, suffix);
        if tokio::fs::metadata(&old_sidecar).await.is_err() {
            continue;
        }
        if tokio::fs::metadata(&new_sidecar).await.is_ok() {
            continue;
        }
        if let Err(error) = tokio::fs::rename(&old_sidecar, &new_sidecar).await {
            tracing::warn!(
                target: "opencode_studio.storage",
                from = %old_sidecar.display(),
                to = %new_sidecar.display(),
                error = %error,
                "Failed to migrate legacy studio db sidecar"
            );
        }
    }

    new_path
}

async fn try_checkpoint_wal(path: &Path) -> Result<(), String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .busy_timeout(Duration::from_millis(500));

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_millis(300))
        .connect_with(options)
        .await
        .map_err(|err| err.to_string())?;

    // Ignore checkpoint errors (e.g. DB not in WAL mode).
    let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&pool)
        .await;

    pool.close().await;
    Ok(())
}

async fn initialize_schema(pool: &SqlitePool) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|err| err.to_string())?;

    // Keep a DB-level schema marker for offline inspection.
    let _ = sqlx::query(&format!("PRAGMA user_version = {STUDIO_DB_SCHEMA_VERSION}"))
        .execute(&mut *tx)
        .await;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS studio_meta (\n           key TEXT PRIMARY KEY,\n           value TEXT NOT NULL\n         )",
    )
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS studio_kv (\n           key TEXT PRIMARY KEY,\n           value_json TEXT NOT NULL,\n           updated_at INTEGER NOT NULL\n         )",
    )
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_studio_kv_updated_at ON studio_kv(updated_at DESC)",
    )
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    // Attachment cache tables.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS attachment_cache_blob_store (\n           digest_sha256 TEXT PRIMARY KEY,\n           bytes_b64 TEXT NOT NULL,\n           bytes_size INTEGER NOT NULL,\n           created_at INTEGER NOT NULL,\n           last_accessed_at INTEGER NOT NULL\n         )",
    )
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS attachment_cache_source_index (\n           source_path TEXT NOT NULL,\n           source_mtime_ns INTEGER NOT NULL,\n           source_size INTEGER NOT NULL,\n           mime TEXT NOT NULL,\n           digest_sha256 TEXT NOT NULL,\n           created_at INTEGER NOT NULL,\n           last_accessed_at INTEGER NOT NULL,\n           hit_count INTEGER NOT NULL DEFAULT 0,\n           PRIMARY KEY (source_path, source_mtime_ns, source_size, mime)\n         )",
    )
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_attachment_cache_source_last_accessed\n           ON attachment_cache_source_index(last_accessed_at DESC)",
    )
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_attachment_cache_blob_last_accessed\n           ON attachment_cache_blob_store(last_accessed_at DESC)",
    )
    .execute(&mut *tx)
    .await
    .map_err(|err| err.to_string())?;

    tx.commit().await.map_err(|err| err.to_string())?;
    Ok(())
}

fn normalize_kv_key(key: &str) -> Result<&str, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("db key is required".to_string());
    }
    if trimmed.len() > 200 {
        return Err("db key is too long".to_string());
    }
    Ok(trimmed)
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
