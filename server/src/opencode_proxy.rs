use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use axum::{
    Json,
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use base64::Engine as _;
use bytes::{BufMut as _, Bytes, BytesMut};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::config::{
    default_chat_activity_filters, default_chat_activity_tool_filters,
    normalize_chat_activity_filters, normalize_chat_activity_tool_filters,
};
use crate::{ApiResult, AppError};

const OPENCODE_STUDIO_SSE_HEARTBEAT: Duration = Duration::from_secs(15);

static KNOWN_TOOL_ACTIVITY_FILTER_IDS: LazyLock<HashSet<String>> =
    LazyLock::new(|| default_chat_activity_tool_filters().into_iter().collect());

fn opencode_studio_sse_heartbeat_bytes() -> Bytes {
    // Emit a plain "data: <json>\n\n" event.
    let payload = serde_json::json!({
        "type": "opencode-studio:heartbeat",
        "timestamp": time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000,
    });
    Bytes::from(format!("data: {}\n\n", payload))
}

fn opencode_studio_session_activity_bytes(session_id: &str, phase: &str) -> Bytes {
    // Inject this event alongside upstream OpenCode events.
    let payload = serde_json::json!({
        "type": "opencode-studio:session-activity",
        "properties": {
            // Match OpenCode's ID casing (sessionID/messageID/etc).
            "sessionID": session_id,
            "phase": phase,
        }
    });
    Bytes::from(format!("data: {}\n\n", payload))
}

fn rewrite_opencode_prompt_async_url(target_url: &str) -> Option<String> {
    let mut parsed = url::Url::parse(target_url).ok()?;
    if !parsed.path().ends_with("/message") {
        return None;
    }
    let new_path = format!(
        "{}/prompt_async",
        parsed.path().trim_end_matches("/message")
    );
    parsed.set_path(&new_path);
    Some(parsed.to_string())
}

fn should_sanitize_chat_session_response(path: &str) -> bool {
    let normalized = path.trim().trim_matches('/');
    if normalized.is_empty() {
        return false;
    }
    if normalized == "session" {
        return true;
    }
    if !normalized.starts_with("session/") {
        return false;
    }
    if normalized == "session/status" {
        return false;
    }

    let tail = normalized.rsplit('/').next().unwrap_or_default();
    if tail.eq_ignore_ascii_case("message") || tail.eq_ignore_ascii_case("diff") {
        return false;
    }

    true
}

fn extract_session_id_from_delete_path(path: &str) -> Option<String> {
    let normalized = path.trim().trim_matches('/');
    if normalized.is_empty() {
        return None;
    }

    let mut parts = normalized.split('/');
    let resource = parts.next()?;
    let raw_id = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    if resource != "session" {
        return None;
    }

    // Guard known non-session resources under /session/*.
    if raw_id.eq_ignore_ascii_case("status") {
        return None;
    }

    let decoded = urlencoding::decode(raw_id)
        .map(|v| v.into_owned())
        .unwrap_or_else(|_| raw_id.to_string());
    let session_id = decoded.trim();
    if session_id.is_empty() {
        return None;
    }
    Some(session_id.to_string())
}

fn prune_session_list_value(list: &mut Vec<serde_json::Value>) {
    let mut out = Vec::new();
    for mut item in std::mem::take(list) {
        if prune_session_summary_value(&mut item) {
            out.push(item);
        }
    }
    *list = out;
}

fn sanitize_chat_session_response_payload(payload: &mut serde_json::Value) {
    if let Some(arr) = payload.as_array_mut() {
        prune_session_list_value(arr);
        return;
    }

    let Some(obj) = payload.as_object_mut() else {
        return;
    };

    // Some OpenCode endpoints return a session summary object directly.
    // Probe with a clone so failed pruning does not wipe wrapper payloads.
    if !obj.contains_key("session")
        && !obj.contains_key("value")
        && !obj.contains_key("data")
        && !obj.contains_key("sessions")
    {
        let mut candidate = serde_json::Value::Object(obj.clone());
        if prune_session_summary_value(&mut candidate) {
            *payload = candidate;
        }
        return;
    }

    if let Some(session) = obj.get_mut("session")
        && !prune_session_summary_value(session)
    {
        obj.remove("session");
    }

    if let Some(value) = obj.get_mut("value")
        && !prune_session_summary_value(value)
    {
        obj.remove("value");
    }

    if let Some(data) = obj.get_mut("data")
        && !prune_session_summary_value(data)
    {
        obj.remove("data");
    }

    if let Some(sessions) = obj.get_mut("sessions").and_then(|v| v.as_array_mut()) {
        prune_session_list_value(sessions);
    }
}

fn open_code_unavailable() -> Response {
    AppError::service_unavailable("OpenCode service unavailable").into_response()
}

fn open_code_restarting() -> Response {
    AppError::service_restarting("OpenCode is restarting").into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttentionListQuery {
    pub session_id: Option<String>,
    pub offset: Option<String>,
    pub limit: Option<String>,
}

fn parse_usize_param(raw: Option<String>) -> Option<usize> {
    let raw = raw?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed.parse::<usize>().ok()
}

fn query_param(uri: &Uri, key: &str) -> Option<String> {
    uri.query().and_then(|q| {
        for (k, v) in url::form_urlencoded::parse(q.as_bytes()) {
            if k == key {
                let value = v.into_owned();
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
        None
    })
}

fn query_has_message_id(uri: &Uri) -> bool {
    query_param(uri, "messageID").is_some() || query_param(uri, "messageId").is_some()
}

fn extract_session_id_from_diff_path(path: &str) -> Option<String> {
    let normalized = path.trim().trim_matches('/');
    let mut parts = normalized.split('/');
    let resource = parts.next()?;
    let raw_id = parts.next()?;
    let tail = parts.next()?;
    if parts.next().is_some() || resource != "session" || !tail.eq_ignore_ascii_case("diff") {
        return None;
    }

    let decoded = urlencoding::decode(raw_id)
        .map(|v| v.into_owned())
        .unwrap_or_else(|_| raw_id.to_string());
    let session_id = decoded.trim();
    if session_id.is_empty() {
        return None;
    }
    Some(session_id.to_string())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDiffItem {
    file: String,
    before: String,
    after: String,
    additions: usize,
    deletions: usize,
    #[serde(skip_serializing_if = "String::is_empty")]
    diff: String,
}

fn normalize_diff_path(raw_path: &str, directory: Option<&str>) -> Option<String> {
    let mut out = raw_path.trim().to_string();
    if out.is_empty() || out == "/dev/null" {
        return None;
    }

    if out.starts_with('"') && out.ends_with('"') && out.len() > 1 {
        out = out[1..out.len() - 1].to_string();
    }

    if let Some(tab_idx) = out.find('\t')
        && tab_idx > 0
    {
        out = out[..tab_idx].to_string();
    }

    out = out.replace('\\', "/");
    if out.starts_with("a/") || out.starts_with("b/") {
        out = out[2..].to_string();
    }

    if let Some(dir) = directory {
        let dir = dir
            .trim()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string();
        if !dir.is_empty() {
            let prefix = format!("{dir}/");
            if out.starts_with(&prefix) {
                out = out[prefix.len()..].to_string();
            }
        }
    }

    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn first_trimmed(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        if let Some(value) = map.get(*key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn first_string(map: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = map.get(*key).and_then(|v| v.as_str()) {
            return value.to_string();
        }
    }
    String::new()
}

fn first_count(map: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> usize {
    for key in keys {
        if let Some(n) = map.get(*key).and_then(|v| v.as_f64())
            && n.is_finite()
            && n >= 0.0
        {
            return n.floor() as usize;
        }
    }
    0
}

fn parse_metadata_file_entry(
    row: &serde_json::Value,
    directory: Option<&str>,
) -> Option<SessionDiffItem> {
    let map = row.as_object()?;
    let file = normalize_diff_path(
        &first_trimmed(
            map,
            &[
                "file",
                "path",
                "filename",
                "name",
                "target",
                "filePath",
                "filepath",
                "relativePath",
            ],
        )?,
        directory,
    )?;

    Some(SessionDiffItem {
        file,
        before: first_string(
            map,
            &[
                "before", "old", "oldText", "original", "previous", "prev", "from", "left", "a",
            ],
        ),
        after: first_string(
            map,
            &[
                "after", "new", "newText", "modified", "current", "next", "to", "right", "b",
            ],
        ),
        additions: first_count(
            map,
            &["additions", "added", "insertions", "linesAdded", "add"],
        ),
        deletions: first_count(map, &["deletions", "removed", "linesDeleted", "del"]),
        diff: first_string(map, &["diff", "patch"]),
    })
}

#[derive(Clone, Debug)]
struct ParsedDiffEntry {
    additions: usize,
    deletions: usize,
    diff: String,
}

fn parse_unified_diff_entries(
    diff_text: &str,
    directory: Option<&str>,
) -> BTreeMap<String, ParsedDiffEntry> {
    let mut by_file = BTreeMap::<String, ParsedDiffEntry>::new();
    let text = diff_text.trim();
    if text.is_empty() {
        return by_file;
    }

    let mut current = String::new();
    let mut current_lines = Vec::<String>::new();
    let mut additions = 0usize;
    let mut deletions = 0usize;

    let flush_current = |file: &str,
                         lines: &mut Vec<String>,
                         additions: &mut usize,
                         deletions: &mut usize,
                         out: &mut BTreeMap<String, ParsedDiffEntry>| {
        if file.is_empty() {
            lines.clear();
            *additions = 0;
            *deletions = 0;
            return;
        }
        let diff = if lines.is_empty() {
            String::new()
        } else {
            let mut joined = lines.join("\n");
            joined.push('\n');
            joined
        };
        out.insert(
            file.to_string(),
            ParsedDiffEntry {
                additions: *additions,
                deletions: *deletions,
                diff,
            },
        );
        lines.clear();
        *additions = 0;
        *deletions = 0;
    };

    let set_current_file = |next: Option<String>,
                            current: &mut String,
                            current_lines: &mut Vec<String>,
                            additions: &mut usize,
                            deletions: &mut usize,
                            out: &mut BTreeMap<String, ParsedDiffEntry>| {
        flush_current(
            current,
            current_lines,
            additions,
            deletions,
            out,
        );
        *current = next.unwrap_or_default();
    };

    for line in text.replace("\r\n", "\n").replace('\r', "\n").lines() {
        if line.starts_with("diff --git ") {
            if let Some(rest) = line.strip_prefix("diff --git ") {
                let mut parts = rest.split_whitespace();
                let left = parts.next().unwrap_or_default();
                let right = parts.next().unwrap_or_default();
                set_current_file(
                    normalize_diff_path(if !right.is_empty() { right } else { left }, directory),
                    &mut current,
                    &mut current_lines,
                    &mut additions,
                    &mut deletions,
                    &mut by_file,
                );
                if !current.is_empty() {
                    current_lines.push(line.to_string());
                }
            }
            continue;
        }

        if let Some(path) = line.strip_prefix("Index: ") {
            set_current_file(
                normalize_diff_path(path, directory),
                &mut current,
                &mut current_lines,
                &mut additions,
                &mut deletions,
                &mut by_file,
            );
            if !current.is_empty() {
                current_lines.push(line.to_string());
            }
            continue;
        }

        if let Some(path) = line.strip_prefix("+++ ") {
            if current.is_empty()
                && let Some(file) = normalize_diff_path(path, directory)
            {
                set_current_file(
                    Some(file),
                    &mut current,
                    &mut current_lines,
                    &mut additions,
                    &mut deletions,
                    &mut by_file,
                );
            }
            if !current.is_empty() {
                current_lines.push(line.to_string());
            }
            continue;
        }

        if current.is_empty()
            && let Some(path) = line.strip_prefix("--- ")
            && let Some(file) = normalize_diff_path(path, directory)
        {
            set_current_file(
                Some(file),
                &mut current,
                &mut current_lines,
                &mut additions,
                &mut deletions,
                &mut by_file,
            );
            current_lines.push(line.to_string());
            continue;
        }

        if current.is_empty() {
            continue;
        }
        current_lines.push(line.to_string());
        if line.starts_with('+') && !line.starts_with("+++") {
            additions += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            deletions += 1;
        }
    }

    flush_current(
        &current,
        &mut current_lines,
        &mut additions,
        &mut deletions,
        &mut by_file,
    );

    by_file
}

fn metadata_map_from_tool_part(
    part_map: &serde_json::Map<String, serde_json::Value>,
) -> Option<&serde_json::Map<String, serde_json::Value>> {
    if let Some(state_map) = part_map.get("state").and_then(|v| v.as_object())
        && let Some(meta) = state_map.get("metadata").and_then(|v| v.as_object())
    {
        return Some(meta);
    }
    part_map.get("metadata").and_then(|v| v.as_object())
}

fn build_session_diff_from_messages(
    messages: &[serde_json::Value],
    directory: Option<&str>,
) -> Vec<SessionDiffItem> {
    let mut by_file = BTreeMap::<String, SessionDiffItem>::new();

    for message in messages {
        let Some(parts) = message
            .as_object()
            .and_then(|obj| obj.get("parts"))
            .and_then(|v| v.as_array())
        else {
            continue;
        };

        for part in parts {
            let Some(part_map) = part.as_object() else {
                continue;
            };
            let part_type = part_map
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase();
            if part_type != "tool" && part_type != "patch" {
                continue;
            }

            let Some(metadata) = metadata_map_from_tool_part(part_map) else {
                continue;
            };

            if let Some(files) = metadata.get("files").and_then(|v| v.as_array()) {
                for row in files {
                    if let Some(parsed) = parse_metadata_file_entry(row, directory) {
                        by_file.insert(parsed.file.clone(), parsed);
                    }
                }
            }

            let diff_text = first_string(metadata, &["diff", "patch"]);
            if diff_text.is_empty() {
                continue;
            }
            let entries = parse_unified_diff_entries(&diff_text, directory);
            for (file, parsed) in entries {
                let prev = by_file.get(&file).cloned();
                by_file.insert(
                    file.clone(),
                    SessionDiffItem {
                        file,
                        before: prev.as_ref().map(|v| v.before.clone()).unwrap_or_default(),
                        after: prev.as_ref().map(|v| v.after.clone()).unwrap_or_default(),
                        additions: parsed.additions,
                        deletions: parsed.deletions,
                        diff: if parsed.diff.trim().is_empty() {
                            prev.as_ref().map(|v| v.diff.clone()).unwrap_or_default()
                        } else {
                            parsed.diff
                        },
                    },
                );
            }
        }
    }

    by_file.into_values().collect()
}

fn looks_like_diff_item_map(map: &serde_json::Map<String, serde_json::Value>) -> bool {
    first_trimmed(
        map,
        &[
            "file",
            "path",
            "filename",
            "name",
            "target",
            "filePath",
            "filepath",
            "relativePath",
        ],
    )
    .is_some()
        || map.get("before").and_then(|v| v.as_str()).is_some()
        || map.get("after").and_then(|v| v.as_str()).is_some()
        || map.get("diff").and_then(|v| v.as_str()).is_some()
        || map.get("patch").and_then(|v| v.as_str()).is_some()
        || map.get("additions").and_then(|v| v.as_f64()).is_some()
        || map.get("deletions").and_then(|v| v.as_f64()).is_some()
}

fn read_session_diff_items(value: &serde_json::Value, depth: usize) -> Vec<serde_json::Value> {
    if depth > 4 {
        return Vec::new();
    }
    if let Some(arr) = value.as_array() {
        return arr.clone();
    }
    let Some(map) = value.as_object() else {
        return Vec::new();
    };

    if looks_like_diff_item_map(map) {
        return vec![serde_json::Value::Object(map.clone())];
    }

    for key in [
        "files", "changes", "diff", "diffs", "entries", "items", "list", "value", "data",
        "payload", "result",
    ] {
        if let Some(nested) = map.get(key) {
            let out = read_session_diff_items(nested, depth + 1);
            if !out.is_empty() {
                return out;
            }
        }
    }

    for nested in map.values() {
        if let Some(arr) = nested.as_array()
            && arr.iter().any(|entry| {
                entry
                    .as_object()
                    .map(looks_like_diff_item_map)
                    .unwrap_or(false)
            })
        {
            return arr.clone();
        }
    }

    Vec::new()
}

fn normalize_session_diff_payload(
    payload: &serde_json::Value,
    directory: Option<&str>,
) -> Vec<SessionDiffItem> {
    read_session_diff_items(payload, 0)
        .into_iter()
        .filter_map(|entry| parse_metadata_file_entry(&entry, directory))
        .collect()
}

fn merge_session_diff_items(
    primary: Vec<SessionDiffItem>,
    secondary: Vec<SessionDiffItem>,
) -> Vec<SessionDiffItem> {
    let mut merged = BTreeMap::<String, SessionDiffItem>::new();
    for item in secondary {
        merged.insert(item.file.clone(), item);
    }
    for item in primary {
        merged.insert(item.file.clone(), item);
    }
    merged.into_values().collect()
}

async fn load_upstream_session_diff(
    state: &crate::AppState,
    uri: &Uri,
    path: &str,
) -> Option<Vec<SessionDiffItem>> {
    if state.opencode.is_restarting().await {
        return None;
    }
    let bridge = state.opencode.bridge().await?;
    let upstream_path = format!("/{path}");
    let target = bridge.build_url(&upstream_path, Some(uri)).ok()?;
    let resp = bridge.client.get(target).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let payload = resp.json::<serde_json::Value>().await.ok()?;
    Some(normalize_session_diff_payload(
        &payload,
        directory_from_uri_query(uri).as_deref(),
    ))
}

async fn session_diff_get_authoritative(
    state: Arc<crate::AppState>,
    uri: Uri,
    path: &str,
) -> ApiResult<Response> {
    let Some(session_id) = extract_session_id_from_diff_path(path) else {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid session diff path"})),
        )
            .into_response());
    };

    let offset = parse_usize_param(query_param(&uri, "offset")).unwrap_or(0);
    let limit = parse_usize_param(query_param(&uri, "limit"))
        .map(|v| v.max(1))
        .unwrap_or(100);

    let directory = directory_from_uri_query(&uri);
    let local_messages =
        crate::opencode_session::load_session_messages_unfiltered(&session_id).await;
    let computed = build_session_diff_from_messages(&local_messages, directory.as_deref());
    let upstream = load_upstream_session_diff(state.as_ref(), &uri, path)
        .await
        .unwrap_or_default();
    let items = merge_session_diff_items(upstream, computed);

    let total = items.len();
    let start = offset.min(total);
    let end = start.saturating_add(limit).min(total);
    let page_items = if start < end {
        items[start..end].to_vec()
    } else {
        Vec::new()
    };
    let has_more = end < total;
    let next_offset = if has_more { Some(end) } else { None };

    let mut payload = serde_json::Map::new();
    payload.insert(
        "items".to_string(),
        serde_json::to_value(page_items)
            .map_err(|_| AppError::bad_gateway("Failed to encode session diff items"))?,
    );
    payload.insert("total".to_string(), serde_json::Value::from(total as u64));
    payload.insert("offset".to_string(), serde_json::Value::from(start as u64));
    payload.insert("limit".to_string(), serde_json::Value::from(limit as u64));
    payload.insert("hasMore".to_string(), serde_json::Value::Bool(has_more));
    if let Some(next) = next_offset {
        payload.insert(
            "nextOffset".to_string(),
            serde_json::Value::from(next as u64),
        );
    }

    Ok(Json(serde_json::Value::Object(payload)).into_response())
}

fn normalize_session_id(raw: &Option<String>) -> Option<String> {
    raw.as_deref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn directory_from_uri_query(uri: &Uri) -> Option<String> {
    uri.query().and_then(|q| {
        for (k, v) in url::form_urlencoded::parse(q.as_bytes()) {
            if k == "directory" {
                let value = v.into_owned();
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
        None
    })
}

fn query_bool(uri: &Uri, key: &str) -> bool {
    uri.query()
        .map(|query| {
            url::form_urlencoded::parse(query.as_bytes()).any(|(k, v)| {
                if k != key {
                    return false;
                }
                let raw = v.trim().to_ascii_lowercase();
                raw.is_empty() || raw == "1" || raw == "true" || raw == "yes" || raw == "on"
            })
        })
        .unwrap_or(false)
}

fn infer_attachment_mime(
    abs: &std::path::Path,
    obj: &serde_json::Map<String, serde_json::Value>,
) -> String {
    obj.get("mime")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            match abs
                .extension()
                .and_then(std::ffi::OsStr::to_str)
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str()
            {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "svg" => "image/svg+xml",
                "pdf" => "application/pdf",
                "json" => "application/json",
                "md" => "text/markdown",
                "txt" | "log" => "text/plain",
                "ts" | "tsx" | "js" | "jsx" | "css" | "html" => "text/plain",
                _ => "application/octet-stream",
            }
            .to_string()
        })
}

fn infer_attachment_filename(
    abs: &std::path::Path,
    obj: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    obj.get("filename")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| {
            abs.file_name()
                .and_then(std::ffi::OsStr::to_str)
                .map(|v| v.to_string())
        })
}

async fn proxy_opencode_sse_event_inner(
    state: Arc<crate::AppState>,
    headers: HeaderMap,
    uri: Uri,
    path: &str,
) -> ApiResult<Response> {
    if state.opencode.is_restarting().await {
        return Ok(open_code_restarting());
    }
    let Some(bridge) = state.opencode.bridge().await else {
        return Ok(open_code_unavailable());
    };

    let target = match bridge.build_url(path, Some(&uri)) {
        Ok(url) => url,
        Err(_) => return Ok(open_code_unavailable()),
    };

    let mut req = reqwest::Request::new(reqwest::Method::GET, target.parse().expect("valid url"));
    {
        let req_headers = req.headers_mut();
        req_headers.insert(
            reqwest::header::ACCEPT,
            "text/event-stream".parse().unwrap(),
        );
        req_headers.insert(reqwest::header::CACHE_CONTROL, "no-cache".parse().unwrap());
        req_headers.insert(reqwest::header::CONNECTION, "keep-alive".parse().unwrap());

        if let Some(last_id) = headers.get("Last-Event-ID").and_then(|v| v.to_str().ok())
            && !last_id.is_empty()
        {
            req_headers.insert(
                reqwest::header::HeaderName::from_static("last-event-id"),
                last_id.parse().unwrap(),
            );
        }
    }

    let resp = bridge
        .sse_client
        .execute(req)
        .await
        .map_err(|_| AppError::bad_gateway("Failed to connect to OpenCode event stream"))?;

    if !resp.status().is_success() {
        return Err(AppError::bad_gateway(format!(
            "OpenCode event stream unavailable ({})",
            resp.status().as_u16()
        )));
    }

    let (filter, detail) = {
        let settings = state.settings.read().await;
        (
            activity_filter_from_settings(&settings),
            activity_detail_policy_from_settings(&settings),
        )
    };

    let stream = sse_passthrough_with_heartbeat_and_activity(state.clone(), resp, filter, detail);

    let mut out = Response::new(axum::body::Body::from_stream(stream));
    *out.status_mut() = StatusCode::OK;
    let out_headers = out.headers_mut();
    out_headers.insert(
        axum::http::header::CONTENT_TYPE,
        "text/event-stream".parse().unwrap(),
    );
    out_headers.insert(
        axum::http::header::CACHE_CONTROL,
        "no-cache".parse().unwrap(),
    );
    out_headers.insert(
        axum::http::header::CONNECTION,
        "keep-alive".parse().unwrap(),
    );
    out_headers.insert("X-Accel-Buffering", "no".parse().unwrap());
    Ok(out)
}

pub(crate) async fn proxy_opencode_sse_event(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> ApiResult<Response> {
    proxy_opencode_sse_event_inner(state, headers, uri, "/event").await
}

fn sse_passthrough_with_heartbeat_and_activity(
    state: Arc<crate::AppState>,
    resp: reqwest::Response,
    filter: ActivityFilter,
    detail: ActivityDetailPolicy,
) -> impl futures_util::Stream<Item = Result<Bytes, std::convert::Infallible>> {
    let mut upstream = resp.bytes_stream();
    let start = tokio::time::Instant::now() + OPENCODE_STUDIO_SSE_HEARTBEAT;
    let mut ticker = tokio::time::interval_at(start, OPENCODE_STUDIO_SSE_HEARTBEAT);

    async_stream::stream! {
        let activity = state.session_activity.clone();
        let runtime_index = state.directory_session_index.clone();
        let mut buffer = String::new();
        let mut heartbeat_deferred = false;

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if buffer.is_empty() {
                        yield Ok(opencode_studio_sse_heartbeat_bytes());
                    } else {
                        heartbeat_deferred = true;
                    }
                }
                item = upstream.next() => {
                    let Some(item) = item else {
                        break;
                    };
                    let Ok(chunk) = item else {
                        break;
                    };

                    // SSE is UTF-8 text; normalize CRLF.
                    buffer.push_str(
                        &String::from_utf8_lossy(&chunk)
                            .replace("\r\n", "\n")
                            .replace('\r', ""),
                    );

                    while let Some(idx) = buffer.find("\n\n") {
                        let block = buffer[..idx].to_string();
                        buffer = buffer[idx + 2..].to_string();

                        if !block.is_empty() {
                            let activity_payload = crate::session_activity::parse_sse_data_payload(&block);

                            let forwarded = if let Some(mut raw_data) = parse_sse_block_data_json(&block) {
                                if sanitize_sse_event_data(&mut raw_data, &filter, &detail) {
                                    rewrite_sse_block_data_json(&block, &raw_data)
                                        .unwrap_or(block.clone())
                                } else {
                                    String::new()
                                }
                            } else {
                                block.clone()
                            };

                            if !forwarded.is_empty() {
                                let mut out = BytesMut::with_capacity(forwarded.len() + 2);
                                out.put_slice(forwarded.as_bytes());
                                out.put_slice(b"\n\n");
                                yield Ok(out.freeze());
                            }

                            // Derive and inject activity signal.
                            if let Some(payload) = activity_payload
                                && let Some((session_id, phase)) =
                                    crate::session_activity::derive_session_activity(&payload)
                            {
                                activity.set_phase(&session_id, phase);
                                runtime_index.upsert_runtime_phase(&session_id, phase.as_str());
                                yield Ok(opencode_studio_session_activity_bytes(
                                    &session_id,
                                    phase.as_str(),
                                ));
                            }
                        }

                        if heartbeat_deferred && buffer.is_empty() {
                            heartbeat_deferred = false;
                            yield Ok(opencode_studio_sse_heartbeat_bytes());
                        }
                    }
                }
            }
        }

        let trailing = buffer.trim();
        if !trailing.is_empty() {
            let activity_payload = crate::session_activity::parse_sse_data_payload(trailing);

            let forwarded = if let Some(mut raw_data) = parse_sse_block_data_json(trailing) {
                if sanitize_sse_event_data(&mut raw_data, &filter, &detail) {
                    rewrite_sse_block_data_json(trailing, &raw_data)
                        .unwrap_or_else(|| trailing.to_string())
                } else {
                    String::new()
                }
            } else {
                trailing.to_string()
            };

            if !forwarded.is_empty() {
                let mut out = BytesMut::with_capacity(forwarded.len() + 2);
                out.put_slice(forwarded.as_bytes());
                out.put_slice(b"\n\n");
                yield Ok(out.freeze());
            }

            // Best-effort: upstream may close without a terminating "\n\n".
            // We already forward the trailing block, but we also want to keep the
            // session activity snapshot in sync (and inject the derived activity event).
            if let Some(payload) = activity_payload
                && let Some((session_id, phase)) =
                    crate::session_activity::derive_session_activity(&payload)
            {
                activity.set_phase(&session_id, phase);
                runtime_index.upsert_runtime_phase(&session_id, phase.as_str());
                yield Ok(opencode_studio_session_activity_bytes(
                    &session_id,
                    phase.as_str(),
                ));
            }
        }
    }
}

pub(crate) async fn proxy_opencode_rest_inner(
    state: Arc<crate::AppState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    path: String,
    body: axum::body::Body,
) -> ApiResult<Response> {
    let normalized_path = path.trim().trim_start_matches('/');
    if normalized_path == "event" {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Not found"})),
        )
            .into_response());
    }

    let is_session_diff_get = method == Method::GET
        && extract_session_id_from_diff_path(normalized_path).is_some()
        && !query_has_message_id(&uri);
    if is_session_diff_get {
        return session_diff_get_authoritative(state, uri, normalized_path).await;
    }

    let oc = state.opencode.status().await;
    if oc.restarting || !oc.ready {
        return Ok(open_code_restarting());
    }
    let Some(bridge) = state.opencode.bridge().await else {
        return Ok(open_code_unavailable());
    };

    let query_directory = directory_from_uri_query(&uri);

    let body = match axum::body::to_bytes(body, 50 * 1024 * 1024).await {
        Ok(body) => body,
        Err(_) => return Err(AppError::payload_too_large("Request body too large")),
    };

    let upstream_path = format!("/{}", path);
    let target = match bridge.build_url(&upstream_path, Some(&uri)) {
        Ok(url) => url,
        Err(_) => return Ok(open_code_unavailable()),
    };

    // UX: OpenCode's /session/:id/message call may run for the entire generation.
    // If we block this HTTP response, the frontend ends up tying "sent" to "assistant finished",
    // and the input doesn't clear until completion. Fire-and-forget fixes that and lets SSE drive UI.
    let is_session_message_post =
        method == Method::POST && path.starts_with("session/") && path.ends_with("/message");
    if is_session_message_post {
        // Allow lightweight file references from the frontend (serverPath) and expand them into
        // OpenCode-compatible data: URLs before forwarding.
        let directory = query_directory.clone();

        let body = if let Ok(mut json) = serde_json::from_slice::<serde_json::Value>(&body) {
            if let Some(parts) = json.get_mut("parts").and_then(|v| v.as_array_mut()) {
                // Optional: validate directory when provided, so serverPath can't escape the project.
                let base_dir = if let Some(dir) = directory.as_deref() {
                    Some(crate::fs::validate_directory(dir).await?)
                } else {
                    None
                };

                for part in parts.iter_mut() {
                    let Some(obj) = part.as_object_mut() else {
                        continue;
                    };
                    let ty = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    if ty != "file" {
                        continue;
                    }

                    // Already a fully-formed attachment.
                    if obj
                        .get("url")
                        .and_then(|v| v.as_str())
                        .is_some_and(|u| !u.trim().is_empty())
                    {
                        obj.remove("serverPath");
                        continue;
                    }

                    let Some(server_path) = obj
                        .get("serverPath")
                        .and_then(|v| v.as_str())
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty())
                    else {
                        continue;
                    };

                    // Resolve ~ and relative paths.
                    let resolved = crate::path_utils::normalize_directory_path(&server_path);

                    let mut abs = std::path::PathBuf::from(&resolved);
                    if !abs.is_absolute() {
                        if let Some(base) = base_dir.as_ref() {
                            abs = base.join(&abs);
                        } else {
                            abs = std::env::current_dir()
                                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                                .join(&abs);
                        }
                    }

                    // Basic path traversal guard for relative paths.
                    if abs
                        .components()
                        .any(|c| matches!(c, std::path::Component::ParentDir))
                    {
                        return Err(AppError::bad_request(
                            "Invalid attachment path: path traversal not allowed",
                        ));
                    }

                    if let Some(base) = base_dir.as_ref()
                        && !abs.starts_with(base)
                    {
                        return Err(AppError::bad_request(
                            "Attachment path is outside of active workspace",
                        ));
                    }

                    let meta = tokio::fs::metadata(&abs)
                        .await
                        .map_err(|_| AppError::bad_request("Failed to read attachment file"))?;
                    if !meta.is_file() {
                        return Err(AppError::bad_request("Attachment path is not a file"));
                    }

                    // Keep parity with frontend defaults.
                    const MAX_ATTACHMENT_BYTES: u64 = 50 * 1024 * 1024;
                    if meta.len() > MAX_ATTACHMENT_BYTES {
                        return Err(AppError::payload_too_large("Attachment file too large"));
                    }

                    let mime = infer_attachment_mime(&abs, obj);
                    let filename = infer_attachment_filename(&abs, obj);

                    let url = match state.attachment_cache.data_url_for_file(&abs, &mime).await {
                        Ok(url) => url,
                        Err(err) => {
                            tracing::warn!(
                                target: "opencode_studio.attachment_cache",
                                path = %abs.display(),
                                error = %err,
                                "attachment cache miss/failure; using direct base64 path"
                            );
                            let bytes = tokio::fs::read(&abs).await.map_err(|_| {
                                AppError::bad_request("Failed to read attachment file")
                            })?;
                            let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                            format!("data:{};base64,{}", mime, encoded)
                        }
                    };

                    obj.insert("mime".to_string(), serde_json::Value::String(mime));
                    obj.insert("url".to_string(), serde_json::Value::String(url));
                    if let Some(name) = filename {
                        obj.insert("filename".to_string(), serde_json::Value::String(name));
                    }
                    obj.remove("serverPath");
                }
            }

            serde_json::to_vec(&json)
                .map(Bytes::from)
                .map_err(|_| AppError::bad_request("Invalid request body"))?
        } else {
            body.clone()
        };

        let bridge = bridge.clone();
        let headers_in = headers.clone();
        let target_url = target.clone();
        let body_bytes = body.clone();

        // Prefer OpenCode's native async route to avoid holding a long-running HTTP
        // connection open for the entire generation (SSE drives the UI).
        //
        // We intentionally do not fall back to /message: this repo targets a modern
        // OpenCode upstream that supports /prompt_async.
        let async_target_url = match rewrite_opencode_prompt_async_url(&target_url) {
            Some(url) => url,
            None => {
                return Err(AppError::bad_gateway(
                    "OpenCode async prompt endpoint unavailable (expected /prompt_async)",
                ));
            }
        };

        let mut req = reqwest::Request::new(
            reqwest::Method::POST,
            match async_target_url.parse() {
                Ok(url) => url,
                Err(_) => return Ok(open_code_unavailable()),
            },
        );

        // Copy request headers (minus hop-by-hop headers).
        {
            let req_headers = req.headers_mut();
            for (k, v) in headers_in.iter() {
                let name = k.as_str().to_ascii_lowercase();
                if name == "host" || name == "connection" || name == "content-length" {
                    continue;
                }
                if let Ok(header_name) =
                    reqwest::header::HeaderName::from_bytes(k.as_str().as_bytes())
                    && let Ok(header_value) = reqwest::header::HeaderValue::from_bytes(v.as_bytes())
                {
                    req_headers.insert(header_name, header_value);
                }
            }

            if let Some(directory) = directory.as_deref()
                && !req_headers.contains_key("x-opencode-directory")
                && let Ok(value) = reqwest::header::HeaderValue::from_str(directory)
            {
                req_headers.insert(
                    reqwest::header::HeaderName::from_static("x-opencode-directory"),
                    value,
                );
            }
        }
        *req.body_mut() = Some(reqwest::Body::from(body_bytes));

        let resp = bridge
            .client
            .execute(req)
            .await
            .map_err(|_| AppError::bad_gateway("OpenCode request failed"))?;

        if !resp.status().is_success() {
            return Err(AppError::bad_gateway(format!(
                "OpenCode async prompt failed ({})",
                resp.status().as_u16()
            )));
        }

        let mut out = Json(serde_json::json!({ "queued": true })).into_response();
        *out.status_mut() = StatusCode::ACCEPTED;
        return Ok(out);
    }

    let mut req = reqwest::Request::new(
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET),
        match target.parse() {
            Ok(url) => url,
            Err(_) => return Ok(open_code_unavailable()),
        },
    );

    // Copy request headers (minus hop-by-hop headers).
    {
        let req_headers = req.headers_mut();
        for (k, v) in headers.iter() {
            let name = k.as_str().to_ascii_lowercase();
            if name == "host" || name == "connection" || name == "content-length" {
                continue;
            }
            if let Ok(header_name) = reqwest::header::HeaderName::from_bytes(k.as_str().as_bytes())
                && let Ok(header_value) = reqwest::header::HeaderValue::from_bytes(v.as_bytes())
            {
                req_headers.insert(header_name, header_value);
            }
        }

        if let Some(directory) = query_directory.as_deref()
            && !req_headers.contains_key("x-opencode-directory")
            && let Ok(value) = reqwest::header::HeaderValue::from_str(directory)
        {
            req_headers.insert(
                reqwest::header::HeaderName::from_static("x-opencode-directory"),
                value,
            );
        }
    }
    *req.body_mut() = Some(reqwest::Body::from(body));

    let resp = bridge
        .client
        .execute(req)
        .await
        .map_err(|_| AppError::bad_gateway("OpenCode request failed"))?;

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);

    if method == Method::DELETE
        && status.is_success()
        && let Some(session_id) = extract_session_id_from_delete_path(&path)
    {
        // Keep sidebar aggregates consistent even when upstream session.deleted SSE
        // is delayed or dropped.
        state.directory_session_index.remove_summary(&session_id);
    }

    let mut builder = axum::http::Response::builder().status(status);
    if let Some(headers_out) = builder.headers_mut() {
        for (k, v) in resp.headers().iter() {
            let name = k.as_str().to_ascii_lowercase();
            if name == "connection" || name == "content-length" || name == "transfer-encoding" {
                continue;
            }
            if let Ok(header_name) = axum::http::HeaderName::from_bytes(k.as_str().as_bytes())
                && let Ok(header_value) = axum::http::HeaderValue::from_bytes(v.as_bytes())
            {
                headers_out.insert(header_name, header_value);
            }
        }
    }

    match resp.bytes().await {
        Ok(bytes) => {
            let mut body_bytes = bytes.to_vec();

            if status.is_success()
                && should_sanitize_chat_session_response(&path)
                && let Ok(mut payload) = serde_json::from_slice::<serde_json::Value>(&body_bytes)
            {
                sanitize_chat_session_response_payload(&mut payload);
                if let Ok(encoded) = serde_json::to_vec(&payload) {
                    body_bytes = encoded;
                }
            }

            Ok(builder
                .body(axum::body::Body::from(body_bytes))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response()))
        }
        Err(_) => Err(AppError::bad_gateway("Failed to read OpenCode response")),
    }
}

