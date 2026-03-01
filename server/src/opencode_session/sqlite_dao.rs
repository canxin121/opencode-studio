use serde_json::{Value, json};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;
use tokio::fs;
use tokio::sync::RwLock;

use super::{ResponseConsistency, SessionRecord, opencode_db_path};

const SQLITE_BUSY_TIMEOUT_MS: u64 = 15000;
const SQLITE_POOL_MAX_CONNECTIONS: u32 = 6;
const SQLITE_POOL_ACQUIRE_TIMEOUT_MS: u64 = 1500;
const SQLITE_POOL_IDLE_TIMEOUT_SECS: u64 = 120;
const SQLITE_QUERY_TIMEOUT_MS: u64 = 20000;
const SQLITE_RECORD_QUERY_CHUNK: usize = 300;
const SQLITE_PART_QUERY_CHUNK: usize = 450;

static SQLITE_READ_POOLS: LazyLock<RwLock<HashMap<PathBuf, SqlitePool>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

fn sqlite_read_connect_options(db_path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(db_path)
        .read_only(true)
        .create_if_missing(false)
        .busy_timeout(Duration::from_millis(SQLITE_BUSY_TIMEOUT_MS))
        .pragma("query_only", "ON")
        .pragma("read_uncommitted", "OFF")
        .pragma("temp_store", "MEMORY")
        .pragma("cache_size", "-16000")
        .pragma("mmap_size", "268435456")
}

async fn sqlite_read_pool(db_path: &Path) -> Option<SqlitePool> {
    {
        let pools = SQLITE_READ_POOLS.read().await;
        if let Some(pool) = pools.get(db_path) {
            return Some(pool.clone());
        }
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(SQLITE_POOL_MAX_CONNECTIONS)
        .acquire_timeout(Duration::from_millis(SQLITE_POOL_ACQUIRE_TIMEOUT_MS))
        .idle_timeout(Some(Duration::from_secs(SQLITE_POOL_IDLE_TIMEOUT_SECS)))
        .connect_with(sqlite_read_connect_options(db_path))
        .await
        .ok()?;

    let mut pools = SQLITE_READ_POOLS.write().await;
    if let Some(existing) = pools.get(db_path) {
        return Some(existing.clone());
    }

    pools.insert(db_path.to_path_buf(), pool.clone());
    Some(pool)
}

async fn run_sqlite_query<T, Fut>(op_name: &'static str, fut: Fut) -> Option<T>
where
    Fut: Future<Output = Result<T, sqlx::Error>>,
{
    match tokio::time::timeout(Duration::from_millis(SQLITE_QUERY_TIMEOUT_MS), fut).await {
        Ok(Ok(value)) => Some(value),
        Ok(Err(err)) => {
            tracing::warn!(op = op_name, error = %err, "sqlite query failed");
            None
        }
        Err(_) => {
            tracing::warn!(
                op = op_name,
                timeout_ms = SQLITE_QUERY_TIMEOUT_MS,
                "sqlite query timed out"
            );
            None
        }
    }
}

#[derive(Debug)]
pub(super) struct SqliteMessagePage {
    pub(super) entries: Vec<Value>,
    pub(super) total: usize,
    pub(super) consistency: ResponseConsistency,
}

fn parse_json_text(raw: &str) -> Option<Value> {
    serde_json::from_str::<Value>(raw).ok()
}

fn session_record_from_sqlite_row(row: &SqliteRow) -> Option<SessionRecord> {
    let id: String = row.try_get("id").ok()?;
    let parent_id: Option<String> = row.try_get("parent_id").ok().flatten();
    let directory: String = row.try_get("directory").ok()?;
    let title: String = row.try_get("title").ok()?;
    let slug: String = row.try_get("slug").ok()?;
    let share_url: Option<String> = row.try_get("share_url").ok().flatten();
    let revert_raw: Option<String> = row.try_get("revert").ok().flatten();
    let time_created: i64 = row.try_get("time_created").ok()?;
    let time_updated: i64 = row.try_get("time_updated").ok()?;

    let mut value = json!({
        "id": id,
        "title": title,
        "slug": slug,
        "directory": directory,
        "time": {
            "created": time_created as f64,
            "updated": time_updated as f64,
        },
    });

    if let Some(parent_id) = parent_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        value["parentID"] = Value::String(parent_id.to_string());
    }
    if let Some(url) = share_url
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        value["share"] = json!({"url": url});
    }
    if let Some(revert_raw) = revert_raw
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        && let Some(revert) = parse_json_text(revert_raw)
    {
        value["revert"] = revert;
    }

    Some(SessionRecord {
        id: value
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        parent_id: value
            .get("parentID")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string()),
        updated: time_updated as f64,
        value,
    })
}

