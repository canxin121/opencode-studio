use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use sha2::{Digest as _, Sha256};
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tokio::sync::Mutex;

const CACHE_SCHEMA_VERSION: i64 = 1;
const CACHE_BUSY_TIMEOUT_MS: u64 = 5000;
const CACHE_POOL_MAX_CONNECTIONS: u32 = 4;
const CACHE_POOL_ACQUIRE_TIMEOUT_MS: u64 = 1500;
const CACHE_POOL_IDLE_TIMEOUT_SECS: u64 = 120;

#[derive(Clone)]
pub(crate) struct AttachmentCacheManager {
    root: PathBuf,
    db_path: PathBuf,
    pool: Arc<Mutex<Option<SqlitePool>>>,
}

#[derive(Debug, Clone)]
struct SourceSnapshot {
    source_path: String,
    source_mtime_ns: i64,
    source_size: i64,
}

impl AttachmentCacheManager {
    pub(crate) fn new() -> Self {
        let root = crate::path_utils::opencode_data_dir().join("attachment-cache");
        let db_path = root.join("index.sqlite3");
        Self {
            root,
            db_path,
            pool: Arc::new(Mutex::new(None)),
        }
    }

    async fn pool(&self) -> Result<SqlitePool, String> {
        let mut guard = self.pool.lock().await;
        if let Some(pool) = guard.as_ref() {
            return Ok(pool.clone());
        }

        tokio::fs::create_dir_all(&self.root)
            .await
            .map_err(|err| err.to_string())?;

        let pool = open_cache_pool(&self.db_path).await?;
        initialize_cache_store(&pool).await?;
        *guard = Some(pool.clone());
        Ok(pool)
    }

    pub(crate) async fn data_url_for_file(
        &self,
        source: &Path,
        mime: &str,
    ) -> Result<String, String> {
        let source_abs = normalize_source_path(source)?;
        let meta = tokio::fs::metadata(&source_abs)
            .await
            .map_err(|err| err.to_string())?;
        if !meta.is_file() {
            return Err("attachment path is not a file".to_string());
        }

        let source = SourceSnapshot {
            source_path: source_abs.to_string_lossy().to_string(),
            source_mtime_ns: system_time_to_ns(meta.modified().unwrap_or(UNIX_EPOCH)),
            source_size: i64::try_from(meta.len()).unwrap_or(i64::MAX),
        };
        let mime = normalize_mime(mime);

        if let Some(hit) = self.lookup_cached_data_url(&source, &mime).await? {
            return Ok(hit);
        }

        let bytes = tokio::fs::read(&source_abs)
            .await
            .map_err(|err| err.to_string())?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);