pub(crate) async fn proxy_opencode_rest(
    State(state): State<Arc<crate::AppState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    AxumPath(path): AxumPath<String>,
    body: axum::body::Body,
) -> ApiResult<Response> {
    proxy_opencode_rest_inner(state, method, uri, headers, path, body).await
}

pub(crate) async fn session_message_post(
    State(state): State<Arc<crate::AppState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    AxumPath(session_id): AxumPath<String>,
    body: axum::body::Body,
) -> ApiResult<Response> {
    let path = format!("session/{}/message", urlencoding::encode(&session_id));
    proxy_opencode_rest_inner(state, method, uri, headers, path, body).await
}

#[derive(Clone)]
pub(crate) struct ActivityFilter {
    allowed: HashSet<String>,
    tool_allowed: HashSet<String>,
    tool_explicit: bool,
    show_reasoning: bool,
    show_justification: bool,
}

#[derive(Clone)]
pub(crate) struct ActivityDetailPolicy {
    pub(crate) enabled: bool,
    pub(crate) expanded: HashSet<String>,
    pub(crate) expanded_tools: HashSet<String>,
}

const DEFAULT_ACTIVITY_EXPAND_KEYS: [&str; 9] = [
    "step-start",
    "step-finish",
    "snapshot",
    "patch",
    "agent",
    "retry",
    "compaction",
    "thinking",
    "justification",
];

