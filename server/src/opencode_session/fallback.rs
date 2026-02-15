use std::path::Path;

use serde_json::Value;
use tokio::fs;
use tokio::time::sleep;

use super::{FileCacheEntry, ResponseConsistency, STORAGE_CACHE};

const TRANSIENT_READ_RETRY_DELAYS_MS: [u64; 2] = [8, 24];

#[derive(Debug)]
pub(super) enum ReadJsonError {
    Io(std::io::Error),
    Json(serde_json::Error),
    TransientJson,
}

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct ReadJsonOutcome {
    pub(super) stale_cache: bool,
}

fn is_transient_json_payload(raw: &str, err: &serde_json::Error) -> bool {
    err.is_eof() || raw.trim().is_empty()
}

pub(super) fn mark_consistency_read_error(
    consistency: &mut ResponseConsistency,
    err: &ReadJsonError,
) {
    match err {
        ReadJsonError::TransientJson => consistency.note_transient_skip(),
        ReadJsonError::Json(_) => consistency.note_parse_skip(),
        ReadJsonError::Io(io_err) => {
            if io_err.kind() == std::io::ErrorKind::NotFound {
                consistency.note_transient_skip();
            } else {
                consistency.note_io_skip();
            }
        }
    }
}

pub(super) async fn read_json_value(
    path: &Path,
) -> Result<(Value, ReadJsonOutcome), ReadJsonError> {
    let meta = fs::metadata(path).await.map_err(ReadJsonError::Io)?;
    let modified = meta.modified().ok();
    let cached = STORAGE_CACHE
        .file_cache
        .get(path)
        .map(|entry| (entry.modified, entry.value.clone()));

    if let Some(modified) = modified {
        if let Some((cached_modified, cached_value)) = cached.as_ref() {
            if *cached_modified == modified {
                return Ok((cached_value.clone(), ReadJsonOutcome::default()));
            }
        }
    }

    let mut attempt = 0usize;
    let value = loop {
        let raw = fs::read_to_string(path).await.map_err(ReadJsonError::Io)?;
        match serde_json::from_str::<Value>(&raw) {
            Ok(value) => break value,
            Err(err) => {
                // OpenCode may rewrite JSON files in place. For transient partial
                // payloads, prefer cached snapshots and otherwise retry briefly.
                if is_transient_json_payload(&raw, &err) {
                    if let Some((_, cached_value)) = cached.as_ref() {
                        return Ok((cached_value.clone(), ReadJsonOutcome { stale_cache: true }));
                    }

                    if attempt < TRANSIENT_READ_RETRY_DELAYS_MS.len() {
                        let delay = TRANSIENT_READ_RETRY_DELAYS_MS[attempt];
                        attempt += 1;
                        sleep(std::time::Duration::from_millis(delay)).await;
                        continue;
                    }

                    let _ = err;
                    return Err(ReadJsonError::TransientJson);
                }

                return Err(ReadJsonError::Json(err));
            }
        }
    };

    if let Some(modified) = modified {
        STORAGE_CACHE.record_file(
            path.to_path_buf(),
            FileCacheEntry {
                modified,
                value: value.clone(),
            },
        );
    }

    Ok((value, ReadJsonOutcome::default()))
}