        self.persist_data_url(&source, &mime, &bytes, &encoded)
            .await?;
        Ok(format!("data:{};base64,{}", mime, encoded))
    }

    pub(crate) async fn register_uploaded_file(
        &self,
        source: &Path,
        bytes: &[u8],
        mime: &str,
    ) -> Result<(), String> {
        let source_abs = normalize_source_path(source)?;
        let meta = tokio::fs::metadata(&source_abs)
            .await
            .map_err(|err| err.to_string())?;
        if !meta.is_file() {
            return Ok(());
        }

        let source = SourceSnapshot {
            source_path: source_abs.to_string_lossy().to_string(),
            source_mtime_ns: system_time_to_ns(meta.modified().unwrap_or(UNIX_EPOCH)),
            source_size: i64::try_from(meta.len()).unwrap_or(i64::MAX),
        };
        let mime = normalize_mime(mime);
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        self.persist_data_url(&source, &mime, bytes, &encoded).await
    }

    async fn lookup_cached_data_url(
        &self,
        source: &SourceSnapshot,
        mime: &str,
    ) -> Result<Option<String>, String> {
        let pool = self.pool().await?;
        let root = self.root.clone();
        let source = source.clone();
        let mime = mime.to_string();
        let mime_for_data_url = mime.clone();

        let found = sqlx::query_scalar::<_, String>(
            "SELECT blob_rel_path FROM source_index WHERE source_path = ? AND source_mtime_ns = ? AND source_size = ? AND mime = ?",
        )
        .bind(&source.source_path)
        .bind(source.source_mtime_ns)
        .bind(source.source_size)
        .bind(&mime)
        .fetch_optional(&pool)
        .await
        .map_err(|err| err.to_string())?;

        let Some(rel_path) = found else {
            return Ok(None);
        };

        let blob_path = root.join(&rel_path);
        let encoded = tokio::fs::read_to_string(&blob_path).await.ok();
        let Some(encoded) = encoded else {
            let _ = sqlx::query(
                "DELETE FROM source_index WHERE source_path = ? AND source_mtime_ns = ? AND source_size = ? AND mime = ?",
            )
            .bind(&source.source_path)
            .bind(source.source_mtime_ns)
            .bind(source.source_size)
            .bind(&mime)
            .execute(&pool)
            .await;
            return Ok(None);
        };

        let now = now_unix_ms();
        let _ = sqlx::query(
            "UPDATE source_index SET last_accessed_at = ?, hit_count = hit_count + 1 WHERE source_path = ? AND source_mtime_ns = ? AND source_size = ? AND mime = ?",
        )
        .bind(now)
        .bind(&source.source_path)
        .bind(source.source_mtime_ns)
        .bind(source.source_size)
        .bind(&mime)
        .execute(&pool)
        .await;
        let _ = sqlx::query("UPDATE blob_store SET last_accessed_at = ? WHERE rel_path = ?")
            .bind(now)
            .bind(&rel_path)
            .execute(&pool)
            .await;

        Ok(Some(format!(
            "data:{};base64,{}",
            mime_for_data_url, encoded
        )))
    }

    async fn persist_data_url(
        &self,
        source: &SourceSnapshot,
        mime: &str,
        bytes: &[u8],
        encoded: &str,
    ) -> Result<(), String> {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        let digest = format!("{:x}", hasher.finalize());
        let rel_path = blob_rel_path_for_digest(&digest);

        let blob_abs_path = self.root.join(&rel_path);
        if let Some(parent) = blob_abs_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|err| err.to_string())?;
        }

        if tokio::fs::metadata(&blob_abs_path).await.is_err() {
            let tmp_path = blob_abs_path.with_extension("b64.tmp");
            tokio::fs::write(&tmp_path, encoded)
                .await
                .map_err(|err| err.to_string())?;
            if let Err(err) = tokio::fs::rename(&tmp_path, &blob_abs_path).await {
                if tokio::fs::metadata(&blob_abs_path).await.is_err() {
                    return Err(err.to_string());
                }
                let _ = tokio::fs::remove_file(&tmp_path).await;
            }
        }

        let pool = self.pool().await?;
        let source = source.clone();
        let mime = mime.to_string();
        let rel_path_for_db = rel_path.to_string_lossy().to_string();
        let digest_for_db = digest.clone();
        let bytes_size = i64::try_from(bytes.len()).unwrap_or(i64::MAX);

        let mut tx = pool.begin().await.map_err(|err| err.to_string())?;
        let now = now_unix_ms();

        sqlx::query(
            "INSERT INTO blob_store (digest_sha256, rel_path, bytes_size, created_at, last_accessed_at)\n             VALUES (?, ?, ?, ?, ?)\n             ON CONFLICT(digest_sha256) DO UPDATE SET\n               rel_path = excluded.rel_path,\n               bytes_size = excluded.bytes_size,\n               last_accessed_at = excluded.last_accessed_at",
        )
        .bind(&digest_for_db)
        .bind(&rel_path_for_db)
        .bind(bytes_size)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "INSERT INTO source_index (source_path, source_mtime_ns, source_size, mime, digest_sha256, blob_rel_path, created_at, last_accessed_at, hit_count)\n             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)\n             ON CONFLICT(source_path, source_mtime_ns, source_size, mime) DO UPDATE SET\n               digest_sha256 = excluded.digest_sha256,\n               blob_rel_path = excluded.blob_rel_path,\n               last_accessed_at = excluded.last_accessed_at",
        )
        .bind(&source.source_path)
        .bind(source.source_mtime_ns)
        .bind(source.source_size)
        .bind(&mime)
        .bind(&digest)
        .bind(&rel_path_for_db)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;

        tx.commit().await.map_err(|err| err.to_string())?;

        Ok(())
    }
}

fn normalize_source_path(source: &Path) -> Result<PathBuf, String> {
    if source.is_absolute() {
        Ok(source.to_path_buf())
    } else {
        let cwd = std::env::current_dir().map_err(|err| err.to_string())?;
        Ok(cwd.join(source))
    }
}

