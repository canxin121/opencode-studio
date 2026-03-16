use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use sha2::{Digest as _, Sha256};

use crate::studio_db;

#[derive(Clone)]
pub(crate) struct AttachmentCacheManager {
    db: Arc<studio_db::StudioDb>,
}

#[derive(Debug, Clone)]
struct SourceSnapshot {
    source_path: String,
    source_mtime_ns: i64,
    source_size: i64,
}

impl AttachmentCacheManager {
    pub(crate) fn new(db: Arc<studio_db::StudioDb>) -> Self {
        Self { db }
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
        let pool = self.db.pool();
        let source = source.clone();
        let mime = mime.to_string();
        let mime_for_data_url = mime.clone();

        let found = sqlx::query_scalar::<_, String>(
            "SELECT digest_sha256 FROM attachment_cache_source_index\n             WHERE source_path = ? AND source_mtime_ns = ? AND source_size = ? AND mime = ?\n             LIMIT 1",
        )
        .bind(&source.source_path)
        .bind(source.source_mtime_ns)
        .bind(source.source_size)
        .bind(&mime)
        .fetch_optional(pool)
        .await
        .map_err(|err| err.to_string())?;

        let Some(digest) = found else {
            return Ok(None);
        };

        let encoded = sqlx::query_scalar::<_, String>(
            "SELECT bytes_b64 FROM attachment_cache_blob_store WHERE digest_sha256 = ? LIMIT 1",
        )
        .bind(&digest)
        .fetch_optional(pool)
        .await
        .map_err(|err| err.to_string())?;

        let Some(encoded) = encoded else {
            let _ = sqlx::query(
                "DELETE FROM attachment_cache_source_index\n                 WHERE source_path = ? AND source_mtime_ns = ? AND source_size = ? AND mime = ?",
            )
            .bind(&source.source_path)
            .bind(source.source_mtime_ns)
            .bind(source.source_size)
            .bind(&mime)
            .execute(pool)
            .await;
            return Ok(None);
        };

        let now = now_unix_ms();
        let _ = sqlx::query(
            "UPDATE attachment_cache_source_index\n             SET last_accessed_at = ?, hit_count = hit_count + 1\n             WHERE source_path = ? AND source_mtime_ns = ? AND source_size = ? AND mime = ?",
        )
        .bind(now)
        .bind(&source.source_path)
        .bind(source.source_mtime_ns)
        .bind(source.source_size)
        .bind(&mime)
        .execute(pool)
        .await;
        let _ = sqlx::query(
            "UPDATE attachment_cache_blob_store SET last_accessed_at = ? WHERE digest_sha256 = ?",
        )
        .bind(now)
        .bind(&digest)
        .execute(pool)
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
        let pool = self.db.pool();
        let source = source.clone();
        let mime = mime.to_string();
        let digest_for_db = digest.clone();
        let bytes_size = i64::try_from(bytes.len()).unwrap_or(i64::MAX);

        let mut tx = pool.begin().await.map_err(|err| err.to_string())?;
        let now = now_unix_ms();

        sqlx::query(
            "INSERT INTO attachment_cache_blob_store\n               (digest_sha256, bytes_b64, bytes_size, created_at, last_accessed_at)\n             VALUES (?, ?, ?, ?, ?)\n             ON CONFLICT(digest_sha256) DO UPDATE SET\n               bytes_b64 = excluded.bytes_b64,\n               bytes_size = excluded.bytes_size,\n               last_accessed_at = excluded.last_accessed_at",
        )
        .bind(&digest_for_db)
        .bind(encoded)
        .bind(bytes_size)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;

        sqlx::query(
            "INSERT INTO attachment_cache_source_index\n               (source_path, source_mtime_ns, source_size, mime, digest_sha256, created_at, last_accessed_at, hit_count)\n             VALUES (?, ?, ?, ?, ?, ?, ?, 0)\n             ON CONFLICT(source_path, source_mtime_ns, source_size, mime) DO UPDATE SET\n               digest_sha256 = excluded.digest_sha256,\n               last_accessed_at = excluded.last_accessed_at",
        )
        .bind(&source.source_path)
        .bind(source.source_mtime_ns)
        .bind(source.source_size)
        .bind(&mime)
        .bind(&digest)
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
        let _home = EnvVarGuard::set("HOME", tmp.to_string_lossy().to_string());

        let studio_db = Arc::new(
            crate::studio_db::StudioDb::open()
                .await
                .expect("open studio db"),
        );

        let source = tmp.join("workspace").join("hello.txt");
        if let Some(parent) = source.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        tokio::fs::write(&source, b"hello world").await.unwrap();

        let cache = AttachmentCacheManager::new(studio_db);
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
        let _home = EnvVarGuard::set("HOME", tmp.to_string_lossy().to_string());

        let studio_db = Arc::new(
            crate::studio_db::StudioDb::open()
                .await
                .expect("open studio db"),
        );

        let source = tmp.join("workspace").join("upload.bin");
        if let Some(parent) = source.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        let bytes = b"cached upload bytes";
        tokio::fs::write(&source, bytes).await.unwrap();

        let cache = AttachmentCacheManager::new(studio_db);
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