pub(super) async fn load_session_records_from_sqlite(
    project_id: Option<&str>,
) -> Option<Vec<SessionRecord>> {
    let db_path = opencode_db_path();
    if fs::metadata(&db_path).await.is_err() {
        return None;
    }

    let project_id = project_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string());
    let pool = sqlite_read_pool(&db_path).await?;

    let rows = match project_id.as_deref() {
        Some(project_id) => {
            run_sqlite_query(
                "load_session_records_from_sqlite",
                sqlx::query(
                    "SELECT id, parent_id, directory, title, slug, share_url, revert, time_created, time_updated FROM session WHERE project_id = ?",
                )
                .bind(project_id)
                .fetch_all(&pool),
            )
            .await?
        }
        None => {
            run_sqlite_query(
                "load_session_records_from_sqlite",
                sqlx::query(
                    "SELECT id, parent_id, directory, title, slug, share_url, revert, time_created, time_updated FROM session",
                )
                .fetch_all(&pool),
            )
            .await?
        }
    };

    Some(
        rows.iter()
            .filter_map(session_record_from_sqlite_row)
            .collect::<Vec<_>>(),
    )
}

pub(super) async fn load_session_records_by_ids_from_sqlite(
    ids: &[String],
) -> Option<Vec<SessionRecord>> {
    if ids.is_empty() {
        return Some(Vec::new());
    }

    let db_path = opencode_db_path();
    if fs::metadata(&db_path).await.is_err() {
        return None;
    }

    let mut normalized = ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .map(|id| id.to_string())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();

    if normalized.is_empty() {
        return Some(Vec::new());
    }

    let pool = sqlite_read_pool(&db_path).await?;
    let mut out = Vec::<SessionRecord>::new();

    for chunk in normalized.chunks(SQLITE_RECORD_QUERY_CHUNK) {
        let mut builder = QueryBuilder::<Sqlite>::new(
            "SELECT id, parent_id, directory, title, slug, share_url, revert, time_created, time_updated FROM session WHERE id IN (",
        );
        {
            let mut separated = builder.separated(",");
            for id in chunk {
                separated.push_bind(id);
            }
        }
        builder.push(")");

        let rows = run_sqlite_query(
            "load_session_records_by_ids_from_sqlite",
            builder.build().fetch_all(&pool),
        )
        .await?;

        out.extend(rows.iter().filter_map(session_record_from_sqlite_row));
    }

    Some(out)
}

pub(super) async fn load_session_records_by_parent_ids_from_sqlite(
    parent_ids: &[String],
) -> Option<Vec<SessionRecord>> {
    if parent_ids.is_empty() {
        return Some(Vec::new());
    }

    let db_path = opencode_db_path();
    if fs::metadata(&db_path).await.is_err() {
        return None;
    }

    let mut normalized = parent_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .map(|id| id.to_string())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();

    if normalized.is_empty() {
        return Some(Vec::new());
    }

    let pool = sqlite_read_pool(&db_path).await?;
    let mut out = Vec::<SessionRecord>::new();

    for chunk in normalized.chunks(SQLITE_RECORD_QUERY_CHUNK) {
        let mut builder = QueryBuilder::<Sqlite>::new(
            "SELECT id, parent_id, directory, title, slug, share_url, revert, time_created, time_updated FROM session WHERE parent_id IN (",
        );
        {
            let mut separated = builder.separated(",");
            for parent_id in chunk {
                separated.push_bind(parent_id);
            }
        }
        builder.push(")");

        let rows = run_sqlite_query(
            "load_session_records_by_parent_ids_from_sqlite",
            builder.build().fetch_all(&pool),
        )
        .await?;

        out.extend(rows.iter().filter_map(session_record_from_sqlite_row));
    }

    Some(out)
}

