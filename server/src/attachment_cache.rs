use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use sha2::{Digest as _, Sha256};
use tokio::sync::Mutex;

const CACHE_SCHEMA_VERSION: i64 = 1;
const CACHE_BUSY_TIMEOUT_MS: u64 = 5000;

#[derive(Clone)]
pub(crate) struct AttachmentCacheManager {
    root: PathBuf,
    db_path: PathBuf,
    initialized: Arc<AtomicBool>,
    init_lock: Arc<Mutex<()>>,
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
            initialized: Arc::new(AtomicBool::new(false)),
            init_lock: Arc::new(Mutex::new(())),
        }
    }

    async fn ensure_initialized(&self) -> Result<(), String> {
        if self.initialized.load(Ordering::Acquire) {
            return Ok(());
        }

        let _guard = self.init_lock.lock().await;
        if self.initialized.load(Ordering::Acquire) {
            return Ok(());
        }

        let root = self.root.clone();
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || initialize_cache_store(&root, &db_path))
            .await
            .map_err(|err| err.to_string())??;

        self.initialized.store(true, Ordering::Release);
        Ok(())
    }

    pub(crate) async fn data_url_for_file(
        &self,
        source: &Path,
        mime: &str,
    ) -> Result<String, String> {
        self.ensure_initialized().await?;

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
        self.ensure_initialized().await?;

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
        let db_path = self.db_path.clone();
        let root = self.root.clone();
        let source = source.clone();
        let mime = mime.to_string();
        let mime_for_data_url = mime.clone();

        tokio::task::spawn_blocking(move || {
            let conn = open_cache_connection(&db_path)?;
            let found: Option<String> = conn
                .query_row(
                    "SELECT blob_rel_path FROM source_index WHERE source_path = ?1 AND source_mtime_ns = ?2 AND source_size = ?3 AND mime = ?4",
                    rusqlite::params![
                        source.source_path,
                        source.source_mtime_ns,
                        source.source_size,
                        mime,
                    ],
                    |row| row.get::<_, String>(0),
                )
                .ok();

            let Some(rel_path) = found else {
                return Ok(None);
            };

            let blob_path = root.join(&rel_path);
            let encoded = std::fs::read_to_string(&blob_path).ok();
            let Some(encoded) = encoded else {
                let _ = conn.execute(
                    "DELETE FROM source_index WHERE source_path = ?1 AND source_mtime_ns = ?2 AND source_size = ?3 AND mime = ?4",
                    rusqlite::params![
                        source.source_path,
                        source.source_mtime_ns,
                        source.source_size,
                        mime,
                    ],
                );
                return Ok(None);
            };

            let now = now_unix_ms();
            let _ = conn.execute(
                "UPDATE source_index SET last_accessed_at = ?1, hit_count = hit_count + 1 WHERE source_path = ?2 AND source_mtime_ns = ?3 AND source_size = ?4 AND mime = ?5",
                rusqlite::params![
                    now,
                    source.source_path,
                    source.source_mtime_ns,
                    source.source_size,
                    mime,
                ],
            );
            let _ = conn.execute(
                "UPDATE blob_store SET last_accessed_at = ?1 WHERE rel_path = ?2",
                rusqlite::params![now, rel_path],
            );

            Ok(Some(encoded))
        })
        .await
        .map_err(|err| err.to_string())?
        .map(|opt| {
            opt.map(|encoded| format!("data:{};base64,{}", mime_for_data_url, encoded))
        })
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

        let db_path = self.db_path.clone();
        let source = source.clone();
        let mime = mime.to_string();
        let rel_path_for_db = rel_path.to_string_lossy().to_string();
        let digest_for_db = digest.clone();
        let bytes_size = i64::try_from(bytes.len()).unwrap_or(i64::MAX);

        tokio::task::spawn_blocking(move || {
            let mut conn = open_cache_connection(&db_path)?;
            let tx = conn.transaction().map_err(|err| err.to_string())?;
            let now = now_unix_ms();

            tx.execute(
                "INSERT INTO blob_store (digest_sha256, rel_path, bytes_size, created_at, last_accessed_at)\n                 VALUES (?1, ?2, ?3, ?4, ?4)\n                 ON CONFLICT(digest_sha256) DO UPDATE SET\n                   rel_path = excluded.rel_path,\n                   bytes_size = excluded.bytes_size,\n                   last_accessed_at = excluded.last_accessed_at",
                rusqlite::params![digest_for_db, rel_path_for_db, bytes_size, now],
            )
            .map_err(|err| err.to_string())?;

            tx.execute(
                "INSERT INTO source_index (source_path, source_mtime_ns, source_size, mime, digest_sha256, blob_rel_path, created_at, last_accessed_at, hit_count)\n                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 0)\n                 ON CONFLICT(source_path, source_mtime_ns, source_size, mime) DO UPDATE SET\n                   digest_sha256 = excluded.digest_sha256,\n                   blob_rel_path = excluded.blob_rel_path,\n                   last_accessed_at = excluded.last_accessed_at",
                rusqlite::params![
                    source.source_path,
                    source.source_mtime_ns,
                    source.source_size,
                    mime,
                    digest,
                    rel_path_for_db,
                    now,
                ],
            )
            .map_err(|err| err.to_string())?;

            tx.commit().map_err(|err| err.to_string())
        })
        .await
        .map_err(|err| err.to_string())??;

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

fn open_cache_connection(path: &Path) -> Result<rusqlite::Connection, String> {
    let conn = rusqlite::Connection::open(path).map_err(|err| err.to_string())?;
    let _ = conn.busy_timeout(std::time::Duration::from_millis(CACHE_BUSY_TIMEOUT_MS));
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    let _ = conn.pragma_update(None, "temp_store", "MEMORY");
    Ok(conn)
}

fn initialize_cache_store(root: &Path, db_path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|err| err.to_string())?;
    let conn = open_cache_connection(db_path)?;
    conn.execute_batch(
        "PRAGMA user_version = 1;\n         CREATE TABLE IF NOT EXISTS source_index (\n           source_path TEXT NOT NULL,\n           source_mtime_ns INTEGER NOT NULL,\n           source_size INTEGER NOT NULL,\n           mime TEXT NOT NULL,\n           digest_sha256 TEXT NOT NULL,\n           blob_rel_path TEXT NOT NULL,\n           created_at INTEGER NOT NULL,\n           last_accessed_at INTEGER NOT NULL,\n           hit_count INTEGER NOT NULL DEFAULT 0,\n           PRIMARY KEY (source_path, source_mtime_ns, source_size, mime)\n         );\n         CREATE TABLE IF NOT EXISTS blob_store (\n           digest_sha256 TEXT PRIMARY KEY,\n           rel_path TEXT NOT NULL,\n           bytes_size INTEGER NOT NULL,\n           created_at INTEGER NOT NULL,\n           last_accessed_at INTEGER NOT NULL\n         );\n         CREATE INDEX IF NOT EXISTS idx_source_index_last_accessed\n           ON source_index(last_accessed_at DESC);",
    )
    .map_err(|err| err.to_string())?;

    let _ = conn.pragma_update(None, "user_version", CACHE_SCHEMA_VERSION);
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