pub(crate) fn activity_detail_policy_from_settings(
    settings: &crate::settings::Settings,
) -> ActivityDetailPolicy {
    // Activity detail transport now always follows expansion policy.
    let enabled = true;

    let mut expanded: HashSet<String> = HashSet::new();

    if settings.extra.contains_key("chatActivityDefaultExpanded") {
        if let Some(list) = settings
            .extra
            .get("chatActivityDefaultExpanded")
            .and_then(|v| v.as_array())
        {
            for item in list {
                let Some(raw) = item.as_str() else {
                    continue;
                };
                let key = raw.trim().to_ascii_lowercase();
                if key.is_empty() {
                    continue;
                }
                if DEFAULT_ACTIVITY_EXPAND_KEYS
                    .iter()
                    .any(|allowed| allowed.eq_ignore_ascii_case(&key))
                {
                    expanded.insert(key);
                }
            }
        }
    } else {
        // Default to expanded when an explicit per-type list is not set.
        for k in DEFAULT_ACTIVITY_EXPAND_KEYS {
            expanded.insert(k.to_string());
        }
    }

    let expanded_tools = if settings
        .extra
        .contains_key("chatActivityDefaultExpandedToolFilters")
    {
        normalize_chat_activity_tool_filters(
            settings.extra.get("chatActivityDefaultExpandedToolFilters"),
        )
        .into_iter()
        .collect::<HashSet<String>>()
    } else {
        HashSet::new()
    };

    ActivityDetailPolicy {
        enabled,
        expanded,
        expanded_tools,
    }
}

pub(crate) fn activity_filter_from_settings(
    settings: &crate::settings::Settings,
) -> ActivityFilter {
    let show_reasoning = settings
        .extra
        .get("showReasoningTraces")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let show_justification = settings
        .extra
        .get("showTextJustificationActivity")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let filters = if settings.extra.contains_key("chatActivityFilters") {
        normalize_chat_activity_filters(settings.extra.get("chatActivityFilters"))
    } else {
        default_chat_activity_filters()
    };
    let allowed = filters.into_iter().collect::<HashSet<String>>();

    let tool_explicit = settings.extra.contains_key("chatActivityToolFilters");
    let tool_filters = if tool_explicit {
        normalize_chat_activity_tool_filters(settings.extra.get("chatActivityToolFilters"))
    } else {
        default_chat_activity_tool_filters()
    };
    let tool_allowed = tool_filters.into_iter().collect::<HashSet<String>>();

    ActivityFilter {
        allowed,
        tool_allowed,
        tool_explicit,
        show_reasoning,
        show_justification,
    }
}

fn normalize_part_type(part: &serde_json::Value) -> String {
    part.get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn is_tool_part(part_type: &str) -> bool {
    part_type == "tool"
}

fn normalize_tool_id(part: &serde_json::Value) -> Option<String> {
    part.get("tool")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
}

fn matches_unknown_tool_bucket(tool_id: Option<&str>) -> bool {
    match tool_id {
        Some(id) => !KNOWN_TOOL_ACTIVITY_FILTER_IDS.contains(id),
        None => true,
    }
}

fn should_keep_tool_part(part: &serde_json::Value, filter: &ActivityFilter) -> bool {
    if !filter.allowed.contains("tool") {
        return false;
    }
    if !filter.tool_explicit {
        return true;
    }

    let allows_unknown =
        filter.tool_allowed.contains("unknown") || filter.tool_allowed.contains("invalid");
    let tool_id = normalize_tool_id(part);

    match tool_id.as_deref() {
        Some(id) if filter.tool_allowed.contains(id) => true,
        _ if allows_unknown && matches_unknown_tool_bucket(tool_id.as_deref()) => true,
        _ => false,
    }
}

fn is_reasoning_part_type(part_type: &str) -> bool {
    // OpenCode v2 message parts use `type: "reasoning"`.
    part_type == "reasoning"
}

fn expand_key_for_part_type(part_type: &str) -> &str {
    if is_tool_part(part_type) {
        return "tool";
    }
    if is_reasoning_part_type(part_type) {
        return "thinking";
    }
    if part_type == "justification" {
        return "justification";
    }
    part_type
}

fn should_include_detail_for_part(
    part: &serde_json::Value,
    part_type: &str,
    detail: &ActivityDetailPolicy,
) -> bool {
    // Core chat payload; never lazy-load these.
    if part_type == "text" || part_type == "file" {
        return true;
    }
    if !detail.enabled {
        return true;
    }

    if is_tool_part(part_type) {
        let tool_id = normalize_tool_id(part);
        if let Some(id) = tool_id.as_deref()
            && detail.expanded_tools.contains(id)
        {
            return true;
        }
        let allows_unknown =
            detail.expanded_tools.contains("unknown") || detail.expanded_tools.contains("invalid");
        if !allows_unknown {
            return false;
        }
        return matches_unknown_tool_bucket(tool_id.as_deref());
    }

    let key = expand_key_for_part_type(part_type);
    detail.expanded.contains(key)
}

fn truncate_chars(input: &str, max_chars: usize) -> (String, bool) {
    if max_chars == 0 {
        return ("".to_string(), !input.is_empty());
    }
    let mut out = String::new();
    for (count, ch) in input.chars().enumerate() {
        if count >= max_chars {
            return (out, true);
        }
        out.push(ch);
    }
    (out, false)
}

fn normalize_summary_text(input: &str, max_chars: usize) -> Option<String> {
    let first = input.lines().next().unwrap_or("").trim();
    if first.is_empty() {
        return None;
    }
    let (truncated, _) = truncate_chars(first, max_chars);
    let normalized = truncated.trim().to_string();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn is_summary_candidate_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::String(text) => !text.trim().is_empty(),
        serde_json::Value::Number(_) | serde_json::Value::Bool(_) => true,
        serde_json::Value::Array(items) => items.iter().any(|item| {
            matches!(
                item,
                serde_json::Value::Number(_) | serde_json::Value::Bool(_)
            ) || item
                .as_str()
                .map(|text| !text.trim().is_empty())
                .unwrap_or(false)
        }),
        _ => false,
    }
}

fn normalize_summary_value(value: &mut serde_json::Value) -> bool {
    match value {
        serde_json::Value::String(text) => {
            let Some(normalized) = normalize_summary_text(text, 200) else {
                return false;
            };
            *text = normalized;
            true
        }
        serde_json::Value::Number(_) | serde_json::Value::Bool(_) => true,
        serde_json::Value::Array(items) => {
            let mut out = Vec::new();
            for item in items.iter().take(8) {
                match item {
                    serde_json::Value::String(text) => {
                        if let Some(normalized) = normalize_summary_text(text, 60) {
                            out.push(serde_json::Value::String(normalized));
                        }
                    }
                    serde_json::Value::Number(_) | serde_json::Value::Bool(_) => {
                        out.push(item.clone());
                    }
                    _ => {}
                }
            }
            if out.is_empty() {
                return false;
            }
            *items = out;
            true
        }
        _ => false,
    }
}

fn retain_unknown_tool_input_for_summary(
    input_obj: &mut serde_json::Map<String, serde_json::Value>,
) {
    const PRIORITY_KEYS: [&str; 12] = [
        "description",
        "command",
        "argv",
        "query",
        "pattern",
        "path",
        "filePath",
        "file_path",
        "url",
        "name",
        "title",
        "prompt",
    ];

    let mut selected: Option<String> = None;

    for wanted in PRIORITY_KEYS {
        if let Some((key, _)) = input_obj.iter().find(|(key, value)| {
            key.eq_ignore_ascii_case(wanted) && is_summary_candidate_value(value)
        }) {
            selected = Some(key.clone());
            break;
        }
    }

    if selected.is_none()
        && let Some((key, _)) = input_obj
            .iter()
            .find(|(_, value)| is_summary_candidate_value(value))
    {
        selected = Some(key.clone());
    }

    let Some(selected_key) = selected else {
        input_obj.clear();
        return;
    };

    let Some(mut selected_value) = input_obj.remove(&selected_key) else {
        input_obj.clear();
        return;
    };

    if !normalize_summary_value(&mut selected_value) {
        input_obj.clear();
        return;
    }

    input_obj.clear();
    input_obj.insert(selected_key, selected_value);
}

fn prune_tool_state_for_collapsed_summary(
    tool_id: &str,
    state: &mut serde_json::Map<String, serde_json::Value>,
) {
    // Output/detail-heavy fields.
    state.remove("output");
    state.remove("metadata");
    state.remove("result");

    // Errors can be very large; collapsed rows only need status.
    state.remove("error");

    // Input: keep only what's needed for summary labels.
    let Some(input) = state.get_mut("input") else {
        return;
    };
    let Some(input_obj) = input.as_object_mut() else {
        state.remove("input");
        return;
    };

    match tool_id {
        "bash" => {
            // Keep only the first line; truncate to keep payload bounded.
            if let Some(cmd) = input_obj.get("command").and_then(|v| v.as_str()) {
                let first = cmd.split('\n').next().unwrap_or("");
                let (tr, _did) = truncate_chars(first, 200);
                input_obj.insert("command".to_string(), serde_json::Value::String(tr));
            }
            retain_only_keys(input_obj, &["command"]);
        }
        "read" | "edit" | "multiedit" => {
            retain_only_keys(input_obj, &["filePath", "file_path", "path"])
        }
        "write" => {
            // Do NOT ship file contents when collapsed.
            retain_only_keys(input_obj, &["filePath", "file_path", "path"])
        }
        "list" => retain_only_keys(input_obj, &["path"]),
        "glob" => retain_only_keys(input_obj, &["pattern"]),
        "search" | "grep" => retain_only_keys(input_obj, &["pattern", "path"]),
        "task" => retain_only_keys(input_obj, &["description"]),
        "webfetch" | "fetch" | "curl" | "wget" => retain_only_keys(input_obj, &["url"]),
        "question" => {
            // Keep count-ish info without shipping huge payloads.
            // If questions is an array, keep at most 1 entry.
            if let Some(q) = input_obj.get_mut("questions")
                && let Some(arr) = q.as_array_mut()
                && arr.len() > 1
            {
                arr.truncate(1);
            }
            retain_only_keys(input_obj, &["questions"]);
        }
        _ => retain_unknown_tool_input_for_summary(input_obj),
    }

    if input_obj.is_empty() {
        state.remove("input");
    }
}

fn mark_part_lazy(part: &mut serde_json::Value, truncated: bool) {
    let Some(obj) = part.as_object_mut() else {
        return;
    };
    obj.insert("ocLazy".to_string(), serde_json::Value::Bool(true));
    if truncated {
        obj.insert("ocTruncated".to_string(), serde_json::Value::Bool(true));
    }
}