pub(super) async fn load_session_message_page_from_sqlite(
    session_id: &str,
    offset: usize,
    limit: Option<usize>,
    include_total: bool,
) -> Option<SqliteMessagePage> {
    let db_path = opencode_db_path();
    if fs::metadata(&db_path).await.is_err() {
        return None;
    }

    let session_id = session_id.trim().to_string();
    let pool = sqlite_read_pool(&db_path).await?;

    let mut consistency = ResponseConsistency::default();
    let mut total = 0usize;
    if include_total {
        match run_sqlite_query(
            "load_session_message_page_from_sqlite.total",
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM message WHERE session_id = ?")
                .bind(session_id.as_str())
                .fetch_one(&pool),
        )
        .await
        {
            Some(count) => {
                total = if count.is_negative() {
                    0
                } else {
                    count as usize
                };
            }
            None => {
                consistency.note_io_skip();
            }
        }
    }

    let mut message_rows: Vec<(String, String, Value)> = Vec::new();

    if limit != Some(0) {
        let rows = if let Some(limit) = limit {
            run_sqlite_query(
                "load_session_message_page_from_sqlite.messages",
                sqlx::query(
                    "SELECT id, session_id, data FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT ? OFFSET ?",
                )
                .bind(session_id.as_str())
                .bind(limit as i64)
                .bind(offset as i64)
                .fetch_all(&pool),
            )
            .await?
        } else {
            run_sqlite_query(
                "load_session_message_page_from_sqlite.messages",
                sqlx::query(
                    "SELECT id, session_id, data FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT -1 OFFSET ?",
                )
                .bind(session_id.as_str())
                .bind(offset as i64)
                .fetch_all(&pool),
            )
            .await?
        };

        for row in rows {
            let id = match row.try_get::<String, _>("id") {
                Ok(v) if !v.trim().is_empty() => v,
                _ => {
                    consistency.note_parse_skip();
                    continue;
                }
            };
            let row_session_id = match row.try_get::<String, _>("session_id") {
                Ok(v) if !v.trim().is_empty() => v,
                _ => {
                    consistency.note_parse_skip();
                    continue;
                }
            };
            let data_raw = match row.try_get::<String, _>("data") {
                Ok(v) => v,
                Err(_) => {
                    consistency.note_parse_skip();
                    continue;
                }
            };

            let mut info = match serde_json::from_str::<Value>(&data_raw) {
                Ok(value) => value,
                Err(_) => {
                    consistency.note_parse_skip();
                    continue;
                }
            };
            let Some(obj) = info.as_object_mut() else {
                consistency.note_parse_skip();
                continue;
            };
            obj.insert("id".to_string(), Value::String(id.clone()));
            obj.insert(
                "sessionId".to_string(),
                Value::String(row_session_id.clone()),
            );
            obj.insert(
                "sessionID".to_string(),
                Value::String(row_session_id.clone()),
            );

            message_rows.push((id, row_session_id, info));
        }
    }

    let mut parts_by_message_id = HashMap::<String, Vec<Value>>::new();
    if !message_rows.is_empty() {
        let message_ids = message_rows
            .iter()
            .map(|(id, _, _)| id.as_str())
            .collect::<Vec<_>>();

        for chunk in message_ids.chunks(SQLITE_PART_QUERY_CHUNK) {
            if chunk.is_empty() {
                continue;
            }

            let mut builder = QueryBuilder::<Sqlite>::new(
                "SELECT id, message_id, data FROM part WHERE message_id IN (",
            );
            {
                let mut separated = builder.separated(",");
                for message_id in chunk {
                    separated.push_bind(*message_id);
                }
            }
            builder.push(") ORDER BY message_id ASC, id ASC");

            let rows = run_sqlite_query(
                "load_session_message_page_from_sqlite.parts",
                builder.build().fetch_all(&pool),
            )
            .await?;

            for row in rows {
                let id = match row.try_get::<String, _>("id") {
                    Ok(v) if !v.trim().is_empty() => v,
                    _ => {
                        consistency.note_parse_skip();
                        continue;
                    }
                };
                let message_id = match row.try_get::<String, _>("message_id") {
                    Ok(v) if !v.trim().is_empty() => v,
                    _ => {
                        consistency.note_parse_skip();
                        continue;
                    }
                };
                let data_raw = match row.try_get::<String, _>("data") {
                    Ok(v) => v,
                    Err(_) => {
                        consistency.note_parse_skip();
                        continue;
                    }
                };

                let mut part = match serde_json::from_str::<Value>(&data_raw) {
                    Ok(value) => value,
                    Err(_) => {
                        consistency.note_parse_skip();
                        continue;
                    }
                };
                let Some(obj) = part.as_object_mut() else {
                    consistency.note_parse_skip();
                    continue;
                };
                obj.insert("id".to_string(), Value::String(id));
                obj.insert("sessionId".to_string(), Value::String(session_id.clone()));
                obj.insert("sessionID".to_string(), Value::String(session_id.clone()));
                obj.insert("messageId".to_string(), Value::String(message_id.clone()));
                obj.insert("messageID".to_string(), Value::String(message_id.clone()));

                parts_by_message_id
                    .entry(message_id)
                    .or_default()
                    .push(part);
            }
        }
    }

    let mut entries = Vec::with_capacity(message_rows.len());
    for (message_id, _sid, info) in message_rows {
        let parts = parts_by_message_id.remove(&message_id).unwrap_or_default();
        entries.push(json!({
            "info": info,
            "parts": parts,
        }));
    }

    entries.reverse();

    Some(SqliteMessagePage {
        entries,
        total,
        consistency,
    })
}