fn normalize_mime(mime: &str) -> String {
    let trimmed = mime.trim();
    if trimmed.is_empty() {
        return "application/octet-stream".to_string();
    }
    trimmed.to_string()
}

fn blob_rel_path_for_digest(digest: &str) -> PathBuf {
    let prefix = digest.get(0..2).unwrap_or("00");
    PathBuf::from("blobs")
        .join(prefix)
        .join(format!("{digest}.b64"))
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn system_time_to_ns(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as i64)
        .unwrap_or(0)
}

async fn open_cache_pool(path: &Path) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .busy_timeout(Duration::from_millis(CACHE_BUSY_TIMEOUT_MS))
        .pragma("journal_mode", "WAL")
        .pragma("synchronous", "NORMAL")
        .pragma("temp_store", "MEMORY");

    SqlitePoolOptions::new()
        .max_connections(CACHE_POOL_MAX_CONNECTIONS)
        .acquire_timeout(Duration::from_millis(CACHE_POOL_ACQUIRE_TIMEOUT_MS))
        .idle_timeout(Some(Duration::from_secs(CACHE_POOL_IDLE_TIMEOUT_SECS)))
        .connect_with(options)
        .await
        .map_err(|err| err.to_string())
}

async fn initialize_cache_store(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(&format!("PRAGMA user_version = {CACHE_SCHEMA_VERSION}"))
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS source_index (
           source_path TEXT NOT NULL,
           source_mtime_ns INTEGER NOT NULL,
           source_size INTEGER NOT NULL,
           mime TEXT NOT NULL,
           digest_sha256 TEXT NOT NULL,
           blob_rel_path TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           last_accessed_at INTEGER NOT NULL,
           hit_count INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY (source_path, source_mtime_ns, source_size, mime)
         )",
    )
    .execute(pool)
    .await
    .map_err(|err| err.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS blob_store (
           digest_sha256 TEXT PRIMARY KEY,
           rel_path TEXT NOT NULL,
           bytes_size INTEGER NOT NULL,
           created_at INTEGER NOT NULL,
           last_accessed_at INTEGER NOT NULL
         )",
    )
    .execute(pool)
    .await
    .map_err(|err| err.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_source_index_last_accessed
           ON source_index(last_accessed_at DESC)",
    )
    .execute(pool)
    .await
    .map_err(|err| err.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::await_holding_lock)]

    use super::*;
    use crate::test_support::ENV_LOCK;

    struct EnvVarGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: String) -> Self {
            let prev = std::env::var(key).ok();
            unsafe {
                std::env::set_var(key, value);
            }
            Self { key, prev }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            unsafe {
                match self.prev.as_deref() {
                    Some(v) => std::env::set_var(self.key, v),
                    None => std::env::remove_var(self.key),
                }
            }
        }
    }

    fn unique_tmp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("opencode-studio-{label}-{nanos}"))
    }

    #[tokio::test]
    async fn attachment_cache_reuses_data_url_for_unchanged_file() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp = unique_tmp_dir("attachment-cache-reuse");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let source = tmp.join("workspace").join("hello.txt");
        if let Some(parent) = source.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        tokio::fs::write(&source, b"hello world").await.unwrap();

        let cache = AttachmentCacheManager::new();
        let first = cache
            .data_url_for_file(&source, "text/plain")
            .await
            .expect("cache encode");
        let second = cache
            .data_url_for_file(&source, "text/plain")
            .await
            .expect("cache hit");

        assert_eq!(first, second);
        assert!(first.starts_with("data:text/plain;base64,"));
    }

    #[tokio::test]
    async fn attachment_cache_registers_uploaded_file_for_followup_lookup() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp = unique_tmp_dir("attachment-cache-upload");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let source = tmp.join("workspace").join("upload.bin");
        if let Some(parent) = source.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        let bytes = b"cached upload bytes";
        tokio::fs::write(&source, bytes).await.unwrap();

        let cache = AttachmentCacheManager::new();
        cache
            .register_uploaded_file(&source, bytes, "application/octet-stream")
            .await
            .expect("register upload");

        let data_url = cache
            .data_url_for_file(&source, "application/octet-stream")
            .await
            .expect("lookup");
        assert!(data_url.contains("Y2FjaGVkIHVwbG9hZCBieXRlcw=="));
    }
}
