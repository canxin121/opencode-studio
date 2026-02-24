use serde_json::{Value, json};
use tokio::fs;

use super::{ResponseConsistency, SessionRecord, opencode_db_path};

const SQLITE_BUSY_TIMEOUT_MS: u64 = 5000;

#[derive(Debug)]
pub(super) struct SqliteMessagePage {
    pub(super) entries: Vec<Value>,
    pub(super) total: usize,
    pub(super) consistency: ResponseConsistency,
}

fn parse_json_text(raw: &str) -> Option<Value> {
    serde_json::from_str::<Value>(raw).ok()
}

fn session_record_from_sqlite_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRecord> {
    let id: String = row.get(0)?;
    let parent_id: Option<String> = row.get(1)?;
    let directory: String = row.get(2)?;
    let title: String = row.get(3)?;
    let slug: String = row.get(4)?;
    let share_url: Option<String> = row.get(5)?;
    let revert_raw: Option<String> = row.get(6)?;
    let time_created: i64 = row.get(7)?;
    let time_updated: i64 = row.get(8)?;

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

    Ok(SessionRecord {
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

    tokio::task::spawn_blocking(move || {
        let conn = match rusqlite::Connection::open_with_flags(
            db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
                | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        ) {
            Ok(conn) => conn,
            Err(_) => return None,
        };
        let _ = conn.pragma_update(None, "query_only", "ON");
        let _ = conn.busy_timeout(std::time::Duration::from_millis(SQLITE_BUSY_TIMEOUT_MS));

        let sql = if project_id.is_some() {
            "SELECT id, parent_id, directory, title, slug, share_url, revert, time_created, time_updated FROM session WHERE project_id = ?1"
        } else {
            "SELECT id, parent_id, directory, title, slug, share_url, revert, time_created, time_updated FROM session"
        };

        let mut stmt = match conn.prepare(sql) {
            Ok(stmt) => stmt,
            Err(_) => return None,
        };

        let mapped = match project_id.as_deref() {
            Some(project_id) => {
                match stmt.query_map(rusqlite::params![project_id], session_record_from_sqlite_row)
                {
                    Ok(mapped) => mapped,
                    Err(_) => return None,
                }
            }
            None => match stmt.query_map([], session_record_from_sqlite_row) {
                Ok(mapped) => mapped,
                Err(_) => return None,
            },
        };

        Some(mapped.filter_map(Result::ok).collect::<Vec<_>>())
    })
    .await
    .ok()
    .flatten()
}

fn sqlite_placeholders(count: usize) -> String {
    if count == 0 {
        return String::new();
    }
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(",")
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
    tokio::task::spawn_blocking(move || {
        let conn = match rusqlite::Connection::open_with_flags(
            db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
                | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        ) {
            Ok(conn) => conn,
            Err(_) => return None,
        };
        let _ = conn.pragma_update(None, "query_only", "ON");
        let _ = conn.busy_timeout(std::time::Duration::from_millis(SQLITE_BUSY_TIMEOUT_MS));

        let mut consistency = ResponseConsistency::default();
        let mut total = 0usize;
        if include_total {
            match conn.query_row(
                "SELECT COUNT(*) FROM message WHERE session_id = ?1",
                rusqlite::params![session_id.as_str()],
                |row| row.get::<_, i64>(0),
            ) {
                Ok(count) => {
                    total = if count.is_negative() { 0 } else { count as usize };
                }
                Err(_) => {
                    consistency.note_io_skip();
                }
            }
        }

        let mut message_rows: Vec<(String, String, Value)> = Vec::new();

        if limit != Some(0) {
            let (sql, use_limit) = if limit.is_some() {
                (
                    "SELECT id, session_id, data FROM message WHERE session_id = ?1 ORDER BY time_created DESC, id DESC LIMIT ?2 OFFSET ?3",
                    true,
                )
            } else {
                (
                    "SELECT id, session_id, data FROM message WHERE session_id = ?1 ORDER BY time_created DESC, id DESC LIMIT -1 OFFSET ?2",
                    false,
                )
            };

            let mut stmt = match conn.prepare(sql) {
                Ok(stmt) => stmt,
                Err(_) => {
                    return None;
                }
            };

            let mut rows = match if use_limit {
                stmt.query(rusqlite::params![
                    session_id.as_str(),
                    limit.unwrap_or_default() as i64,
                    offset as i64
                ])
            } else {
                stmt.query(rusqlite::params![session_id.as_str(), offset as i64])
            } {
                Ok(rows) => rows,
                Err(_) => {
                    return None;
                }
            };

            loop {
                match rows.next() {
                    Ok(Some(row)) => {
                        let id = match row.get::<_, String>(0) {
                            Ok(v) if !v.trim().is_empty() => v,
                            _ => {
                                consistency.note_parse_skip();
                                continue;
                            }
                        };
                        let row_session_id = match row.get::<_, String>(1) {
                            Ok(v) if !v.trim().is_empty() => v,
                            _ => {
                                consistency.note_parse_skip();
                                continue;
                            }
                        };
                        let data_raw = match row.get::<_, String>(2) {
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
                            "sessionID".to_string(),
                            Value::String(row_session_id.clone()),
                        );

                        message_rows.push((id, row_session_id, info));
                    }
                    Ok(None) => break,
                    Err(_) => {
                        return None;
                    }
                }
            }
        }

        let mut parts_by_message_id = std::collections::HashMap::<String, Vec<Value>>::new();
        if !message_rows.is_empty() {
            // SQLite can enforce a relatively small cap on the number of bound variables.
            // Large sessions (or large requested history windows) can exceed that cap when
            // we try to fetch parts for N message IDs in a single `IN (...)` query.
            //
            // Chunk the message IDs and issue multiple queries to keep this robust.
            // Keep the chunk size comfortably below the common 999-variable limit.
            const PART_QUERY_CHUNK: usize = 450;

            let message_ids = message_rows
                .iter()
                .map(|(id, _, _)| id.as_str())
                .collect::<Vec<_>>();

            for chunk in message_ids.chunks(PART_QUERY_CHUNK) {
                if chunk.is_empty() {
                    continue;
                }

                // Be conservative about schema assumptions: some historical databases
                // may not have `part.session_id` populated (or even present). We only
                // need `message_id` to associate parts with the selected messages.
                let sql = format!(
                    "SELECT id, message_id, data FROM part WHERE message_id IN ({}) ORDER BY message_id ASC, id ASC",
                    sqlite_placeholders(chunk.len())
                );

                let mut stmt = match conn.prepare(&sql) {
                    Ok(stmt) => stmt,
                    Err(_) => return None,
                };

                let mut rows = match stmt.query(rusqlite::params_from_iter(chunk.iter())) {
                    Ok(rows) => rows,
                    Err(_) => return None,
                };

                loop {
                    match rows.next() {
                        Ok(Some(row)) => {
                            let id = match row.get::<_, String>(0) {
                                Ok(v) if !v.trim().is_empty() => v,
                                _ => {
                                    consistency.note_parse_skip();
                                    continue;
                                }
                            };
                            let message_id = match row.get::<_, String>(1) {
                                Ok(v) if !v.trim().is_empty() => v,
                                _ => {
                                    consistency.note_parse_skip();
                                    continue;
                                }
                            };
                            let data_raw = match row.get::<_, String>(2) {
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
                            obj.insert("id".to_string(), Value::String(id.clone()));
                            obj.insert("sessionID".to_string(), Value::String(session_id.clone()));
                            obj.insert("messageID".to_string(), Value::String(message_id.clone()));

                            parts_by_message_id.entry(message_id).or_default().push(part);
                        }
                        Ok(None) => break,
                        Err(_) => return None,
                    }
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

        // Keep existing transport contract: each page is oldest -> newest,
        // with offset applied against newest-first ordering.
        entries.reverse();

        Some(SqliteMessagePage {
            entries,
            total,
            consistency,
        })
    })
    .await
    .ok()
    .flatten()
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

    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open_with_flags(
            db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
                | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )
        .ok()?;
        let _ = conn.pragma_update(None, "query_only", "ON");
        let _ = conn.busy_timeout(std::time::Duration::from_millis(SQLITE_BUSY_TIMEOUT_MS));

        let info_raw = conn
            .query_row(
                "SELECT data FROM message WHERE id = ?1 AND session_id = ?2",
                rusqlite::params![message_id.as_str(), session_id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .ok()?;
        let mut info = serde_json::from_str::<Value>(&info_raw).ok()?;
        let info_obj = info.as_object_mut()?;
        info_obj.insert("id".to_string(), Value::String(message_id.clone()));
        info_obj.insert("sessionID".to_string(), Value::String(session_id.clone()));

        // Avoid relying on `part.session_id` for compatibility with historical schemas.
        // Validate session ownership via the `message` table instead.
        let part_raw = conn
            .query_row(
                "SELECT p.data FROM part p JOIN message m ON p.message_id = m.id WHERE p.id = ?1 AND p.message_id = ?2 AND m.session_id = ?3",
                rusqlite::params![part_id.as_str(), message_id.as_str(), session_id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .ok()?;
        let mut part = serde_json::from_str::<Value>(&part_raw).ok()?;
        let part_obj = part.as_object_mut()?;
        part_obj.insert("id".to_string(), Value::String(part_id));
        part_obj.insert("sessionID".to_string(), Value::String(session_id));
        part_obj.insert("messageID".to_string(), Value::String(message_id));

        Some((info, part))
    })
    .await
    .ok()
    .flatten()
}