pub(super) async fn load_session_message_part_from_sqlite(
    session_id: &str,
    message_id: &str,
    part_id: &str,
) -> Option<(Value, Value)> {
    let db_path = opencode_db_path();
    if fs::metadata(&db_path).await.is_err() {
        return None;
    }

    let session_id = session_id.trim().to_string();
    let message_id = message_id.trim().to_string();
    let part_id = part_id.trim().to_string();
    let pool = sqlite_read_pool(&db_path).await?;

    let info_raw = run_sqlite_query(
        "load_session_message_part_from_sqlite.info",
        sqlx::query_scalar::<_, String>("SELECT data FROM message WHERE id = ? AND session_id = ?")
            .bind(message_id.as_str())
            .bind(session_id.as_str())
            .fetch_optional(&pool),
    )
    .await??;

    let mut info = serde_json::from_str::<Value>(&info_raw).ok()?;
    let info_obj = info.as_object_mut()?;
    info_obj.insert("id".to_string(), Value::String(message_id.clone()));
    info_obj.insert("sessionId".to_string(), Value::String(session_id.clone()));
    info_obj.insert("sessionID".to_string(), Value::String(session_id.clone()));

    let part_raw = run_sqlite_query(
        "load_session_message_part_from_sqlite.part",
        sqlx::query_scalar::<_, String>(
            "SELECT p.data FROM part p JOIN message m ON p.message_id = m.id WHERE p.id = ? AND p.message_id = ? AND m.session_id = ?",
        )
        .bind(part_id.as_str())
        .bind(message_id.as_str())
        .bind(session_id.as_str())
        .fetch_optional(&pool),
    )
    .await??;

    let mut part = serde_json::from_str::<Value>(&part_raw).ok()?;
    let part_obj = part.as_object_mut()?;
    part_obj.insert("id".to_string(), Value::String(part_id));
    part_obj.insert("sessionId".to_string(), Value::String(session_id.clone()));
    part_obj.insert("sessionID".to_string(), Value::String(session_id));
    part_obj.insert("messageId".to_string(), Value::String(message_id.clone()));
    part_obj.insert("messageID".to_string(), Value::String(message_id));

    Some((info, part))
}