fn part_flag_true(part: &serde_json::Value, key: &str) -> bool {
    part.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn part_has_nonempty_text(part: &serde_json::Value) -> bool {
    part.get("text")
        .and_then(|v| v.as_str())
        .or_else(|| part.get("content").and_then(|v| v.as_str()))
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

fn is_diff_tool(tool_id: &str) -> bool {
    matches!(
        tool_id,
        "edit" | "multiedit" | "apply_patch" | "str_replace" | "str_replace_based_edit_tool"
    )
}

fn should_prune_tool_input(tool_id: &str) -> bool {
    matches!(
        tool_id,
        "apply_patch" | "str_replace" | "str_replace_based_edit_tool"
    )
}

fn retain_only_keys(obj: &mut serde_json::Map<String, serde_json::Value>, keys: &[&str]) {
    obj.retain(|k, _| keys.contains(&k.as_str()));
}

fn finite_number_value(value: &serde_json::Value) -> Option<serde_json::Value> {
    let n = value.as_f64()?;
    if n.is_finite() {
        Some(value.clone())
    } else {
        None
    }
}

fn finite_number_from_map(
    map: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<serde_json::Value> {
    map.get(key).and_then(finite_number_value)
}

fn prune_message_time(value: &mut serde_json::Value) {
    let Some(obj) = value.as_object_mut() else {
        *value = serde_json::Value::Object(serde_json::Map::new());
        return;
    };

    let created = finite_number_from_map(obj, "created");
    let completed = finite_number_from_map(obj, "completed");

    obj.clear();
    if let Some(v) = created {
        obj.insert("created".to_string(), v);
    }
    if let Some(v) = completed {
        obj.insert("completed".to_string(), v);
    }
}

fn prune_activity_time(value: &mut serde_json::Value) {
    let Some(obj) = value.as_object_mut() else {
        *value = serde_json::Value::Object(serde_json::Map::new());
        return;
    };

    let start = finite_number_from_map(obj, "start");
    let end = finite_number_from_map(obj, "end");

    obj.clear();
    if let Some(v) = start {
        obj.insert("start".to_string(), v);
    }
    if let Some(v) = end {
        obj.insert("end".to_string(), v);
    }
}

fn prune_tokens(value: &mut serde_json::Value) {
    let Some(obj) = value.as_object_mut() else {
        *value = serde_json::Value::Object(serde_json::Map::new());
        return;
    };

    let input = finite_number_from_map(obj, "input");
    let output = finite_number_from_map(obj, "output");
    let reasoning = finite_number_from_map(obj, "reasoning");

    let cache_read = obj
        .get("cache")
        .and_then(|v| v.as_object())
        .and_then(|m| finite_number_from_map(m, "read"))
        .or_else(|| finite_number_from_map(obj, "cache_read"))
        .or_else(|| finite_number_from_map(obj, "cacheRead"));

    let cache_write = obj
        .get("cache")
        .and_then(|v| v.as_object())
        .and_then(|m| finite_number_from_map(m, "write"))
        .or_else(|| finite_number_from_map(obj, "cache_write"))
        .or_else(|| finite_number_from_map(obj, "cacheWrite"));

    obj.clear();
    if let Some(v) = input {
        obj.insert("input".to_string(), v);
    }
    if let Some(v) = output {
        obj.insert("output".to_string(), v);
    }
    if let Some(v) = reasoning {
        obj.insert("reasoning".to_string(), v);
    }

    if cache_read.is_some() || cache_write.is_some() {
        let mut cache = serde_json::Map::new();
        if let Some(v) = cache_read {
            cache.insert("read".to_string(), v);
        }
        if let Some(v) = cache_write {
            cache.insert("write".to_string(), v);
        }
        if !cache.is_empty() {
            obj.insert("cache".to_string(), serde_json::Value::Object(cache));
        }
    }
}

fn trim_string_value(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn read_trimmed_from_map(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        if let Some(value) = map.get(*key)
            && let Some(trimmed) = trim_string_value(value)
        {
            return Some(trimmed);
        }
    }
    None
}

fn read_trimmed_from_value(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    value
        .as_object()
        .and_then(|map| read_trimmed_from_map(map, keys))
}

fn read_error_message_from_json_text(text: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(text.trim()).ok()?;
    parsed.as_object().and_then(|obj| {
        read_trimmed_from_map(obj, &["message"])
            .or_else(|| {
                obj.get("error")
                    .and_then(|nested| read_trimmed_from_value(nested, &["message"]))
            })
            .or_else(|| obj.get("error").and_then(trim_string_value))
    })
}

fn finite_number_from_map_keys(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<serde_json::Value> {
    for key in keys {
        if let Some(value) = finite_number_from_map(map, key) {
            return Some(value);
        }
    }
    None
}

fn read_bool_from_map(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<bool> {
    for key in keys {
        if let Some(value) = map.get(*key) {
            if let Some(flag) = value.as_bool() {
                return Some(flag);
            }
            if let Some(text) = trim_string_value(value) {
                let lowered = text.to_ascii_lowercase();
                if lowered == "true" || lowered == "1" || lowered == "yes" {
                    return Some(true);
                }
                if lowered == "false" || lowered == "0" || lowered == "no" {
                    return Some(false);
                }
            }
        }
    }
    None
}

fn scalar_value(value: &serde_json::Value) -> Option<serde_json::Value> {
    if let Some(text) = trim_string_value(value) {
        return Some(serde_json::Value::String(text));
    }
    if let Some(num) = finite_number_value(value) {
        return Some(num);
    }
    value.as_bool().map(serde_json::Value::Bool)
}

fn sanitize_metadata_map(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    let mut out = serde_json::Map::new();
    for (key, value) in map {
        if let Some(cleaned) = scalar_value(value) {
            out.insert(key.clone(), cleaned);
        }
    }
    if out.is_empty() {
        return None;
    }
    Some(out)
}

fn prune_message_error_value(value: &mut serde_json::Value) -> bool {
    let Some(error_obj) = value.as_object() else {
        return false;
    };

    let error_data = error_obj.get("data").and_then(|v| v.as_object());
    let nested_error = error_obj.get("error").and_then(|v| v.as_object());
    let metadata = error_data.and_then(|obj| obj.get("metadata").and_then(|v| v.as_object()));

    let error_name = read_trimmed_from_map(error_obj, &["name", "type"])
        .or_else(|| nested_error.and_then(|obj| read_trimmed_from_map(obj, &["name", "type"])));

    let error_type = read_trimmed_from_map(error_obj, &["type"])
        .or_else(|| nested_error.and_then(|obj| read_trimmed_from_map(obj, &["type"])));

    let error_code = read_trimmed_from_map(error_obj, &["code"])
        .or_else(|| error_data.and_then(|obj| read_trimmed_from_map(obj, &["code"])))
        .or_else(|| nested_error.and_then(|obj| read_trimmed_from_map(obj, &["code"])))
        .or_else(|| metadata.and_then(|obj| read_trimmed_from_map(obj, &["code"])));

    let status_code = error_data
        .and_then(|obj| finite_number_from_map_keys(obj, &["statusCode", "status"]))
        .or_else(|| finite_number_from_map_keys(error_obj, &["statusCode", "status"]))
        .or_else(|| {
            nested_error.and_then(|obj| finite_number_from_map_keys(obj, &["statusCode", "status"]))
        });

    let is_retryable = error_data
        .and_then(|obj| read_bool_from_map(obj, &["isRetryable", "retryable"]))
        .or_else(|| read_bool_from_map(error_obj, &["isRetryable", "retryable"]))
        .or_else(|| {
            nested_error.and_then(|obj| read_bool_from_map(obj, &["isRetryable", "retryable"]))
        });

    let retries = error_data
        .and_then(|obj| finite_number_from_map_keys(obj, &["retries", "retryCount"]))
        .or_else(|| finite_number_from_map_keys(error_obj, &["retries", "retryCount"]))
        .or_else(|| {
            nested_error
                .and_then(|obj| finite_number_from_map_keys(obj, &["retries", "retryCount"]))
        });

    let provider_id = error_data
        .and_then(|obj| read_trimmed_from_map(obj, &["providerID", "providerId", "provider"]))
        .or_else(|| read_trimmed_from_map(error_obj, &["providerID", "providerId", "provider"]))
        .or_else(|| {
            nested_error.and_then(|obj| {
                read_trimmed_from_map(obj, &["providerID", "providerId", "provider"])
            })
        });

    let model_id = error_data
        .and_then(|obj| read_trimmed_from_map(obj, &["modelID", "modelId", "model"]))
        .or_else(|| read_trimmed_from_map(error_obj, &["modelID", "modelId", "model"]))
        .or_else(|| {
            nested_error
                .and_then(|obj| read_trimmed_from_map(obj, &["modelID", "modelId", "model"]))
        });

    let request_id = error_data
        .and_then(|obj| read_trimmed_from_map(obj, &["requestID", "requestId", "request_id"]))
        .or_else(|| read_trimmed_from_map(error_obj, &["requestID", "requestId", "request_id"]))
        .or_else(|| {
            nested_error.and_then(|obj| {
                read_trimmed_from_map(obj, &["requestID", "requestId", "request_id"])
            })
        })
        .or_else(|| {
            metadata.and_then(|obj| {
                read_trimmed_from_map(obj, &["requestID", "requestId", "request_id"])
            })
        });

    let classification = read_trimmed_from_map(error_obj, &["classification"])
        .or_else(|| error_data.and_then(|obj| read_trimmed_from_map(obj, &["classification"])))
        .or_else(|| nested_error.and_then(|obj| read_trimmed_from_map(obj, &["classification"])));

    let response_body_message = error_data
        .and_then(|obj| obj.get("responseBody"))
        .and_then(trim_string_value)
        .and_then(|text| read_error_message_from_json_text(&text));

    let response_body = error_data
        .and_then(|obj| read_trimmed_from_map(obj, &["responseBody"]))
        .or_else(|| read_trimmed_from_map(error_obj, &["responseBody"]))
        .or_else(|| nested_error.and_then(|obj| read_trimmed_from_map(obj, &["responseBody"])));

    let response_message = error_data
        .and_then(|obj| read_trimmed_from_map(obj, &["responseMessage"]))
        .or_else(|| read_trimmed_from_map(error_obj, &["responseMessage"]))
        .or_else(|| nested_error.and_then(|obj| read_trimmed_from_map(obj, &["responseMessage"])));

    let metadata_map = error_data
        .and_then(|obj| obj.get("metadata").and_then(|v| v.as_object()))
        .or_else(|| error_obj.get("metadata").and_then(|v| v.as_object()))
        .or_else(|| nested_error.and_then(|obj| obj.get("metadata").and_then(|v| v.as_object())))
        .and_then(sanitize_metadata_map);

    let error_message = read_trimmed_from_map(error_obj, &["message"])
        .or_else(|| error_data.and_then(|obj| read_trimmed_from_map(obj, &["message"])))
        .or_else(|| nested_error.and_then(|obj| read_trimmed_from_map(obj, &["message"])))
        .or_else(|| response_message.clone())
        .or(response_body_message);

    let mut out = serde_json::Map::new();
    if let Some(name) = error_name {
        out.insert("name".to_string(), serde_json::Value::String(name));
    }
    if let Some(ty) = error_type {
        out.insert("type".to_string(), serde_json::Value::String(ty));
    }
    if let Some(code) = error_code {
        out.insert("code".to_string(), serde_json::Value::String(code));
    }
    if let Some(v) = classification {
        out.insert("classification".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = status_code.clone() {
        out.insert("statusCode".to_string(), v);
    }
    if let Some(v) = is_retryable {
        out.insert("isRetryable".to_string(), serde_json::Value::Bool(v));
    }
    if let Some(v) = retries.clone() {
        out.insert("retries".to_string(), v);
    }
    if let Some(v) = provider_id.clone() {
        out.insert("providerID".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = model_id.clone() {
        out.insert("modelID".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = request_id.clone() {
        out.insert("requestID".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = response_message.clone() {
        out.insert("responseMessage".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = response_body.clone() {
        out.insert("responseBody".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = metadata_map.clone() {
        out.insert("metadata".to_string(), serde_json::Value::Object(v));
    }

    let mut data = serde_json::Map::new();
    if let Some(message) = error_message {
        out.insert(
            "message".to_string(),
            serde_json::Value::String(message.clone()),
        );
        data.insert("message".to_string(), serde_json::Value::String(message));
    }
    if let Some(code) = out.get("code").cloned() {
        data.insert("code".to_string(), code);
    }
    if let Some(v) = out.get("statusCode").cloned() {
        data.insert("statusCode".to_string(), v);
    }
    if let Some(v) = out.get("isRetryable").cloned() {
        data.insert("isRetryable".to_string(), v);
    }
    if let Some(v) = out.get("retries").cloned() {
        data.insert("retries".to_string(), v);
    }
    if let Some(v) = out.get("providerID").cloned() {
        data.insert("providerID".to_string(), v);
    }
    if let Some(v) = out.get("modelID").cloned() {
        data.insert("modelID".to_string(), v);
    }
    if let Some(v) = out.get("requestID").cloned() {
        data.insert("requestID".to_string(), v);
    }
    if let Some(v) = out.get("responseMessage").cloned() {
        data.insert("responseMessage".to_string(), v);
    }
    if let Some(v) = out.get("responseBody").cloned() {
        data.insert("responseBody".to_string(), v);
    }
    if let Some(v) = out.get("metadata").cloned() {
        data.insert("metadata".to_string(), v);
    }
    if !data.is_empty() {
        out.insert("data".to_string(), serde_json::Value::Object(data));
    }

    if out.is_empty() {
        return false;
    }
    *value = serde_json::Value::Object(out);
    true
}

fn prune_message_time_for_sse(value: &mut serde_json::Value) {
    let Some(obj) = value.as_object_mut() else {
        *value = serde_json::Value::Object(serde_json::Map::new());
        return;
    };

    let created = finite_number_from_map(obj, "created");
    let updated = finite_number_from_map(obj, "updated");
    let completed = finite_number_from_map(obj, "completed");

    obj.clear();
    if let Some(v) = created {
        obj.insert("created".to_string(), v);
    }
    if let Some(v) = updated {
        obj.insert("updated".to_string(), v);
    }
    if let Some(v) = completed {
        obj.insert("completed".to_string(), v);
    }
}

fn prune_session_time(value: &mut serde_json::Value) {
    let Some(obj) = value.as_object_mut() else {
        *value = serde_json::Value::Object(serde_json::Map::new());
        return;
    };

    let created = finite_number_from_map(obj, "created");
    let updated = finite_number_from_map(obj, "updated");

    obj.clear();
    if let Some(v) = created {
        obj.insert("created".to_string(), v);
    }
    if let Some(v) = updated {
        obj.insert("updated".to_string(), v);
    }
}

fn prune_session_snapshot_for_sse(value: &mut serde_json::Value) -> bool {
    let Some(obj) = value.as_object_mut() else {
        return false;
    };

    let session_id = read_trimmed_from_map(obj, &["id"]);
    let title = read_trimmed_from_map(obj, &["title"]);
    let slug = read_trimmed_from_map(obj, &["slug"]);
    let directory = read_trimmed_from_map(obj, &["directory"]);
    let parent_id = read_trimmed_from_map(obj, &["parentID", "parentId", "parent_id"]);

    let mut out = serde_json::Map::new();
    if let Some(id) = session_id {
        out.insert("id".to_string(), serde_json::Value::String(id));
    }
    if let Some(v) = title {
        out.insert("title".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = slug {
        out.insert("slug".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = directory {
        out.insert("directory".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = parent_id {
        out.insert("parentID".to_string(), serde_json::Value::String(v));
    }

    if let Some(mut time) = obj.get("time").cloned() {
        prune_session_time(&mut time);
        if time.as_object().is_some_and(|m| !m.is_empty()) {
            out.insert("time".to_string(), time);
        }
    }

    if let Some(share) = obj.get("share").and_then(|v| v.as_object()) {
        let mut next = serde_json::Map::new();
        if let Some(url) = read_trimmed_from_map(share, &["url"]) {
            next.insert("url".to_string(), serde_json::Value::String(url));
        }
        if !next.is_empty() {
            out.insert("share".to_string(), serde_json::Value::Object(next));
        }
    }

    if let Some(revert) = obj.get("revert").and_then(|v| v.as_object()) {
        let mut next = serde_json::Map::new();
        if let Some(message_id) =
            read_trimmed_from_map(revert, &["messageID", "messageId", "message_id"])
        {
            next.insert(
                "messageID".to_string(),
                serde_json::Value::String(message_id),
            );
        }
        if let Some(diff) = read_trimmed_from_map(revert, &["diff"]) {
            next.insert("diff".to_string(), serde_json::Value::String(diff));
        }
        if !next.is_empty() {
            out.insert("revert".to_string(), serde_json::Value::Object(next));
        }
    }

    let has_id = out.get("id").is_some();
    *obj = out;
    has_id
}

pub(crate) fn prune_session_summary_value(value: &mut serde_json::Value) -> bool {
    prune_session_snapshot_for_sse(value)
}

fn prune_status_value(value: &mut serde_json::Value) -> bool {
    let Some(obj) = value.as_object_mut() else {
        return false;
    };

    let status_type = read_trimmed_from_map(obj, &["type"]);
    let mut out = serde_json::Map::new();
    if let Some(ty) = status_type {
        out.insert("type".to_string(), serde_json::Value::String(ty.clone()));
        if ty == "retry" {
            if let Some(v) = finite_number_from_map(obj, "attempt") {
                out.insert("attempt".to_string(), v);
            }
            if let Some(v) = read_trimmed_from_map(obj, &["message"]) {
                out.insert("message".to_string(), serde_json::Value::String(v));
            }
            if let Some(v) = finite_number_from_map(obj, "next") {
                out.insert("next".to_string(), v);
            }
        }
    }

    let valid = out.get("type").is_some();
    *obj = out;
    valid
}

fn prune_session_status_payload(payload: &mut serde_json::Value) {
    let Some(map) = payload.as_object_mut() else {
        return;
    };

    let keys: Vec<String> = map.keys().cloned().collect();
    for key in keys {
        let should_keep = map.get_mut(&key).map(prune_status_value).unwrap_or(false);
        if !should_keep {
            map.remove(&key);
        }
    }
}

fn prune_permission_object(obj: &mut serde_json::Map<String, serde_json::Value>) -> bool {
    let id = read_trimmed_from_map(obj, &["id"]);
    let session_id = read_trimmed_from_map(obj, &["sessionID", "sessionId", "session_id"]);
    let permission = read_trimmed_from_map(obj, &["permission"]);

    let patterns = obj
        .get("patterns")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(trim_string_value)
                .map(serde_json::Value::String)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let always = obj
        .get("always")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(trim_string_value)
                .map(serde_json::Value::String)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut out = serde_json::Map::new();
    if let Some(v) = id {
        out.insert("id".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = session_id {
        out.insert("sessionID".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = permission {
        out.insert("permission".to_string(), serde_json::Value::String(v));
    }
    if !patterns.is_empty() {
        out.insert("patterns".to_string(), serde_json::Value::Array(patterns));
    }
    if !always.is_empty() {
        out.insert("always".to_string(), serde_json::Value::Array(always));
    }

    let valid = out.get("id").is_some() && out.get("sessionID").is_some();
    *obj = out;
    valid
}

fn prune_question_options(value: &serde_json::Value) -> Vec<serde_json::Value> {
    let Some(arr) = value.as_array() else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for item in arr {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let label = read_trimmed_from_map(obj, &["label"]);
        let description = read_trimmed_from_map(obj, &["description"]);
        if label.is_none() {
            continue;
        }
        let mut next = serde_json::Map::new();
        if let Some(v) = label {
            next.insert("label".to_string(), serde_json::Value::String(v));
        }
        if let Some(v) = description {
            next.insert("description".to_string(), serde_json::Value::String(v));
        }
        out.push(serde_json::Value::Object(next));
    }
    out
}

fn prune_question_questions(value: &mut serde_json::Value) {
    let Some(arr) = value.as_array_mut() else {
        *value = serde_json::Value::Array(Vec::new());
        return;
    };

    let mut out = Vec::new();
    for item in arr.iter() {
        let Some(obj) = item.as_object() else {
            continue;
        };

        let header = read_trimmed_from_map(obj, &["header"]);
        let question = read_trimmed_from_map(obj, &["question"]);
        if header.is_none() || question.is_none() {
            continue;
        }

        let options = obj
            .get("options")
            .map(prune_question_options)
            .unwrap_or_default();

        let multiple = obj.get("multiple").and_then(|v| v.as_bool());
        let custom = obj.get("custom").and_then(|v| v.as_bool());

        let mut next = serde_json::Map::new();
        if let Some(v) = header {
            next.insert("header".to_string(), serde_json::Value::String(v));
        }
        if let Some(v) = question {
            next.insert("question".to_string(), serde_json::Value::String(v));
        }
        if !options.is_empty() {
            next.insert("options".to_string(), serde_json::Value::Array(options));
        }
        if let Some(v) = multiple {
            next.insert("multiple".to_string(), serde_json::Value::Bool(v));
        }
        if let Some(v) = custom {
            next.insert("custom".to_string(), serde_json::Value::Bool(v));
        }
        out.push(serde_json::Value::Object(next));
    }

    *arr = out;
}

fn prune_question_object(obj: &mut serde_json::Map<String, serde_json::Value>) -> bool {
    let id = read_trimmed_from_map(obj, &["id"]);
    let session_id = read_trimmed_from_map(obj, &["sessionID", "sessionId", "session_id"]);

    let mut questions = obj
        .get("questions")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));
    prune_question_questions(&mut questions);
    let has_questions = questions.as_array().is_some_and(|arr| !arr.is_empty());

    let mut out = serde_json::Map::new();
    if let Some(v) = id {
        out.insert("id".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = session_id {
        out.insert("sessionID".to_string(), serde_json::Value::String(v));
    }
    if has_questions {
        out.insert("questions".to_string(), questions);
    }

    let valid = out.get("id").is_some() && out.get("sessionID").is_some() && has_questions;
    *obj = out;
    valid
}

fn prune_permission_payload(payload: &mut serde_json::Value) {
    let Some(arr) = payload.as_array_mut() else {
        return;
    };

    let mut out = Vec::new();
    for item in arr.iter_mut() {
        let Some(obj) = item.as_object_mut() else {
            continue;
        };
        if prune_permission_object(obj) {
            out.push(serde_json::Value::Object(obj.clone()));
        }
    }
    *arr = out;
}

fn prune_question_payload(payload: &mut serde_json::Value) {
    let Some(arr) = payload.as_array_mut() else {
        return;
    };

    let mut out = Vec::new();
    for item in arr.iter_mut() {
        let Some(obj) = item.as_object_mut() else {
            continue;
        };
        if prune_question_object(obj) {
            out.push(serde_json::Value::Object(obj.clone()));
        }
    }
    *arr = out;
}

fn should_keep_part(part: &serde_json::Value, part_type: &str, filter: &ActivityFilter) -> bool {
    if part_type == "text" {
        if part_flag_true(part, "synthetic") || part_flag_true(part, "ignored") {
            return false;
        }
        return part_has_nonempty_text(part);
    }
    if part_type == "file" {
        return !(part_flag_true(part, "synthetic") || part_flag_true(part, "ignored"));
    }
    if is_tool_part(part_type) {
        return should_keep_tool_part(part, filter);
    }
    if is_reasoning_part_type(part_type) {
        return filter.show_reasoning && part_has_nonempty_text(part);
    }
    if part_type == "justification" {
        return filter.show_justification && part_has_nonempty_text(part);
    }
    if !part_type.is_empty() && filter.allowed.contains(part_type) {
        return true;
    }
    false
}

fn prune_tool_metadata_files(value: &mut serde_json::Value) {
    let Some(obj) = value.as_object_mut() else {
        return;
    };
    let Some(files) = obj.get_mut("files").and_then(|v| v.as_array_mut()) else {
        return;
    };
    for file in files.iter_mut() {
        if let Some(map) = file.as_object_mut() {
            retain_only_keys(
                map,
                &[
                    "path",
                    "file",
                    "filename",
                    "name",
                    "target",
                    "filePath",
                    "filepath",
                    "relativePath",
                    "type",
                    "diff",
                    "before",
                    "after",
                    "additions",
                    "deletions",
                    "added",
                    "removed",
                ],
            );
        }
    }
}

fn prune_tool_input(state: &mut serde_json::Map<String, serde_json::Value>, tool_id: &str) {
    let Some(input) = state.get_mut("input") else {
        return;
    };
    let Some(input_obj) = input.as_object_mut() else {
        state.remove("input");
        return;
    };

    match tool_id {
        "bash" => retain_only_keys(input_obj, &["command"]),
        "read" | "edit" | "multiedit" => {
            retain_only_keys(input_obj, &["filePath", "file_path", "path"])
        }
        "write" => retain_only_keys(
            input_obj,
            &["filePath", "file_path", "path", "content", "text"],
        ),
        "list" => retain_only_keys(input_obj, &["path"]),
        "glob" => retain_only_keys(input_obj, &["pattern"]),
        "search" | "grep" => retain_only_keys(input_obj, &["pattern", "path"]),
        "task" => retain_only_keys(input_obj, &["description"]),
        "webfetch" | "fetch" | "curl" | "wget" => retain_only_keys(input_obj, &["url"]),
        "question" => retain_only_keys(input_obj, &["questions"]),
        _ => retain_unknown_tool_input_for_summary(input_obj),
    }

    if input_obj.is_empty() {
        state.remove("input");
    }
}

fn should_keep_sse_part(
    part: &serde_json::Value,
    part_type: &str,
    filter: &ActivityFilter,
    delta: Option<&str>,
) -> bool {
    let has_delta = delta.is_some_and(|v| !v.trim().is_empty());

    if part_type == "text" {
        if part_flag_true(part, "synthetic") || part_flag_true(part, "ignored") {
            return false;
        }
        return part_has_nonempty_text(part) || has_delta;
    }
    if part_type == "file" {
        return !(part_flag_true(part, "synthetic") || part_flag_true(part, "ignored"));
    }
    if is_tool_part(part_type) {
        return should_keep_tool_part(part, filter);
    }
    if is_reasoning_part_type(part_type) {
        return filter.show_reasoning && (part_has_nonempty_text(part) || has_delta);
    }
    if part_type == "justification" {
        return filter.show_justification && (part_has_nonempty_text(part) || has_delta);
    }
    if !part_type.is_empty() && filter.allowed.contains(part_type) {
        return true;
    }
    false
}

fn prune_part_for_sse(
    part: &mut serde_json::Value,
    part_type: &str,
    session_id: &str,
    message_id: &str,
    part_id: Option<&str>,
    include_detail: bool,
) {
    if is_tool_part(part_type) {
        prune_tool_metadata(part);
    } else {
        prune_part_metadata(part, part_type);
        if part_type == "patch"
            && let Some(obj) = part.as_object_mut()
        {
            obj.remove("hash");
        }
    }

    let Some(obj) = part.as_object_mut() else {
        return;
    };
    obj.insert(
        "sessionID".to_string(),
        serde_json::Value::String(session_id.to_string()),
    );
    obj.insert(
        "messageID".to_string(),
        serde_json::Value::String(message_id.to_string()),
    );

    if let Some(pid) = part_id {
        let has_id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .is_some_and(|v| !v.trim().is_empty());
        if !has_id {
            obj.insert("id".to_string(), serde_json::Value::String(pid.to_string()));
        }
        obj.insert(
            "partID".to_string(),
            serde_json::Value::String(pid.to_string()),
        );
    }

    if include_detail {
        return;
    }

    let mut truncated = false;

    if is_tool_part(part_type) {
        let tool_id = obj
            .get("tool")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if let Some(state) = obj.get_mut("state").and_then(|v| v.as_object_mut()) {
            prune_tool_state_for_collapsed_summary(&tool_id, state);
        }
        obj.insert("ocLazy".to_string(), serde_json::Value::Bool(true));
        return;
    }

    if part_type == "patch" {
        let file_count = obj
            .get("files")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        obj.insert(
            "fileCount".to_string(),
            serde_json::Value::Number(serde_json::Number::from(file_count as u64)),
        );
        obj.remove("files");
    }

    if (part_type == "snapshot" || part_type == "step-start")
        && let Some(s) = obj.get("snapshot").and_then(|v| v.as_str())
    {
        let (tr, did) = truncate_chars(s, 256);
        if did {
            truncated = true;
            obj.insert("snapshot".to_string(), serde_json::Value::String(tr));
        }
    }

    if is_reasoning_part_type(part_type) || part_type == "justification" {
        if let Some(s) = obj.get("text").and_then(|v| v.as_str()) {
            let (tr, did) = truncate_chars(s, 512);
            if did {
                truncated = true;
                obj.insert("text".to_string(), serde_json::Value::String(tr));
            }
        }
        if let Some(s) = obj.get("content").and_then(|v| v.as_str()) {
            let (tr, did) = truncate_chars(s, 512);
            if did {
                truncated = true;
                obj.insert("content".to_string(), serde_json::Value::String(tr));
            }
        }
    }

    obj.insert("ocLazy".to_string(), serde_json::Value::Bool(true));
    if truncated {
        obj.insert("ocTruncated".to_string(), serde_json::Value::Bool(true));
    }
}

fn prune_message_info_for_sse(info: &mut serde_json::Map<String, serde_json::Value>) -> bool {
    let session_id = read_trimmed_from_map(info, &["sessionID", "sessionId", "session_id"]);
    let id = read_trimmed_from_map(info, &["id"]);

    retain_only_keys(
        info,
        &[
            "id",
            "role",
            "time",
            "finish",
            "agent",
            "modelID",
            "providerID",
            "model",
            "provider",
            "variant",
            "cost",
            "tokens",
            "error",
        ],
    );

    if let Some(v) = id {
        info.insert("id".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = session_id {
        info.insert("sessionID".to_string(), serde_json::Value::String(v));
    }

    if info.get("cost").and_then(finite_number_value).is_none() {
        info.remove("cost");
    }

    if let Some(tokens) = info.get_mut("tokens") {
        prune_tokens(tokens);
    }
    if info
        .get("tokens")
        .and_then(|v| v.as_object())
        .is_some_and(|m| m.is_empty())
        || info.get("tokens").is_some_and(|v| !v.is_object())
    {
        info.remove("tokens");
    }

    if let Some(time) = info.get_mut("time") {
        prune_message_time_for_sse(time);
    }
    if info
        .get("time")
        .and_then(|v| v.as_object())
        .is_some_and(|m| m.is_empty())
        || info.get("time").is_some_and(|v| !v.is_object())
    {
        info.remove("time");
    }

    if let Some(model) = info.get_mut("model") {
        if let Some(model_obj) = model.as_object_mut() {
            retain_only_keys(model_obj, &["providerID", "modelID"]);
            if model_obj.is_empty() {
                info.remove("model");
            }
        } else if !model.is_string() {
            info.remove("model");
        }
    }

    if info.get("provider").is_some_and(|v| !v.is_string()) {
        info.remove("provider");
    }
    if info.get("variant").is_some_and(|v| !v.is_string()) {
        info.remove("variant");
    }

    if let Some(error) = info.get_mut("error")
        && !prune_message_error_value(error)
    {
        info.remove("error");
    }

    info.get("id")
        .and_then(|v| v.as_str())
        .is_some_and(|v| !v.trim().is_empty())
        && info
            .get("sessionID")
            .and_then(|v| v.as_str())
            .is_some_and(|v| !v.trim().is_empty())
}

fn sanitize_message_part_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
    filter: &ActivityFilter,
    detail: &ActivityDetailPolicy,
) -> bool {
    let delta = props
        .get("delta")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    let mut part = if let Some(value) = props.remove("part") {
        value
    } else if let Some(value) = props.remove("messagePart") {
        value
    } else if let Some(value) = props.remove("partInfo") {
        value
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };

    let (session_id, message_id, part_id, part_type) = {
        let Some(part_obj) = part.as_object_mut() else {
            return false;
        };

        let session_id = read_trimmed_from_map(part_obj, &["sessionID", "sessionId", "session_id"])
            .or_else(|| read_trimmed_from_map(props, &["sessionID", "sessionId", "session_id"]));
        let message_id = read_trimmed_from_map(part_obj, &["messageID", "messageId", "message_id"])
            .or_else(|| read_trimmed_from_map(props, &["messageID", "messageId", "message_id"]));
        let part_id = read_trimmed_from_map(part_obj, &["id", "partID", "partId", "part_id"])
            .or_else(|| read_trimmed_from_map(props, &["partID", "partId", "part_id"]));

        let Some(session_id) = session_id else {
            return false;
        };
        let Some(message_id) = message_id else {
            return false;
        };

        part_obj.insert(
            "sessionID".to_string(),
            serde_json::Value::String(session_id.clone()),
        );
        part_obj.insert(
            "messageID".to_string(),
            serde_json::Value::String(message_id.clone()),
        );
        if let Some(pid) = part_id.as_ref() {
            part_obj.insert("partID".to_string(), serde_json::Value::String(pid.clone()));
            if part_obj
                .get("id")
                .and_then(|v| v.as_str())
                .is_none_or(|v| v.trim().is_empty())
            {
                part_obj.insert("id".to_string(), serde_json::Value::String(pid.clone()));
            }
        }

        let mut part_type = read_trimmed_from_map(part_obj, &["type"])
            .map(|v| v.to_ascii_lowercase())
            .unwrap_or_default();
        if part_type.is_empty() {
            if let Some(kind) = read_trimmed_from_map(part_obj, &["kind"]) {
                part_type = kind.to_ascii_lowercase();
                part_obj.insert("type".to_string(), serde_json::Value::String(kind));
            } else {
                let has_nonempty_text = part_obj
                    .get("text")
                    .and_then(trim_string_value)
                    .or_else(|| part_obj.get("content").and_then(trim_string_value))
                    .is_some();
                if has_nonempty_text || delta.as_deref().is_some_and(|v| !v.trim().is_empty()) {
                    part_type = "text".to_string();
                    part_obj.insert(
                        "type".to_string(),
                        serde_json::Value::String("text".to_string()),
                    );
                }
            }
        }

        (session_id, message_id, part_id, part_type)
    };

    if !should_keep_sse_part(&part, &part_type, filter, delta.as_deref()) {
        return false;
    }

    let include_detail = should_include_detail_for_part(&part, &part_type, detail);

    prune_part_for_sse(
        &mut part,
        &part_type,
        &session_id,
        &message_id,
        part_id.as_deref(),
        include_detail,
    );

    props.clear();
    props.insert(
        "sessionID".to_string(),
        serde_json::Value::String(session_id.clone()),
    );
    props.insert(
        "messageID".to_string(),
        serde_json::Value::String(message_id),
    );
    if let Some(pid) = part_id {
        props.insert("partID".to_string(), serde_json::Value::String(pid));
    }
    props.insert("part".to_string(), part);
    if let Some(value) = delta
        && !value.trim().is_empty()
    {
        props.insert("delta".to_string(), serde_json::Value::String(value));
    }
    true
}

fn sanitize_message_updated_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let Some(mut info_value) = props.remove("info") else {
        return false;
    };
    let Some(info_obj) = info_value.as_object_mut() else {
        return false;
    };
    if !prune_message_info_for_sse(info_obj) {
        return false;
    }

    let session_id = read_trimmed_from_map(info_obj, &["sessionID"]);
    props.clear();
    if let Some(v) = session_id {
        props.insert("sessionID".to_string(), serde_json::Value::String(v));
    }
    props.insert("info".to_string(), info_value);
    true
}

fn sanitize_message_removed_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let session_id = read_trimmed_from_map(props, &["sessionID", "sessionId", "session_id"]);
    let message_id = read_trimmed_from_map(props, &["messageID", "messageId", "message_id"]);
    let Some(session_id) = session_id else {
        return false;
    };
    let Some(message_id) = message_id else {
        return false;
    };

    props.clear();
    props.insert(
        "sessionID".to_string(),
        serde_json::Value::String(session_id),
    );
    props.insert(
        "messageID".to_string(),
        serde_json::Value::String(message_id),
    );
    true
}

fn sanitize_message_part_removed_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let session_id = read_trimmed_from_map(props, &["sessionID", "sessionId", "session_id"]);
    let message_id = read_trimmed_from_map(props, &["messageID", "messageId", "message_id"]);
    let part_id = read_trimmed_from_map(props, &["partID", "partId", "part_id"]);

    let Some(session_id) = session_id else {
        return false;
    };
    let Some(message_id) = message_id else {
        return false;
    };
    let Some(part_id) = part_id else {
        return false;
    };

    props.clear();
    props.insert(
        "sessionID".to_string(),
        serde_json::Value::String(session_id),
    );
    props.insert(
        "messageID".to_string(),
        serde_json::Value::String(message_id),
    );
    props.insert("partID".to_string(), serde_json::Value::String(part_id));
    true
}

fn sanitize_session_status_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let session_id = read_trimmed_from_map(props, &["sessionID", "sessionId", "session_id"]);
    let Some(session_id) = session_id else {
        return false;
    };

    let Some(mut status) = props.remove("status") else {
        return false;
    };
    if !prune_status_value(&mut status) {
        return false;
    }

    props.clear();
    props.insert(
        "sessionID".to_string(),
        serde_json::Value::String(session_id),
    );
    props.insert("status".to_string(), status);
    true
}

fn sanitize_session_idle_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let session_id = read_trimmed_from_map(props, &["sessionID", "sessionId", "session_id"]);
    let Some(session_id) = session_id else {
        return false;
    };
    props.clear();
    props.insert(
        "sessionID".to_string(),
        serde_json::Value::String(session_id),
    );
    true
}

fn sanitize_session_error_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let session_id = read_trimmed_from_map(props, &["sessionID", "sessionId", "session_id"]);

    let error_value = props.get("error").cloned();
    let mut error_out = serde_json::Map::new();
    if let Some(mut value) = error_value.clone()
        && prune_message_error_value(&mut value)
        && let Some(obj) = value.as_object()
    {
        error_out = obj.clone();
    }

    if error_out.get("message").is_none()
        && let Some(message) = error_value
            .as_ref()
            .and_then(trim_string_value)
            .or_else(|| read_trimmed_from_map(props, &["message"]))
    {
        error_out.insert("message".to_string(), serde_json::Value::String(message));
    }

    let classification = read_trimmed_from_map(props, &["classification"])
        .or_else(|| error_out.get("classification").and_then(trim_string_value));

    props.clear();
    if let Some(v) = session_id {
        props.insert("sessionID".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = classification {
        props.insert("classification".to_string(), serde_json::Value::String(v));
    }
    if !error_out.is_empty() {
        props.insert("error".to_string(), serde_json::Value::Object(error_out));
    }
    !props.is_empty()
}

fn sanitize_attention_replied_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let session_id = read_trimmed_from_map(props, &["sessionID", "sessionId", "session_id"]);
    let request_id = read_trimmed_from_map(props, &["id"]);

    let Some(session_id) = session_id else {
        return false;
    };

    props.clear();
    props.insert(
        "sessionID".to_string(),
        serde_json::Value::String(session_id),
    );
    if let Some(v) = request_id {
        props.insert("id".to_string(), serde_json::Value::String(v));
    }
    true
}

fn sanitize_permission_asked_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    prune_permission_object(props)
}

fn sanitize_question_asked_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    prune_question_object(props)
}

fn sanitize_session_created_updated_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let mut session_value = props
        .remove("session")
        .or_else(|| props.remove("value"))
        .or_else(|| props.remove("data"));

    let session_id = read_trimmed_from_map(props, &["sessionID", "sessionId", "session_id"]);
    let title = read_trimmed_from_map(props, &["title"]);
    let slug = read_trimmed_from_map(props, &["slug"]);

    let mut out = serde_json::Map::new();
    if let Some(ref mut value) = session_value
        && prune_session_snapshot_for_sse(value)
    {
        out.insert("session".to_string(), value.clone());
    }
    if let Some(v) = session_id {
        out.insert("sessionID".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = title {
        out.insert("title".to_string(), serde_json::Value::String(v));
    }
    if let Some(v) = slug {
        out.insert("slug".to_string(), serde_json::Value::String(v));
    }

    let keep = !out.is_empty();
    *props = out;
    keep
}

fn sanitize_session_deleted_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let session_id = read_trimmed_from_map(props, &["sessionID", "sessionId", "session_id", "id"])
        .or_else(|| {
            props
                .get("session")
                .and_then(|value| read_trimmed_from_value(value, &["id"]))
        })
        .or_else(|| {
            props
                .get("value")
                .and_then(|value| read_trimmed_from_value(value, &["id"]))
        })
        .or_else(|| {
            props
                .get("data")
                .and_then(|value| read_trimmed_from_value(value, &["id"]))
        });
    let Some(session_id) = session_id else {
        return false;
    };

    props.clear();
    props.insert(
        "sessionID".to_string(),
        serde_json::Value::String(session_id),
    );
    true
}

fn sanitize_session_activity_event_properties(
    props: &mut serde_json::Map<String, serde_json::Value>,
) -> bool {
    let session_id = read_trimmed_from_map(props, &["sessionID", "sessionId", "session_id"]);
    let phase = read_trimmed_from_map(props, &["phase"]);
    let Some(session_id) = session_id else {
        return false;
    };
    let Some(phase) = phase else {
        return false;
    };
    if phase != "idle" && phase != "busy" && phase != "cooldown" {
        return false;
    }

    props.clear();
    props.insert(
        "sessionID".to_string(),
        serde_json::Value::String(session_id),
    );
    props.insert("phase".to_string(), serde_json::Value::String(phase));
    true
}

fn sse_event_payload_mut(raw: &mut serde_json::Value) -> Option<&mut serde_json::Value> {
    if raw
        .as_object()
        .and_then(|obj| obj.get("type"))
        .and_then(|v| v.as_str())
        .is_some()
    {
        return Some(raw);
    }

    let payload = raw.get_mut("payload")?;
    if payload
        .as_object()
        .and_then(|obj| obj.get("type"))
        .and_then(|v| v.as_str())
        .is_some()
    {
        return Some(payload);
    }
    None
}

pub(crate) fn sanitize_sse_event_data(
    raw: &mut serde_json::Value,
    filter: &ActivityFilter,
    detail: &ActivityDetailPolicy,
) -> bool {
    let Some(event) = sse_event_payload_mut(raw) else {
        return true;
    };
    let Some(event_obj) = event.as_object_mut() else {
        return true;
    };

    let event_type = event_obj
        .get("type")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if event_type.is_empty() {
        return true;
    }

    if event_type == "opencode-studio:heartbeat" {
        retain_only_keys(event_obj, &["type", "timestamp"]);
        return true;
    }

    let mut props = match event_obj.remove("properties") {
        Some(serde_json::Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };

    let keep = match event_type.as_str() {
        "message.updated" => sanitize_message_updated_event_properties(&mut props),
        "message.part.updated" | "message.part.created" => {
            sanitize_message_part_event_properties(&mut props, filter, detail)
        }
        "message.removed" => sanitize_message_removed_event_properties(&mut props),
        "message.part.removed" => sanitize_message_part_removed_event_properties(&mut props),
        "session.status" => sanitize_session_status_event_properties(&mut props),
        "session.idle" => sanitize_session_idle_event_properties(&mut props),
        "session.error" => sanitize_session_error_event_properties(&mut props),
        "permission.asked" => sanitize_permission_asked_event_properties(&mut props),
        "question.asked" => sanitize_question_asked_event_properties(&mut props),
        "permission.replied" | "question.replied" | "question.rejected" => {
            sanitize_attention_replied_event_properties(&mut props)
        }
        "session.created" | "session.updated" => {
            sanitize_session_created_updated_event_properties(&mut props)
        }
        "session.deleted" => sanitize_session_deleted_event_properties(&mut props),
        "opencode-studio:session-activity" => {
            sanitize_session_activity_event_properties(&mut props)
        }
        _ => true,
    };

    if !keep {
        return false;
    }

    if !props.is_empty() {
        event_obj.insert("properties".to_string(), serde_json::Value::Object(props));
    }
    true
}

fn parse_sse_block_data_json(block: &str) -> Option<serde_json::Value> {
    if block.trim().is_empty() {
        return None;
    }

    let data_lines: Vec<&str> = block
        .lines()
        .filter_map(|line| {
            let line = line.trim_end();
            line.strip_prefix("data:").map(|rest| rest.trim_start())
        })
        .collect();

    if data_lines.is_empty() {
        return None;
    }

    let text = data_lines.join("\n");
    serde_json::from_str(text.trim()).ok()
}

fn rewrite_sse_block_data_json(block: &str, data: &serde_json::Value) -> Option<String> {
    let encoded = serde_json::to_string(data).ok()?;
    let mut out = String::new();
    let mut inserted = false;

    for line in block.lines() {
        if line.trim_start().starts_with("data:") {
            if !inserted {
                out.push_str("data: ");
                out.push_str(&encoded);
                out.push('\n');
                inserted = true;
            }
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }

    if !inserted {
        out.push_str("data: ");
        out.push_str(&encoded);
        out.push('\n');
    }

    Some(out.trim_end_matches('\n').to_string())
}

fn prune_tool_metadata(part: &mut serde_json::Value) {
    let Some(obj) = part.as_object_mut() else {
        return;
    };

    retain_only_keys(obj, &["id", "type", "tool", "state", "time"]);

    let tool_id = obj
        .get("tool")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    if let Some(time) = obj.get_mut("time") {
        prune_activity_time(time);
    }
    if obj
        .get("time")
        .and_then(|v| v.as_object())
        .is_some_and(|m| m.is_empty())
        || obj.get("time").is_some_and(|v| !v.is_object())
    {
        obj.remove("time");
    }

    let Some(state) = obj.get_mut("state").and_then(|v| v.as_object_mut()) else {
        obj.remove("state");
        return;
    };

    retain_only_keys(
        state,
        &[
            "status", "title", "time", "input", "output", "error", "metadata", "result",
        ],
    );

    if let Some(time) = state.get_mut("time") {
        prune_activity_time(time);
    }
    if state
        .get("time")
        .and_then(|v| v.as_object())
        .is_some_and(|m| m.is_empty())
        || state.get("time").is_some_and(|v| !v.is_object())
    {
        state.remove("time");
    }

    // For patch/replace tools, `input` is large and not used by chat rendering.
    // Keep edit/multiedit input for fallback summary labels.
    if should_prune_tool_input(&tool_id) {
        state.remove("input");
    } else {
        prune_tool_input(state, &tool_id);
    }

    // Web UI reads explicit `output`; avoid carrying duplicate `result` payloads.
    state.remove("result");

    if !is_diff_tool(&tool_id) {
        state.remove("metadata");
        return;
    }

    let Some(metadata) = state.get_mut("metadata") else {
        return;
    };
    prune_tool_metadata_files(metadata);

    let Some(map) = metadata.as_object_mut() else {
        state.remove("metadata");
        return;
    };
    map.retain(|k, _| matches!(k.as_str(), "diff" | "files" | "truncated"));

    if map.is_empty() {
        state.remove("metadata");
    }
}

fn prune_part_transport_fields(part: &mut serde_json::Value) {
    let Some(obj) = part.as_object_mut() else {
        return;
    };
    obj.remove("sessionID");
    obj.remove("messageID");

    // Unused transport/detail keys.
    obj.remove("callID");
}

fn prune_part_metadata(part: &mut serde_json::Value, part_type: &str) {
    let Some(obj) = part.as_object_mut() else {
        return;
    };

    match part_type {
        "text" => retain_only_keys(
            obj,
            &["id", "type", "text", "content", "synthetic", "ignored"],
        ),
        "file" => retain_only_keys(
            obj,
            &[
                "id",
                "type",
                "url",
                "mime",
                "filename",
                "serverPath",
                "synthetic",
                "ignored",
            ],
        ),
        "reasoning" | "justification" => {
            retain_only_keys(obj, &["id", "type", "text", "content", "time"])
        }
        "step-start" | "snapshot" => retain_only_keys(obj, &["id", "type", "snapshot", "time"]),
        "step-finish" => retain_only_keys(obj, &["id", "type", "reason", "cost", "time"]),
        "patch" => retain_only_keys(obj, &["id", "type", "files", "time"]),
        "agent" => retain_only_keys(obj, &["id", "type", "name", "time"]),
        "retry" => {
            retain_only_keys(obj, &["id", "type", "attempt", "error", "time"]);
            if let Some(error) = obj.get_mut("error") {
                if let Some(error_obj) = error.as_object_mut() {
                    retain_only_keys(error_obj, &["message"]);
                    if error_obj.is_empty() {
                        obj.remove("error");
                    }
                } else {
                    obj.remove("error");
                }
            }
        }
        "compaction" => retain_only_keys(obj, &["id", "type", "auto", "time"]),
        _ => retain_only_keys(obj, &["id", "type", "time"]),
    }

    if matches!(part_type, "step-finish") && obj.get("cost").and_then(finite_number_value).is_none()
    {
        obj.remove("cost");
    }

    if let Some(time) = obj.get_mut("time") {
        prune_activity_time(time);
    }
    if obj
        .get("time")
        .and_then(|v| v.as_object())
        .is_some_and(|m| m.is_empty())
        || obj.get("time").is_some_and(|v| !v.is_object())
    {
        obj.remove("time");
    }
}

fn prune_message_info(info: &mut serde_json::Map<String, serde_json::Value>) {
    retain_only_keys(
        info,
        &[
            "id",
            "role",
            "time",
            "finish",
            "agent",
            "modelID",
            "providerID",
            "model",
            "provider",
            "variant",
            "cost",
            "tokens",
            "error",
        ],
    );

    if info.get("cost").and_then(finite_number_value).is_none() {
        info.remove("cost");
    }

    if let Some(tokens) = info.get_mut("tokens") {
        prune_tokens(tokens);
    }
    if info
        .get("tokens")
        .and_then(|v| v.as_object())
        .is_some_and(|m| m.is_empty())
        || info.get("tokens").is_some_and(|v| !v.is_object())
    {
        info.remove("tokens");
    }

    if let Some(time) = info.get_mut("time") {
        prune_message_time(time);
    }
    if info
        .get("time")
        .and_then(|v| v.as_object())
        .is_some_and(|m| m.is_empty())
        || info.get("time").is_some_and(|v| !v.is_object())
    {
        info.remove("time");
    }

    if let Some(model) = info.get_mut("model") {
        if let Some(model_obj) = model.as_object_mut() {
            retain_only_keys(model_obj, &["providerID", "modelID"]);
            if model_obj.is_empty() {
                info.remove("model");
            }
        } else if !model.is_string() {
            info.remove("model");
        }
    }

    if info.get("provider").is_some_and(|v| !v.is_string()) {
        info.remove("provider");
    }

    if info.get("variant").is_some_and(|v| !v.is_string()) {
        info.remove("variant");
    }

    if let Some(error) = info.get_mut("error")
        && !prune_message_error_value(error)
    {
        info.remove("error");
    }
}

pub(crate) fn filter_message_payload(
    payload: &mut serde_json::Value,
    filter: &ActivityFilter,
    detail: &ActivityDetailPolicy,
) {
    let Some(list) = payload.as_array_mut() else {
        return;
    };

    for entry in list.iter_mut() {
        let Some(obj) = entry.as_object_mut() else {
            continue;
        };

        if let Some(info) = obj.get_mut("info").and_then(|v| v.as_object_mut()) {
            prune_message_info(info);
        }

        let Some(parts) = obj.get_mut("parts").and_then(|v| v.as_array_mut()) else {
            continue;
        };

        parts.retain(|part| {
            let part_type = normalize_part_type(part);
            should_keep_part(part, &part_type, filter)
        });

        for part in parts.iter_mut() {
            prune_part_transport_fields(part);
            let part_type = normalize_part_type(part);
            let include_detail = should_include_detail_for_part(part, &part_type, detail);

            if is_tool_part(&part_type) {
                prune_tool_metadata(part);
                if !include_detail {
                    if let Some(obj) = part.as_object_mut() {
                        let tool_id = obj
                            .get("tool")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_ascii_lowercase();
                        if let Some(state) = obj.get_mut("state").and_then(|v| v.as_object_mut()) {
                            prune_tool_state_for_collapsed_summary(&tool_id, state);
                        }
                    }
                    mark_part_lazy(part, false);
                }
                continue;
            }

            prune_part_metadata(part, &part_type);
            if part_type == "patch"
                && let Some(obj) = part.as_object_mut()
            {
                obj.remove("hash");
            }

            if include_detail {
                continue;
            }

            let mut truncated = false;
            if let Some(obj) = part.as_object_mut() {
                if part_type == "patch" {
                    let file_count = obj
                        .get("files")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    obj.insert(
                        "fileCount".to_string(),
                        serde_json::Value::Number(serde_json::Number::from(file_count as u64)),
                    );
                    obj.remove("files");
                }

                if (part_type == "snapshot" || part_type == "step-start")
                    && let Some(s) = obj.get("snapshot").and_then(|v| v.as_str())
                {
                    let (tr, did) = truncate_chars(s, 256);
                    if did {
                        truncated = true;
                        obj.insert("snapshot".to_string(), serde_json::Value::String(tr));
                    }
                }

                if is_reasoning_part_type(&part_type) || part_type == "justification" {
                    if let Some(s) = obj.get("text").and_then(|v| v.as_str()) {
                        let (tr, did) = truncate_chars(s, 512);
                        if did {
                            truncated = true;
                            obj.insert("text".to_string(), serde_json::Value::String(tr));
                        }
                    }
                    if let Some(s) = obj.get("content").and_then(|v| v.as_str()) {
                        let (tr, did) = truncate_chars(s, 512);
                        if did {
                            truncated = true;
                            obj.insert("content".to_string(), serde_json::Value::String(tr));
                        }
                    }
                }
            }

            mark_part_lazy(part, truncated);
        }
    }
}

pub(crate) async fn session_status_get(
    State(state): State<Arc<crate::AppState>>,
    uri: Uri,
    Query(q): Query<AttentionListQuery>,
) -> ApiResult<Response> {
    fn local_status_snapshot(
        state: &crate::AppState,
        query_session_id: Option<&str>,
        query_directory: Option<&str>,
    ) -> serde_json::Value {
        let mut payload = state.directory_session_index.runtime_snapshot_json();
        let Some(map) = payload.as_object_mut() else {
            return serde_json::Value::Object(serde_json::Map::new());
        };

        let query_directory_norm =
            query_directory.and_then(crate::path_utils::normalize_directory_for_match);

        let keys = map.keys().cloned().collect::<Vec<_>>();
        for sid in keys {
            if let Some(filter_sid) = query_session_id
                && sid != filter_sid
            {
                map.remove(&sid);
                continue;
            }

            if let Some(filter_dir) = query_directory_norm.as_deref() {
                let matches = state
                    .directory_session_index
                    .directory_for_session(&sid)
                    .and_then(|d| crate::path_utils::normalize_directory_for_match(&d))
                    .is_some_and(|dir| dir == filter_dir);
                if !matches {
                    map.remove(&sid);
                    continue;
                }
            }

            if let Some(entry) = map.get_mut(&sid) {
                let status_type = entry
                    .get("statusType")
                    .and_then(|v| v.as_str())
                    .or_else(|| entry.get("type").and_then(|v| v.as_str()))
                    .unwrap_or("idle")
                    .to_string();
                *entry = serde_json::json!({ "type": status_type });
            }
        }

        payload
    }

    let query_directory = directory_from_uri_query(&uri);
    let filter_session_id = normalize_session_id(&q.session_id);
    let local_preferred = query_bool(&uri, "local") || query_bool(&uri, "preferLocal");

    if local_preferred {
        let mut payload = local_status_snapshot(
            state.as_ref(),
            filter_session_id.as_deref(),
            query_directory.as_deref(),
        );
        prune_session_status_payload(&mut payload);
        let body = serde_json::to_vec(&payload)
            .map_err(|_| AppError::bad_gateway("Failed to encode local status response"))?;
        let mut out = Response::new(axum::body::Body::from(body));
        *out.status_mut() = StatusCode::OK;
        out.headers_mut().insert(
            axum::http::header::CONTENT_TYPE,
            "application/json".parse().unwrap(),
        );
        return Ok(out);
    }

    let oc = state.opencode.status().await;
    if oc.restarting || !oc.ready {
        let mut payload = local_status_snapshot(
            state.as_ref(),
            filter_session_id.as_deref(),
            query_directory.as_deref(),
        );
        prune_session_status_payload(&mut payload);
        let body = serde_json::to_vec(&payload)
            .map_err(|_| AppError::bad_gateway("Failed to encode local status response"))?;
        let mut out = Response::new(axum::body::Body::from(body));
        *out.status_mut() = StatusCode::OK;
        out.headers_mut().insert(
            axum::http::header::CONTENT_TYPE,
            "application/json".parse().unwrap(),
        );
        out.headers_mut().insert(
            axum::http::HeaderName::from_static("x-opencode-studio-source"),
            "local-cache".parse().unwrap(),
        );
        return Ok(out);
    }
    let Some(bridge) = state.opencode.bridge().await else {
        return Ok(open_code_unavailable());
    };

    let target = match bridge.build_url("/session/status", Some(&uri)) {
        Ok(url) => url,
        Err(_) => return Ok(open_code_unavailable()),
    };

    let resp = bridge.client.get(target).send().await;
    let resp = match resp {
        Ok(resp) => resp,
        Err(_) => {
            let mut payload = local_status_snapshot(
                state.as_ref(),
                filter_session_id.as_deref(),
                query_directory.as_deref(),
            );
            prune_session_status_payload(&mut payload);
            let body = serde_json::to_vec(&payload)
                .map_err(|_| AppError::bad_gateway("Failed to encode local status response"))?;
            let mut out = Response::new(axum::body::Body::from(body));
            *out.status_mut() = StatusCode::OK;
            out.headers_mut().insert(
                axum::http::header::CONTENT_TYPE,
                "application/json".parse().unwrap(),
            );
            out.headers_mut().insert(
                axum::http::HeaderName::from_static("x-opencode-studio-source"),
                "local-cache".parse().unwrap(),
            );
            return Ok(out);
        }
    };

    let resp_status = resp.status();
    let status = StatusCode::from_u16(resp_status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let bytes = resp
        .bytes()
        .await
        .map_err(|_| AppError::bad_gateway("Failed to read OpenCode response"))?;

    if !resp_status.is_success() {
        return Ok(Response::builder()
            .status(status)
            .body(axum::body::Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response()));
    }

    let mut payload: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => {
            return Ok(Response::builder()
                .status(status)
                .body(axum::body::Body::from(bytes))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response()));
        }
    };

    state
        .directory_session_index
        .merge_runtime_status_map(&payload);

    if let Some(session_id) = filter_session_id
        && let Some(obj) = payload.as_object()
    {
        let mut filtered = serde_json::Map::new();
        if let Some(value) = obj.get(&session_id) {
            filtered.insert(session_id, value.clone());
        }
        payload = serde_json::Value::Object(filtered);
    }

    prune_session_status_payload(&mut payload);

    let body = serde_json::to_vec(&payload)
        .map_err(|_| AppError::bad_gateway("Failed to encode OpenCode response"))?;
    let mut out = Response::new(axum::body::Body::from(body));
    *out.status_mut() = status;
    out.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    Ok(out)
}

fn filter_attention_list(
    payload: &serde_json::Value,
    query: &AttentionListQuery,
) -> Vec<serde_json::Value> {
    let list = payload.as_array().cloned().unwrap_or_default();
    let mut filtered: Vec<serde_json::Value> = list;

    if let Some(session_id) = normalize_session_id(&query.session_id) {
        filtered.retain(|value| {
            value
                .get("sessionID")
                .and_then(|v| v.as_str())
                .is_some_and(|v| v == session_id)
        });
    }

    let offset = parse_usize_param(query.offset.clone()).unwrap_or(0);
    if offset > 0 {
        if offset >= filtered.len() {
            return Vec::new();
        }
        filtered = filtered.into_iter().skip(offset).collect();
    }

    if let Some(limit) = parse_usize_param(query.limit.clone()) {
        filtered.truncate(limit);
    }

    filtered
}

pub(crate) async fn permission_list(
    State(state): State<Arc<crate::AppState>>,
    uri: Uri,
    Query(q): Query<AttentionListQuery>,
) -> ApiResult<Response> {
    let oc = state.opencode.status().await;
    if oc.restarting || !oc.ready {
        return Ok(open_code_restarting());
    }
    let Some(bridge) = state.opencode.bridge().await else {
        return Ok(open_code_unavailable());
    };

    let target = match bridge.build_url("/permission", Some(&uri)) {
        Ok(url) => url,
        Err(_) => return Ok(open_code_unavailable()),
    };

    let resp = bridge
        .client
        .get(target)
        .send()
        .await
        .map_err(|_| AppError::bad_gateway("OpenCode request failed"))?;

    let resp_status = resp.status();
    let status = StatusCode::from_u16(resp_status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let bytes = resp
        .bytes()
        .await
        .map_err(|_| AppError::bad_gateway("Failed to read OpenCode response"))?;

    if !resp_status.is_success() {
        return Ok(Response::builder()
            .status(status)
            .body(axum::body::Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response()));
    }

    let payload: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => {
            return Ok(Response::builder()
                .status(status)
                .body(axum::body::Body::from(bytes))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response()));
        }
    };

    let filtered = filter_attention_list(&payload, &q);
    let mut filtered_value = serde_json::Value::Array(filtered);
    prune_permission_payload(&mut filtered_value);

    let body = serde_json::to_vec(&filtered_value)
        .map_err(|_| AppError::bad_gateway("Failed to encode OpenCode response"))?;
    let mut out = Response::new(axum::body::Body::from(body));
    *out.status_mut() = status;
    out.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    Ok(out)
}

pub(crate) async fn question_list(
    State(state): State<Arc<crate::AppState>>,
    uri: Uri,
    Query(q): Query<AttentionListQuery>,
) -> ApiResult<Response> {
    let oc = state.opencode.status().await;
    if oc.restarting || !oc.ready {
        return Ok(open_code_restarting());
    }
    let Some(bridge) = state.opencode.bridge().await else {
        return Ok(open_code_unavailable());
    };

    let target = match bridge.build_url("/question", Some(&uri)) {
        Ok(url) => url,
        Err(_) => return Ok(open_code_unavailable()),
    };

    let resp = bridge
        .client
        .get(target)
        .send()
        .await
        .map_err(|_| AppError::bad_gateway("OpenCode request failed"))?;

    let resp_status = resp.status();
    let status = StatusCode::from_u16(resp_status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let bytes = resp
        .bytes()
        .await
        .map_err(|_| AppError::bad_gateway("Failed to read OpenCode response"))?;

    if !resp_status.is_success() {
        return Ok(Response::builder()
            .status(status)
            .body(axum::body::Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response()));
    }

    let payload: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => {
            return Ok(Response::builder()
                .status(status)
                .body(axum::body::Body::from(bytes))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response()));
        }
    };

    let filtered = filter_attention_list(&payload, &q);
    let mut filtered_value = serde_json::Value::Array(filtered);
    prune_question_payload(&mut filtered_value);

    let body = serde_json::to_vec(&filtered_value)
        .map_err(|_| AppError::bad_gateway("Failed to encode OpenCode response"))?;
    let mut out = Response::new(axum::body::Body::from(body));
    *out.status_mut() = status;
    out.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionLocateQuery {
    session_id: String,
    #[serde(default)]
    include_worktrees: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionLocateResponse {
    session_id: String,
    project_id: String,
    project_path: String,
    directory: String,
    session: serde_json::Value,
}

async fn list_git_worktrees_best_effort(root: &str) -> Vec<String> {
    let dir = root.trim();
    if dir.is_empty() {
        return Vec::new();
    }

    let mut cmd = tokio::process::Command::new("git");
    cmd.args(["worktree", "list", "--porcelain"])
        .current_dir(dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = match tokio::time::timeout(Duration::from_secs(4), cmd.output()).await {
        Ok(Ok(out)) => out,
        _ => return Vec::new(),
    };
    if !output.status.success() {
        return Vec::new();
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut out = Vec::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            let p = rest.trim();
            if !p.is_empty() {
                out.push(p.to_string());
            }
        }
    }
    out
}

pub(crate) async fn opencode_studio_session_locate(
    State(state): State<Arc<crate::AppState>>,
    Query(q): Query<SessionLocateQuery>,
) -> ApiResult<Response> {
    let session_id = q.session_id.trim().to_string();
    if session_id.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "sessionId is required"})),
        )
            .into_response());
    }

    let bridge = state
        .opencode
        .bridge()
        .await
        .ok_or_else(|| AppError::bad_gateway("OpenCode unavailable"))?;

    let include_worktrees = q.include_worktrees.unwrap_or(true);
    let settings = state.settings.read().await.clone();

    if let Some(indexed_directory) = state
        .directory_session_index
        .directory_for_session(&session_id)
    {
        let url = format!(
            "{}/session/{}?directory={}",
            bridge.base_url.trim_end_matches('/'),
            urlencoding::encode(&session_id),
            urlencoding::encode(&indexed_directory)
        );

        if let Ok(resp) = bridge.client.get(url).send().await
            && resp.status().is_success()
            && let Ok(session) = resp.json::<serde_json::Value>().await
        {
            let directory = session
                .get("directory")
                .and_then(|v| v.as_str())
                .unwrap_or(indexed_directory.as_str())
                .trim()
                .to_string();

            let norm = |p: &str| {
                p.trim()
                    .replace('\\', "/")
                    .trim_end_matches('/')
                    .to_string()
            };
            let directory_norm = norm(&directory);

            let matched = settings.projects.iter().find(|p| {
                let root = p.path.trim();
                if root.is_empty() {
                    return false;
                }
                let root_norm = norm(root);
                directory_norm == root_norm
                    || directory_norm
                        .strip_prefix(&(root_norm.clone() + "/"))
                        .is_some()
            });

            let (project_id, project_path) = if let Some(p) = matched {
                (p.id.trim().to_string(), p.path.trim().to_string())
            } else {
                ("global".to_string(), indexed_directory.clone())
            };

            let out = SessionLocateResponse {
                session_id: session_id.clone(),
                project_id,
                project_path,
                directory,
                session,
            };
            return Ok(Json(out).into_response());
        }
    }

    for proj in settings.projects.iter() {
        let project_id = proj.id.trim();
        let project_path = proj.path.trim();
        if project_id.is_empty() || project_path.is_empty() {
            continue;
        }

        let mut dirs: Vec<String> = vec![project_path.to_string()];
        if include_worktrees {
            for wt in list_git_worktrees_best_effort(project_path).await {
                if wt != project_path {
                    dirs.push(wt);
                }
            }
        }

        // Try the project root and each worktree until we find the session.
        for dir in dirs {
            let url = format!(
                "{}/session/{}?directory={}",
                bridge.base_url.trim_end_matches('/'),
                urlencoding::encode(&session_id),
                urlencoding::encode(&dir)
            );
            let resp = match bridge.client.get(url).send().await {
                Ok(r) => r,
                Err(_) => continue,
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND
                || resp.status() == reqwest::StatusCode::BAD_REQUEST
            {
                continue;
            }

            if !resp.status().is_success() {
                continue;
            }

            let session: serde_json::Value = match resp.json().await {
                Ok(v) => v,
                Err(_) => continue,
            };
            let directory = session
                .get("directory")
                .and_then(|v| v.as_str())
                .unwrap_or(&dir)
                .trim()
                .to_string();

            let out = SessionLocateResponse {
                session_id: session_id.clone(),
                project_id: project_id.to_string(),
                project_path: project_path.to_string(),
                directory,
                session,
            };
            return Ok(Json(out).into_response());
        }
    }

    Ok((
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error": "session not found"})),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prompt_async_url_rewrite_preserves_query() {
        let input = "http://127.0.0.1:3030/session/s_123/message?directory=%2Ftmp%2Fproj&x=1";
        let out = rewrite_opencode_prompt_async_url(input).expect("rewritten");
        assert_eq!(
            out,
            "http://127.0.0.1:3030/session/s_123/prompt_async?directory=%2Ftmp%2Fproj&x=1"
        );
    }

    #[test]
    fn prompt_async_url_rewrite_ignores_non_message_paths() {
        let input = "http://127.0.0.1:3030/session/s_123/status";
        assert!(rewrite_opencode_prompt_async_url(input).is_none());
    }

    #[test]
    fn extract_session_id_from_delete_path_matches_only_session_resource() {
        assert_eq!(
            extract_session_id_from_delete_path("session/ses_123").as_deref(),
            Some("ses_123")
        );
        assert_eq!(
            extract_session_id_from_delete_path("/session/ses_abc%2Fdef/").as_deref(),
            Some("ses_abc/def")
        );

        assert!(extract_session_id_from_delete_path("session/status").is_none());
        assert!(extract_session_id_from_delete_path("session/ses_123/share").is_none());
        assert!(extract_session_id_from_delete_path("permission/ses_123").is_none());
    }

    #[test]
    fn should_sanitize_chat_session_response_skips_session_diff() {
        assert!(should_sanitize_chat_session_response("session"));
        assert!(should_sanitize_chat_session_response("session/ses_123"));
        assert!(!should_sanitize_chat_session_response(
            "session/ses_123/message"
        ));
        assert!(!should_sanitize_chat_session_response(
            "session/ses_123/diff"
        ));
        assert!(!should_sanitize_chat_session_response(
            "/session/ses_123/diff/"
        ));
    }

    #[test]
    fn sanitize_session_deleted_event_accepts_legacy_id_fields() {
        let mut props = serde_json::Map::new();
        props.insert("id".to_string(), json!("ses_from_id"));
        assert!(sanitize_session_deleted_event_properties(&mut props));
        assert_eq!(
            props.get("sessionID").and_then(|v| v.as_str()),
            Some("ses_from_id")
        );

        let mut nested = serde_json::Map::new();
        nested.insert("session".to_string(), json!({ "id": "ses_nested" }));
        assert!(sanitize_session_deleted_event_properties(&mut nested));
        assert_eq!(
            nested.get("sessionID").and_then(|v| v.as_str()),
            Some("ses_nested")
        );
    }

    #[test]
    fn directory_from_uri_query_parses_directory_value() {
        let uri: Uri = "/api/session?directory=%2Ftmp%2Fproj&x=1"
            .parse()
            .expect("uri");
        assert_eq!(directory_from_uri_query(&uri).as_deref(), Some("/tmp/proj"));

        let uri: Uri = "/api/session?x=1".parse().expect("uri");
        assert!(directory_from_uri_query(&uri).is_none());
    }

    #[test]
    fn filter_message_payload_drops_non_renderable_parts() {
        let mut payload = json!([
            {
                "info": {
                    "id": "msg_1",
                    "sessionID": "ses_1",
                    "role": "assistant",
                    "summary": {"x": 1},
                    "time": {"created": 1, "completed": 2, "updated": 3},
                    "tokens": {
                        "input": 1,
                        "output": 2,
                        "reasoning": 3,
                        "cache_read": 4,
                        "cacheWrite": 5,
                        "unused": 99
                    }
                },
                "parts": [
                    {"id": "p_text_ok", "type": "text", "text": "hello"},
                    {"id": "p_text_synth", "type": "text", "text": "ignore me", "synthetic": true},
                    {"id": "p_reasoning_empty", "type": "reasoning", "text": ""},
                    {"id": "p_reasoning_ok", "type": "reasoning", "text": "thinking..."},
                    {"id": "p_step", "type": "step-start", "snapshot": "s"}
                ]
            }
        ]);

        let filter = ActivityFilter {
            allowed: ["tool"].into_iter().map(String::from).collect(),
            tool_allowed: ["read"].into_iter().map(String::from).collect(),
            tool_explicit: true,
            show_reasoning: true,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: false,
            expanded: HashSet::new(),
            expanded_tools: HashSet::new(),
        };
        filter_message_payload(&mut payload, &filter, &detail);

        let entry = payload
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_object())
            .expect("entry");
        let info = entry.get("info").and_then(|v| v.as_object()).expect("info");
        assert!(!info.contains_key("summary"));
        assert!(!info.contains_key("sessionID"));
        assert_eq!(
            info.get("time")
                .and_then(|v| v.as_object())
                .and_then(|t| t.get("completed")),
            Some(&json!(2))
        );
        assert_eq!(
            info.get("time")
                .and_then(|v| v.as_object())
                .and_then(|t| t.get("updated")),
            None
        );
        assert_eq!(
            info.get("tokens")
                .and_then(|v| v.get("cache"))
                .and_then(|v| v.get("read")),
            Some(&json!(4))
        );
        assert_eq!(
            info.get("tokens")
                .and_then(|v| v.get("cache"))
                .and_then(|v| v.get("write")),
            Some(&json!(5))
        );
        assert_eq!(info.get("tokens").and_then(|v| v.get("cache_read")), None);

        let parts = entry
            .get("parts")
            .and_then(|v| v.as_array())
            .expect("parts");
        let part_ids: Vec<&str> = parts
            .iter()
            .filter_map(|p| p.get("id").and_then(|v| v.as_str()))
            .collect();
        assert_eq!(part_ids, vec!["p_text_ok", "p_reasoning_ok"]);

        let kept_text = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_text_ok"))
            .expect("kept text");
        let kept_reasoning = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_reasoning_ok"))
            .expect("kept reasoning");
        assert!(kept_text.get("metadata").is_none());
        assert!(kept_reasoning.get("metadata").is_none());
    }

    #[test]
    fn filter_message_payload_prunes_tool_metadata_and_transport_ids() {
        let mut payload = json!([
            {
                "info": {"id": "msg_2", "role": "assistant"},
                "parts": [
                    {
                        "id": "p_read",
                        "type": "tool",
                        "tool": "read",
                        "callID": "call_1",
                        "sessionID": "ses_1",
                        "messageID": "msg_2",
                        "metadata": {"preview": "x"},
                        "state": {
                            "status": "completed",
                            "input": {
                                "filePath": "/tmp/readme.md",
                                "offset": 1,
                                "limit": 2
                            },
                            "metadata": {"preview": "x", "truncated": true},
                            "output": "file body"
                        }
                    },
                    {
                        "id": "p_patch",
                        "type": "tool",
                        "tool": "apply_patch",
                        "sessionID": "ses_1",
                        "messageID": "msg_2",
                        "state": {
                            "status": "completed",
                            "input": {"patch": "*** Begin Patch\n*** End Patch"},
                            "metadata": {
                                "diff": "@@ -1 +1 @@\n-a\n+b",
                                "diagnostics": {"warning": 1},
                                "files": [
                                    {
                                        "path": "a.txt",
                                        "filePath": "/tmp/a.txt",
                                        "relativePath": "tmp/a.txt",
                                        "type": "update",
                                        "before": "a",
                                        "after": "b",
                                        "diff": "@@ -1 +1 @@",
                                        "additions": 1,
                                        "deletions": 1,
                                        "noise": true
                                    }
                                ],
                                "truncated": false
                            }
                        }
                    },
                    {
                        "id": "p_patch_files_only",
                        "type": "tool",
                        "tool": "apply_patch",
                        "state": {
                            "status": "completed",
                            "input": {"patch": "*** Begin Patch\n*** End Patch"},
                            "metadata": {
                                "files": [
                                    {
                                        "path": "b.txt",
                                        "filePath": "/tmp/b.txt",
                                        "relativePath": "tmp/b.txt",
                                        "type": "update",
                                        "before": "x",
                                        "after": "y",
                                        "diff": "@@ -1 +1 @@",
                                        "additions": 1,
                                        "deletions": 1,
                                        "noise": true
                                    }
                                ],
                                "truncated": false
                            }
                        }
                    },
                    {
                        "id": "p_replace",
                        "type": "tool",
                        "tool": "str_replace",
                        "state": {
                            "status": "completed",
                            "input": {"path": "a.txt", "old": "a", "new": "b"},
                            "metadata": {"diff": "@@ -1 +1 @@\n-a\n+b"}
                        }
                    },
                    {
                        "id": "p_edit",
                        "type": "tool",
                        "tool": "edit",
                        "state": {
                            "status": "completed",
                            "input": {"filePath": "/tmp/a.txt", "oldString": "a", "newString": "b"},
                            "metadata": {"diff": "@@ -1 +1 @@\n-a\n+b"}
                        }
                    },
                    {
                        "id": "p_patch_meta",
                        "type": "patch",
                        "hash": "deadbeef",
                        "files": ["a.txt"]
                    }
                ]
            }
        ]);

        let filter = ActivityFilter {
            allowed: ["tool", "patch"].into_iter().map(String::from).collect(),
            tool_allowed: ["read", "apply_patch", "str_replace", "edit"]
                .into_iter()
                .map(String::from)
                .collect(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: false,
            expanded: HashSet::new(),
            expanded_tools: HashSet::new(),
        };
        filter_message_payload(&mut payload, &filter, &detail);

        let parts = payload[0]["parts"].as_array().expect("parts");

        let read_part = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_read"))
            .expect("read part");
        assert!(read_part.get("sessionID").is_none());
        assert!(read_part.get("messageID").is_none());
        assert!(read_part.get("callID").is_none());
        assert!(read_part.get("metadata").is_none());
        assert!(read_part["state"].get("metadata").is_none());
        assert_eq!(
            read_part["state"]["input"]
                .as_object()
                .and_then(|v| v.get("filePath")),
            Some(&json!("/tmp/readme.md"))
        );
        assert!(
            read_part["state"]["input"]
                .as_object()
                .and_then(|v| v.get("offset"))
                .is_none()
        );

        let patch_part = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_patch"))
            .expect("patch part");
        assert!(patch_part.get("sessionID").is_none());
        assert!(patch_part.get("messageID").is_none());
        assert!(patch_part.get("metadata").is_none());
        assert!(patch_part["state"].get("input").is_none());

        let patch_meta = patch_part["state"]["metadata"]
            .as_object()
            .expect("patch metadata");
        assert!(patch_meta.contains_key("diff"));
        assert!(patch_meta.contains_key("files"));
        assert!(patch_meta.contains_key("truncated"));
        assert!(!patch_meta.contains_key("diagnostics"));

        let patch_files = patch_meta
            .get("files")
            .and_then(|v| v.as_array())
            .expect("patch files");
        let patch_first_file = patch_files
            .first()
            .and_then(|v| v.as_object())
            .expect("patch first file");
        assert!(patch_first_file.contains_key("path"));
        assert!(patch_first_file.contains_key("filePath"));
        assert!(patch_first_file.contains_key("relativePath"));
        assert!(patch_first_file.contains_key("type"));
        assert!(patch_first_file.contains_key("diff"));
        assert!(patch_first_file.contains_key("before"));
        assert!(patch_first_file.contains_key("after"));
        assert!(patch_first_file.contains_key("additions"));
        assert!(patch_first_file.contains_key("deletions"));
        assert!(!patch_first_file.contains_key("noise"));

        let files_only_part = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_patch_files_only"))
            .expect("patch files only part");
        let files_only_meta = files_only_part["state"]["metadata"]
            .as_object()
            .expect("files-only metadata");
        assert!(files_only_part["state"].get("input").is_none());
        let files = files_only_meta
            .get("files")
            .and_then(|v| v.as_array())
            .expect("files");
        let first_file = files
            .first()
            .and_then(|v| v.as_object())
            .expect("first file");
        assert!(first_file.contains_key("path"));
        assert!(first_file.contains_key("filePath"));
        assert!(first_file.contains_key("relativePath"));
        assert!(first_file.contains_key("type"));
        assert!(first_file.contains_key("diff"));
        assert!(first_file.contains_key("before"));
        assert!(first_file.contains_key("after"));
        assert!(first_file.contains_key("additions"));
        assert!(first_file.contains_key("deletions"));
        assert!(!first_file.contains_key("noise"));

        let patch_meta_part = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_patch_meta"))
            .expect("patch meta part");
        assert!(patch_meta_part.get("hash").is_none());

        let replace_part = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_replace"))
            .expect("replace part");
        assert!(replace_part["state"].get("input").is_none());

        let edit_part = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_edit"))
            .expect("edit part");
        assert!(edit_part["state"].get("input").is_some());
        assert_eq!(
            edit_part["state"]["input"]
                .as_object()
                .and_then(|v| v.get("filePath")),
            Some(&json!("/tmp/a.txt"))
        );
        assert!(
            edit_part["state"]["input"]
                .as_object()
                .and_then(|v| v.get("oldString"))
                .is_none()
        );
    }

    #[test]
    fn activity_detail_policy_parses_default_expanded_tool_filters() {
        let mut settings = crate::settings::Settings::default();
        settings
            .extra
            .insert("chatActivityLazyLoadDetails".to_string(), json!(false));
        settings
            .extra
            .insert("chatActivityDefaultExpanded".to_string(), json!(["patch"]));
        settings.extra.insert(
            "chatActivityDefaultExpandedToolFilters".to_string(),
            json!(["read", "bash", "unknown_tool"]),
        );

        let detail = activity_detail_policy_from_settings(&settings);
        assert!(detail.enabled);
        assert!(detail.expanded.contains("patch"));
        assert!(!detail.expanded.contains("tool"));
        assert!(detail.expanded_tools.contains("read"));
        assert!(detail.expanded_tools.contains("bash"));
        assert!(detail.expanded_tools.contains("unknown_tool"));
    }

    #[test]
    fn filter_message_payload_lazy_loads_tool_detail_per_tool_setting() {
        let mut payload = json!([
            {
                "info": {"id": "msg_3", "role": "assistant"},
                "parts": [
                    {
                        "id": "p_read",
                        "type": "tool",
                        "tool": "read",
                        "state": {
                            "status": "completed",
                            "input": {"filePath": "/tmp/readme.md"},
                            "output": "read output"
                        }
                    },
                    {
                        "id": "p_bash",
                        "type": "tool",
                        "tool": "bash",
                        "state": {
                            "status": "completed",
                            "input": {"command": "pwd"},
                            "output": "bash output"
                        }
                    }
                ]
            }
        ]);

        let filter = ActivityFilter {
            allowed: ["tool"].into_iter().map(String::from).collect(),
            tool_allowed: ["read", "bash"].into_iter().map(String::from).collect(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: true,
            expanded: HashSet::new(),
            expanded_tools: ["read"].into_iter().map(String::from).collect(),
        };

        filter_message_payload(&mut payload, &filter, &detail);

        let parts = payload[0]["parts"].as_array().expect("parts");
        let read_part = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_read"))
            .expect("read part");
        let bash_part = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_bash"))
            .expect("bash part");

        assert_eq!(read_part.get("ocLazy"), None);
        assert_eq!(
            read_part
                .get("state")
                .and_then(|v| v.get("output"))
                .and_then(|v| v.as_str()),
            Some("read output")
        );

        assert_eq!(bash_part.get("ocLazy"), Some(&json!(true)));
        assert!(
            bash_part
                .get("state")
                .and_then(|v| v.get("output"))
                .is_none()
        );
        assert_eq!(
            bash_part
                .get("state")
                .and_then(|v| v.get("input"))
                .and_then(|v| v.get("command"))
                .and_then(|v| v.as_str()),
            Some("pwd")
        );
    }

    #[test]
    fn filter_message_payload_expands_unknown_tools_when_unknown_expand_enabled() {
        let mut payload = json!([
            {
                "info": {"id": "msg_unknown", "role": "assistant"},
                "parts": [
                    {
                        "id": "p_custom",
                        "type": "tool",
                        "tool": "my_plugin_tool",
                        "state": {
                            "status": "completed",
                            "input": {"argv": ["plan", "list", "--status", "todo"]},
                            "output": "custom output"
                        }
                    },
                    {
                        "id": "p_bash",
                        "type": "tool",
                        "tool": "bash",
                        "state": {
                            "status": "completed",
                            "input": {"command": "pwd"},
                            "output": "bash output"
                        }
                    }
                ]
            }
        ]);

        let filter = ActivityFilter {
            allowed: ["tool"].into_iter().map(String::from).collect(),
            tool_allowed: ["bash", "unknown"].into_iter().map(String::from).collect(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: true,
            expanded: HashSet::new(),
            expanded_tools: ["unknown"].into_iter().map(String::from).collect(),
        };

        filter_message_payload(&mut payload, &filter, &detail);

        let parts = payload[0]["parts"].as_array().expect("parts");
        let custom_part = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_custom"))
            .expect("custom part");
        let bash_part = parts
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some("p_bash"))
            .expect("bash part");

        assert_eq!(custom_part.get("ocLazy"), None);
        assert_eq!(
            custom_part
                .get("state")
                .and_then(|v| v.get("output"))
                .and_then(|v| v.as_str()),
            Some("custom output")
        );
        let custom_argv = custom_part
            .get("state")
            .and_then(|v| v.get("input"))
            .and_then(|v| v.get("argv"))
            .and_then(|v| v.as_array())
            .expect("custom argv");
        assert_eq!(custom_argv.first(), Some(&json!("plan")));

        assert_eq!(bash_part.get("ocLazy"), Some(&json!(true)));
    }

    #[test]
    fn filter_message_payload_keeps_unknown_tools_when_unknown_filter_enabled() {
        let mut payload = json!([
            {
                "info": {"id": "msg_custom", "role": "assistant"},
                "parts": [
                    {
                        "id": "p_custom",
                        "type": "tool",
                        "tool": "my_plugin_tool",
                        "state": {
                            "status": "completed",
                            "input": {"argv": ["plan", "add-tree", "Fix plugin activity summary", "content"]}
                        }
                    },
                    {
                        "id": "p_bash",
                        "type": "tool",
                        "tool": "bash",
                        "state": {
                            "status": "completed",
                            "input": {"command": "pwd"}
                        }
                    }
                ]
            }
        ]);

        let filter = ActivityFilter {
            allowed: ["tool"].into_iter().map(String::from).collect(),
            tool_allowed: ["read", "unknown"].into_iter().map(String::from).collect(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: false,
            expanded: HashSet::new(),
            expanded_tools: HashSet::new(),
        };

        filter_message_payload(&mut payload, &filter, &detail);

        let parts = payload[0]["parts"].as_array().expect("parts");
        let part_ids: Vec<&str> = parts
            .iter()
            .filter_map(|p| p.get("id").and_then(|v| v.as_str()))
            .collect();
        assert_eq!(part_ids, vec!["p_custom"]);
        let custom_part = parts.first().expect("custom part");
        let custom_argv = custom_part
            .get("state")
            .and_then(|v| v.get("input"))
            .and_then(|v| v.get("argv"))
            .and_then(|v| v.as_array())
            .expect("custom argv summary");
        assert_eq!(custom_argv.first(), Some(&json!("plan")));
        assert_eq!(custom_argv.get(1), Some(&json!("add-tree")));
    }

    #[test]
    fn sanitize_sse_tool_part_event_keeps_unknown_tools_when_unknown_filter_enabled() {
        let mut event = json!({
            "type": "message.part.updated",
            "properties": {
                "sessionID": "ses_custom",
                "messageID": "msg_custom",
                "partID": "prt_custom",
                "delta": "",
                "part": {
                    "id": "prt_custom",
                    "type": "tool",
                    "tool": "my_plugin_tool",
                    "state": {
                        "status": "completed",
                        "title": "plugin action"
                    }
                }
            }
        });

        let filter = ActivityFilter {
            allowed: ["tool"].into_iter().map(String::from).collect(),
            tool_allowed: ["unknown"].into_iter().map(String::from).collect(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: false,
            expanded: HashSet::new(),
            expanded_tools: HashSet::new(),
        };

        assert!(sanitize_sse_event_data(&mut event, &filter, &detail));
        let tool = event["properties"]["part"]
            .get("tool")
            .and_then(|v| v.as_str())
            .expect("tool id");
        assert_eq!(tool, "my_plugin_tool");
    }

    #[test]
    fn sanitize_sse_tool_part_event_keeps_only_used_fields() {
        let mut event = json!({
            "type": "message.part.updated",
            "properties": {
                "sessionID": "ses_1",
                "messageID": "msg_1",
                "partID": "prt_1",
                "delta": "",
                "part": {
                    "id": "prt_1",
                    "type": "tool",
                    "tool": "bash",
                    "sessionID": "ses_1",
                    "messageID": "msg_1",
                    "callID": "call_1",
                    "state": {
                        "status": "completed",
                        "title": "run bash",
                        "input": {"command": "ls -la", "cwd": "/tmp"},
                        "metadata": {"preview": true},
                        "output": "done"
                    },
                    "metadata": {"drop": true}
                }
            }
        });

        let filter = ActivityFilter {
            allowed: ["tool"].into_iter().map(String::from).collect(),
            tool_allowed: ["bash"].into_iter().map(String::from).collect(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: false,
            expanded: HashSet::new(),
            expanded_tools: HashSet::new(),
        };

        assert!(sanitize_sse_event_data(&mut event, &filter, &detail));

        let props = event["properties"].as_object().expect("properties");
        assert_eq!(props.get("sessionID"), Some(&json!("ses_1")));
        assert_eq!(props.get("messageID"), Some(&json!("msg_1")));
        assert_eq!(props.get("partID"), Some(&json!("prt_1")));

        let part = props.get("part").and_then(|v| v.as_object()).expect("part");
        assert!(part.get("callID").is_none());
        assert_eq!(part.get("sessionID"), Some(&json!("ses_1")));
        assert_eq!(part.get("messageID"), Some(&json!("msg_1")));

        let state = part
            .get("state")
            .and_then(|v| v.as_object())
            .expect("state");
        assert!(state.get("metadata").is_none());
        assert_eq!(state.get("status"), Some(&json!("completed")));
        assert_eq!(
            state
                .get("input")
                .and_then(|v| v.as_object())
                .and_then(|v| v.get("command")),
            Some(&json!("ls -la"))
        );
        assert!(
            state
                .get("input")
                .and_then(|v| v.as_object())
                .and_then(|v| v.get("cwd"))
                .is_none()
        );
    }

    #[test]
    fn sanitize_sse_reasoning_event_respects_reasoning_toggle() {
        let mut event = json!({
            "type": "message.part.updated",
            "properties": {
                "sessionID": "ses_1",
                "messageID": "msg_1",
                "partID": "prt_2",
                "delta": "thinking",
                "part": {
                    "id": "prt_2",
                    "type": "reasoning",
                    "sessionID": "ses_1",
                    "messageID": "msg_1",
                    "text": ""
                }
            }
        });

        let filter = ActivityFilter {
            allowed: ["tool", "patch", "snapshot", "agent", "retry", "compaction"]
                .into_iter()
                .map(String::from)
                .collect(),
            tool_allowed: ["bash"].into_iter().map(String::from).collect(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: false,
            expanded: HashSet::new(),
            expanded_tools: HashSet::new(),
        };

        assert!(!sanitize_sse_event_data(&mut event, &filter, &detail));
    }

    #[test]
    fn sanitize_sse_session_error_extracts_nested_message_and_classification() {
        let mut event = json!({
            "type": "session.error",
            "properties": {
                "sessionID": "ses_1",
                "classification": "context_overflow",
                "error": {
                    "name": "ContextOverflowError",
                    "data": {
                        "message": "Input exceeds context window of this model",
                        "responseBody": "{\"error\":{\"message\":\"Your input exceeds the context window of this model.\"}}"
                    }
                }
            }
        });

        let filter = ActivityFilter {
            allowed: ["tool", "patch", "snapshot", "agent", "retry", "compaction"]
                .into_iter()
                .map(String::from)
                .collect(),
            tool_allowed: HashSet::new(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: false,
            expanded: HashSet::new(),
            expanded_tools: HashSet::new(),
        };

        assert!(sanitize_sse_event_data(&mut event, &filter, &detail));
        let props = event["properties"].as_object().expect("properties");
        assert_eq!(props.get("sessionID"), Some(&json!("ses_1")));
        assert_eq!(
            props.get("classification"),
            Some(&json!("context_overflow"))
        );

        let error = props
            .get("error")
            .and_then(|v| v.as_object())
            .expect("error object");
        assert_eq!(error.get("name"), Some(&json!("ContextOverflowError")));
        assert_eq!(
            error.get("message"),
            Some(&json!("Input exceeds context window of this model"))
        );
    }

    #[test]
    fn sanitize_sse_session_error_keeps_global_error_without_session_id() {
        let mut event = json!({
            "type": "session.error",
            "properties": {
                "classification": "provider_api",
                "error": {
                    "code": "invalid_prompt",
                    "message": "Invalid prompt from upstream"
                }
            }
        });

        let filter = ActivityFilter {
            allowed: ["tool", "patch", "snapshot", "agent", "retry", "compaction"]
                .into_iter()
                .map(String::from)
                .collect(),
            tool_allowed: HashSet::new(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: false,
            expanded: HashSet::new(),
            expanded_tools: HashSet::new(),
        };

        assert!(sanitize_sse_event_data(&mut event, &filter, &detail));
        let props = event["properties"].as_object().expect("properties");
        assert!(props.get("sessionID").is_none());
        assert_eq!(props.get("classification"), Some(&json!("provider_api")));
        assert_eq!(
            props.get("error").and_then(|v| v.get("code")),
            Some(&json!("invalid_prompt"))
        );
        assert_eq!(
            props.get("error").and_then(|v| v.get("message")),
            Some(&json!("Invalid prompt from upstream"))
        );
    }

    #[test]
    fn sanitize_sse_message_updated_keeps_assistant_error_summary() {
        let mut event = json!({
            "type": "message.updated",
            "properties": {
                "info": {
                    "id": "msg_1",
                    "sessionID": "ses_1",
                    "role": "assistant",
                    "time": {"created": 1, "completed": 2},
                    "error": {
                        "name": "ContextOverflowError",
                        "data": {
                            "message": "Input exceeds context window of this model",
                            "statusCode": 400,
                            "isRetryable": false,
                            "requestID": "req_ctx_1",
                            "metadata": {
                                "request_id": "req_ctx_1",
                                "attempt": 2,
                                "drop": {"nope": true}
                            },
                            "responseBody": "{\"error\":{\"message\":\"Your input exceeds the context window of this model.\"}}",
                            "noise": "drop"
                        },
                        "noise": "drop"
                    },
                    "noise": true
                }
            }
        });

        let filter = ActivityFilter {
            allowed: HashSet::new(),
            tool_allowed: HashSet::new(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: false,
            expanded: HashSet::new(),
            expanded_tools: HashSet::new(),
        };

        assert!(sanitize_sse_event_data(&mut event, &filter, &detail));
        let info = event["properties"]["info"]
            .as_object()
            .expect("message info");
        let error = info
            .get("error")
            .and_then(|v| v.as_object())
            .expect("error object");
        assert_eq!(error.get("name"), Some(&json!("ContextOverflowError")));
        assert_eq!(
            error.get("message"),
            Some(&json!("Input exceeds context window of this model"))
        );
        assert_eq!(error.get("statusCode"), Some(&json!(400)));
        assert_eq!(error.get("isRetryable"), Some(&json!(false)));
        assert_eq!(error.get("requestID"), Some(&json!("req_ctx_1")));
        assert_eq!(
            error.get("data").and_then(|v| v.get("message")),
            Some(&json!("Input exceeds context window of this model"))
        );
        assert_eq!(
            error.get("data").and_then(|v| v.get("statusCode")),
            Some(&json!(400))
        );
        assert_eq!(
            error.get("metadata").and_then(|v| v.get("request_id")),
            Some(&json!("req_ctx_1"))
        );
        assert!(error.get("metadata").and_then(|v| v.get("drop")).is_none());
        assert!(error.get("noise").is_none());
    }

    #[test]
    fn filter_message_payload_keeps_assistant_error_summary() {
        let mut payload = json!([
            {
                "info": {
                    "id": "msg_1",
                    "role": "assistant",
                    "time": {"created": 1, "updated": 2},
                    "error": {
                        "name": "APIError",
                        "data": {
                            "message": "Upstream provider timeout",
                            "code": "upstream_timeout",
                            "statusCode": 504,
                            "isRetryable": true,
                            "providerID": "anthropic",
                            "modelID": "claude-sonnet-4-20250514",
                            "requestID": "req_timeout_1",
                            "metadata": {
                                "request_id": "req_timeout_1",
                                "region": "us-east-1"
                            },
                            "noise": "drop"
                        },
                        "noise": true
                    }
                },
                "parts": []
            }
        ]);

        let filter = ActivityFilter {
            allowed: HashSet::new(),
            tool_allowed: HashSet::new(),
            tool_explicit: true,
            show_reasoning: false,
            show_justification: false,
        };

        let detail = ActivityDetailPolicy {
            enabled: false,
            expanded: HashSet::new(),
            expanded_tools: HashSet::new(),
        };

        filter_message_payload(&mut payload, &filter, &detail);
        let info = payload[0]["info"].as_object().expect("message info");
        let error = info
            .get("error")
            .and_then(|v| v.as_object())
            .expect("error object");
        assert_eq!(error.get("name"), Some(&json!("APIError")));
        assert_eq!(error.get("code"), Some(&json!("upstream_timeout")));
        assert_eq!(
            error.get("message"),
            Some(&json!("Upstream provider timeout"))
        );
        assert_eq!(error.get("statusCode"), Some(&json!(504)));
        assert_eq!(error.get("isRetryable"), Some(&json!(true)));
        assert_eq!(error.get("providerID"), Some(&json!("anthropic")));
        assert_eq!(
            error.get("modelID"),
            Some(&json!("claude-sonnet-4-20250514"))
        );
        assert_eq!(error.get("requestID"), Some(&json!("req_timeout_1")));
        assert_eq!(
            error.get("data").and_then(|v| v.get("message")),
            Some(&json!("Upstream provider timeout"))
        );
        assert_eq!(
            error.get("data").and_then(|v| v.get("metadata")),
            Some(&json!({
                "request_id": "req_timeout_1",
                "region": "us-east-1"
            }))
        );
        assert!(error.get("noise").is_none());
    }

    #[test]
    fn prune_status_and_attention_payloads_keep_required_fields() {
        let mut status_payload = json!({
            "ses_1": {
                "type": "retry",
                "attempt": 2,
                "message": "retrying",
                "next": 123,
                "noise": "drop"
            },
            "ses_2": {
                "type": "busy",
                "noise": true
            },
            "ses_3": {
                "noise": true
            }
        });
        prune_session_status_payload(&mut status_payload);
        assert!(status_payload.get("ses_1").is_some());
        assert!(status_payload.get("ses_2").is_some());
        assert!(status_payload.get("ses_3").is_none());
        assert_eq!(status_payload["ses_1"]["type"], json!("retry"));
        assert!(status_payload["ses_1"].get("noise").is_none());

        let mut permission_payload = json!([
            {
                "id": "perm_1",
                "sessionID": "ses_1",
                "permission": "read",
                "patterns": ["*.rs", 1],
                "always": ["yes", null],
                "noise": true
            },
            {
                "sessionID": "ses_2"
            }
        ]);
        prune_permission_payload(&mut permission_payload);
        let perm_arr = permission_payload.as_array().expect("permission array");
        assert_eq!(perm_arr.len(), 1);
        assert_eq!(perm_arr[0].get("id"), Some(&json!("perm_1")));
        assert!(perm_arr[0].get("noise").is_none());

        let mut question_payload = json!([
            {
                "id": "q_1",
                "sessionID": "ses_1",
                "questions": [
                    {
                        "header": "Header",
                        "question": "Question?",
                        "options": [
                            {"label": "A", "description": "Desc", "noise": 1},
                            {"description": "drop"}
                        ],
                        "multiple": true,
                        "custom": false,
                        "noise": true
                    }
                ],
                "noise": true
            },
            {
                "id": "q_2",
                "sessionID": "ses_2",
                "questions": []
            }
        ]);
        prune_question_payload(&mut question_payload);
        let q_arr = question_payload.as_array().expect("question array");
        assert_eq!(q_arr.len(), 1);
        assert_eq!(q_arr[0].get("id"), Some(&json!("q_1")));
        assert!(q_arr[0].get("noise").is_none());
        assert_eq!(
            q_arr[0]["questions"][0]["options"][0].get("label"),
            Some(&json!("A"))
        );
        assert!(
            q_arr[0]["questions"][0]["options"][0]
                .get("noise")
                .is_none()
        );
    }

    #[test]
    fn sanitize_chat_session_response_payload_prunes_extra_fields() {
        let mut payload = json!({
            "sessions": [
                {
                    "id": "ses_1",
                    "title": "Title",
                    "slug": "slug",
                    "directory": "/tmp/proj",
                    "projectID": "proj_1",
                    "version": 2,
                    "summary": {"files": 1},
                    "time": {"created": 1, "updated": 2, "completed": 3},
                    "share": {"url": "https://example.com", "other": true},
                    "revert": {"messageID": "msg_1", "diff": "diff", "other": true},
                    "parentId": "parent_1"
                }
            ],
            "total": 1,
            "offset": 0,
            "limit": 1
        });

        sanitize_chat_session_response_payload(&mut payload);

        let sessions = payload["sessions"].as_array().expect("sessions");
        assert_eq!(sessions.len(), 1);
        let session = sessions[0].as_object().expect("session");
        assert!(session.get("projectID").is_none());
        assert!(session.get("version").is_none());
        assert!(session.get("summary").is_none());
        assert_eq!(
            session.get("parentID").and_then(|v| v.as_str()),
            Some("parent_1")
        );
        assert_eq!(
            session
                .get("time")
                .and_then(|v| v.get("created"))
                .and_then(|v| v.as_i64()),
            Some(1)
        );
        assert!(
            session
                .get("time")
                .and_then(|v| v.get("completed"))
                .is_none()
        );
        assert_eq!(
            session
                .get("share")
                .and_then(|v| v.get("url"))
                .and_then(|v| v.as_str()),
            Some("https://example.com")
        );
        assert!(session.get("share").and_then(|v| v.get("other")).is_none());
    }

    #[test]
    fn extract_session_id_from_diff_path_accepts_expected_shape() {
        assert_eq!(
            extract_session_id_from_diff_path("session/ses_123/diff").as_deref(),
            Some("ses_123")
        );
        assert_eq!(
            extract_session_id_from_diff_path("/session/ses_abc%2Fdef/diff/").as_deref(),
            Some("ses_abc/def")
        );
        assert!(extract_session_id_from_diff_path("session/ses_123/message").is_none());
        assert!(extract_session_id_from_diff_path("session/status").is_none());
    }

    #[test]
    fn build_session_diff_from_messages_aggregates_full_history_for_pagination() {
        let messages = json!([
            {
                "info": {"id": "msg_old", "sessionID": "ses_1"},
                "parts": [
                    {
                        "id": "part_old",
                        "type": "tool",
                        "state": {
                            "metadata": {
                                "diff": "diff --git a/src/old.ts b/src/old.ts\n--- a/src/old.ts\n+++ b/src/old.ts\n@@ -1 +1,2 @@\n-a\n+b\n+c"
                            }
                        }
                    }
                ]
            },
            {
                "info": {"id": "msg_new", "sessionID": "ses_1"},
                "parts": [
                    {
                        "id": "part_new",
                        "type": "tool",
                        "state": {
                            "metadata": {
                                "files": [
                                    {
                                        "path": "/repo/src/new.ts",
                                        "before": "old\\n",
                                        "after": "new\\n",
                                        "additions": 1,
                                        "deletions": 1
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        ]);

        let computed =
            build_session_diff_from_messages(messages.as_array().expect("messages"), Some("/repo"));

        let files = computed.iter().map(|v| v.file.as_str()).collect::<Vec<_>>();
        assert_eq!(files, vec!["src/new.ts", "src/old.ts"]);
        assert_eq!(computed[1].additions, 2);
        assert_eq!(computed[1].deletions, 1);
        assert!(computed[1].diff.contains("diff --git a/src/old.ts b/src/old.ts"));
    }
}
