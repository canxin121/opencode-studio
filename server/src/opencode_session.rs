use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::SystemTime;

use axum::{
    Json,
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use dashmap::DashMap;
use futures_util::stream::{self as futures_stream, StreamExt as _};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::fs;
use tokio::process::Command;

mod consistency;
mod fallback;
mod sqlite_dao;

use consistency::{DEFAULT_DEGRADED_RETRY_AFTER_MS, ResponseConsistency};
use fallback::{ReadJsonError, ReadJsonOutcome, mark_consistency_read_error, read_json_value};
use sqlite_dao::{
    load_session_message_page_from_sqlite, load_session_message_part_from_sqlite,
    load_session_records_from_sqlite,
};

#[derive(Clone)]
struct SessionRecord {
    id: String,
    parent_id: Option<String>,
    updated: f64,
    value: Value,
}

use crate::ApiResult;
use crate::path_utils::normalize_directory_path;

#[derive(Debug, Deserialize, Default)]
pub(crate) struct SessionListQuery {
    pub directory: Option<String>,
    pub scope: Option<String>,
    pub roots: Option<String>,
    pub start: Option<String>,
    pub search: Option<String>,
    pub offset: Option<String>,
    pub limit: Option<String>,
    #[serde(rename = "includeTotal")]
    pub include_total: Option<String>,
    #[serde(rename = "includeChildren")]
    pub include_children: Option<String>,
    pub ids: Option<String>,
    #[serde(rename = "focusSessionId")]
    pub focus_session_id: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct SessionMessagesQuery {
    pub offset: Option<String>,
    pub limit: Option<String>,
    #[serde(rename = "includeTotal")]
    pub include_total: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionListResponse {
    sessions: Vec<Value>,
    total: usize,
    offset: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<usize>,
    has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_offset: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    focus_root_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    focus_root_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consistency: Option<ResponseConsistency>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionMessageListResponse {
    entries: Vec<Value>,
    total: usize,
    offset: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<usize>,
    has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_offset: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consistency: Option<ResponseConsistency>,
}

const DIR_CACHE_LIMIT: usize = 128;
const FILE_CACHE_LIMIT: usize = 512;
const SESSION_SCAN_CONCURRENCY: usize = 12;

#[derive(Debug, Clone)]
struct DirectoryCacheEntry {
    modified: SystemTime,
    ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct FileCacheEntry {
    modified: SystemTime,
    value: Value,
}

struct OpenCodeStorageCache {
    dir_cache: DashMap<PathBuf, DirectoryCacheEntry>,
    file_cache: DashMap<PathBuf, FileCacheEntry>,
    dir_order: Mutex<VecDeque<PathBuf>>,
    file_order: Mutex<VecDeque<PathBuf>>,
}

impl OpenCodeStorageCache {
    fn new() -> Self {
        Self {
            dir_cache: DashMap::new(),
            file_cache: DashMap::new(),
            dir_order: Mutex::new(VecDeque::new()),
            file_order: Mutex::new(VecDeque::new()),
        }
    }

    fn record_dir(&self, key: PathBuf, entry: DirectoryCacheEntry) {
        self.dir_cache.insert(key.clone(), entry);
        self.touch_dir(key);
    }

    fn record_file(&self, key: PathBuf, entry: FileCacheEntry) {
        self.file_cache.insert(key.clone(), entry);
        self.touch_file(key);
    }

    fn clear(&self) {
        self.dir_cache.clear();
        self.file_cache.clear();

        self.dir_order.lock().unwrap().clear();
        self.file_order.lock().unwrap().clear();
    }

    fn touch_dir(&self, key: PathBuf) {
        let mut order = self.dir_order.lock().unwrap();
        if let Some(pos) = order.iter().position(|v| v == &key) {
            order.remove(pos);
        }
        order.push_back(key.clone());
        if order.len() > DIR_CACHE_LIMIT
            && let Some(evicted) = order.pop_front()
        {
            self.dir_cache.remove(&evicted);
        }
    }

    fn touch_file(&self, key: PathBuf) {
        let mut order = self.file_order.lock().unwrap();
        if let Some(pos) = order.iter().position(|v| v == &key) {
            order.remove(pos);
        }
        order.push_back(key.clone());
        if order.len() > FILE_CACHE_LIMIT
            && let Some(evicted) = order.pop_front()
        {
            self.file_cache.remove(&evicted);
        }
    }
}

static STORAGE_CACHE: LazyLock<OpenCodeStorageCache> = LazyLock::new(OpenCodeStorageCache::new);

pub async fn opencode_storage_cache_clear() -> ApiResult<Response> {
    STORAGE_CACHE.clear();
    Ok(Json(serde_json::json!({"ok": true})).into_response())
}

fn opencode_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("XDG_DATA_HOME")
        && !dir.trim().is_empty()
    {
        return PathBuf::from(dir).join("opencode");
    }

    let home = std::env::var("HOME").unwrap_or_default();
    let base = if home.trim().is_empty() {
        PathBuf::from(".")
    } else {
        PathBuf::from(home)
    };
    base.join(".local").join("share").join("opencode")
}

fn opencode_storage_dir() -> PathBuf {
    opencode_data_dir().join("storage")
}

fn opencode_db_path() -> PathBuf {
    opencode_data_dir().join("opencode.db")
}

fn json_response(status: StatusCode, payload: Value) -> Response {
    (status, Json(payload)).into_response()
}

fn not_found_response(path: &Path) -> Response {
    json_response(
        StatusCode::NOT_FOUND,
        json!({
            "name": "NotFoundError",
            "data": {
                "message": format!("Resource not found: {}", path.display())
            }
        }),
    )
}

fn unknown_error_response(message: impl Into<String>) -> Response {
    json_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({
            "name": "UnknownError",
            "data": { "message": message.into() }
        }),
    )
}

fn bad_request_invalid_number(name: &str, raw: &str) -> Response {
    json_response(
        StatusCode::BAD_REQUEST,
        json!({
            "data": {
                "name": name,
                "value": raw,
            },
            "errors": [
                {
                    "code": "invalid_type",
                    "expected": "number",
                    "received": "nan",
                    "path": [name],
                    "message": "Expected number, received nan",
                }
            ],
            "success": false,
        }),
    )
}

fn syntax_error_message(err: &serde_json::Error) -> String {
    format!("SyntaxError: {}\n    at JSON.parse (<anonymous>)", err)
}

async fn dir_modified(dir: &Path) -> Option<SystemTime> {
    fs::metadata(dir)
        .await
        .ok()
        .and_then(|meta| meta.modified().ok())
}

fn resolve_directory(query_directory: Option<&str>, headers: &HeaderMap) -> String {
    if let Some(dir) = query_directory
        && !dir.is_empty()
    {
        return dir.to_string();
    }

    let header_directory = headers
        .get("x-opencode-directory")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty());

    let raw = header_directory.map(|v| v.to_string()).unwrap_or_else(|| {
        std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });

    urlencoding::decode(&raw)
        .map(|v| v.into_owned())
        .unwrap_or(raw)
}

fn normalize_dir_for_compare(value: &str) -> Option<String> {
    let normalized = normalize_directory_path(value);
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        None
    } else {
        let slash_normalized = trimmed.replace('\\', "/");
        let canonical = if slash_normalized.len() > 1 {
            slash_normalized.trim_end_matches('/').to_string()
        } else {
            slash_normalized
        };
        if canonical.is_empty() {
            None
        } else {
            Some(canonical)
        }
    }
}

fn session_matches_directory(session: &Value, filter_dir: &str, allow_descendants: bool) -> bool {
    let Some(raw) = session.get("directory").and_then(|v| v.as_str()) else {
        return false;
    };
    let Some(session_dir) = normalize_dir_for_compare(raw) else {
        return false;
    };
    if allow_descendants {
        Path::new(&session_dir).starts_with(filter_dir)
    } else {
        session_dir == filter_dir
    }
}

async fn find_git_dir(start: &Path) -> Option<PathBuf> {
    let mut current = if start.is_absolute() {
        start.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(start)
    };

    loop {
        let candidate = current.join(".git");
        if fs::metadata(&candidate).await.is_ok() {
            return Some(candidate);
        }

        let parent = current.parent().map(|p| p.to_path_buf());
        match parent {
            Some(parent) if parent != current => current = parent,
            _ => break,
        }
    }

    None
}

async fn read_cached_project_id(git_dir: &Path) -> Option<String> {
    let path = git_dir.join("opencode");
    let raw = fs::read_to_string(path).await.ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

async fn write_cached_project_id(git_dir: &Path, id: &str) {
    let path = git_dir.join("opencode");
    let _ = fs::write(path, id).await;
}

async fn git_output(dir: &Path, args: &[&str]) -> Result<String, std::io::Error> {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .await?;

    if !output.status.success() {
        return Err(std::io::Error::other("git command failed"));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn git_root_commit(dir: &Path) -> Result<Option<String>, std::io::Error> {
    let stdout = git_output(dir, &["rev-list", "--max-parents=0", "--all"]).await?;
    let mut roots = stdout
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect::<Vec<_>>();
    roots.sort();
    Ok(roots.into_iter().next())
}

async fn project_id_for_directory(directory: &str) -> String {
    let git_dir = match find_git_dir(Path::new(directory)).await {
        Some(dir) => dir,
        None => return "global".to_string(),
    };
    let sandbox = git_dir.parent().unwrap_or_else(|| Path::new(directory));

    if let Some(id) = read_cached_project_id(&git_dir).await {
        return id;
    }

    match git_root_commit(sandbox).await {
        Ok(Some(id)) => {
            write_cached_project_id(&git_dir, &id).await;
            id
        }
        Ok(None) => "global".to_string(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => "global".to_string(),
        Err(_) => "global".to_string(),
    }
}

async fn list_json_ids(dir: &Path) -> Vec<String> {
    let mut entries = match fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut ids = Vec::new();
    loop {
        match entries.next_entry().await {
            Ok(Some(entry)) => {
                let path = entry.path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                    continue;
                }
                let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                    continue;
                };
                ids.push(stem.to_string());
            }
            Ok(None) => break,
            Err(_) => return Vec::new(),
        }
    }

    ids.sort();
    ids
}

async fn list_json_ids_cached(dir: &Path) -> Vec<String> {
    let modified = match dir_modified(dir).await {
        Some(modified) => modified,
        None => return list_json_ids(dir).await,
    };

    if let Some(entry) = STORAGE_CACHE.dir_cache.get(dir)
        && entry.modified == modified
    {
        return entry.ids.clone();
    }

    let ids = list_json_ids(dir).await;
    STORAGE_CACHE.record_dir(
        dir.to_path_buf(),
        DirectoryCacheEntry {
            modified,
            ids: ids.clone(),
        },
    );
    ids
}

async fn list_session_bucket_dirs(session_root: &Path) -> Vec<PathBuf> {
    let mut entries = match fs::read_dir(session_root).await {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut dirs = Vec::new();
    loop {
        match entries.next_entry().await {
            Ok(Some(entry)) => {
                let path = entry.path();
                let file_type = match entry.file_type().await {
                    Ok(file_type) => file_type,
                    Err(_) => continue,
                };
                if !file_type.is_dir() {
                    continue;
                }
                dirs.push(path);
            }
            Ok(None) => break,
            Err(_) => return Vec::new(),
        }
    }

    dirs.sort();
    dirs
}

async fn append_legacy_directory_scope_session_dirs(
    session_root: &Path,
    session_dirs: &mut Vec<PathBuf>,
) {
    use std::collections::HashSet;

    let mut seen = HashSet::<PathBuf>::new();
    for dir in session_dirs.iter() {
        seen.insert(dir.clone());
    }

    let all_dirs = list_session_bucket_dirs(session_root).await;
    for dir in all_dirs {
        if seen.contains(&dir) {
            continue;
        }
        let is_global = dir
            .file_name()
            .and_then(|v| v.to_str())
            .map(|v| v == "global")
            .unwrap_or(false);
        if is_global {
            continue;
        }
        seen.insert(dir.clone());
        session_dirs.push(dir);
    }
}

fn parse_number(raw: Option<String>, name: &str) -> Result<Option<f64>, Box<Response>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Some(0.0));
    }
    let parsed = trimmed
        .parse::<f64>()
        .map_err(|_| Box::new(bad_request_invalid_number(name, trimmed)))?;
    if parsed.is_nan() {
        return Err(Box::new(bad_request_invalid_number(name, trimmed)));
    }
    Ok(Some(parsed))
}

fn parse_boolish(raw: Option<String>) -> bool {
    let Some(raw) = raw else {
        return false;
    };
    let value = raw.trim();
    if value.is_empty() {
        return true;
    }

    match value.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => true,
        "0" | "false" | "no" | "off" => false,
        // Preserve existing permissive behavior for unknown truthy-ish values.
        _ => true,
    }
}

fn parse_id_list(raw: Option<String>) -> Vec<String> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    raw.split(',')
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .collect()
}

fn read_json_error_response(path: &Path, err: ReadJsonError) -> Response {
    match err {
        ReadJsonError::Io(err) if err.kind() == std::io::ErrorKind::NotFound => {
            not_found_response(path)
        }
        ReadJsonError::Io(err) => unknown_error_response(format!("Error: {}", err)),
        ReadJsonError::Json(err) => unknown_error_response(syntax_error_message(&err)),
        ReadJsonError::TransientJson => json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({
                "error": "Resource temporarily unavailable",
                "code": "temporarily_unavailable",
                "retryAfterMs": DEFAULT_DEGRADED_RETRY_AFTER_MS,
            }),
        ),
    }
}

pub async fn session_list(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(query): Query<SessionListQuery>,
) -> ApiResult<Response> {
    let query_directory = query
        .directory
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string());
    let scope = query
        .scope
        .as_deref()
        .unwrap_or("directory")
        .trim()
        .to_ascii_lowercase();
    // Default to strict directory scope to avoid leaking sessions between unrelated
    // non-git directories (OpenCode stores all non-git sessions under projectID=global).
    // Treat unknown scopes as directory; require explicit `scope=project` to widen.
    let scope_project = scope == "project";
    let roots = parse_boolish(query.roots);
    let include_children = parse_boolish(query.include_children);
    let include_total = parse_boolish(query.include_total);
    let focus_session_id = query
        .focus_session_id
        .as_deref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let ids_filter = parse_id_list(query.ids);
    let ids_filter_provided = !ids_filter.is_empty();

    let start = match parse_number(query.start, "start") {
        Ok(value) => value,
        Err(resp) => return Ok(*resp),
    };
    let offset_provided = query.offset.as_deref().is_some();
    let offset_raw = match parse_number(query.offset, "offset") {
        Ok(value) => value,
        Err(resp) => return Ok(*resp),
    };
    let limit_raw = match parse_number(query.limit, "limit") {
        Ok(value) => value,
        Err(resp) => return Ok(*resp),
    };
    let term = query.search.map(|t| t.to_lowercase());

    let directory = resolve_directory(query_directory.as_deref(), &headers);
    let project_id = project_id_for_directory(&directory).await;
    let filter_directory = if scope_project {
        None
    } else {
        normalize_dir_for_compare(&directory)
    };
    let session_root = opencode_storage_dir().join("session");
    let mut session_dirs = vec![session_root.join(&project_id)];
    if !scope_project && project_id != "global" {
        // Historical sessions may remain in the shared global bucket from older
        // OpenCode/project-id states. Include it as a strict directory-filtered
        // fallback to avoid silent omissions.
        session_dirs.push(session_root.join("global"));
    }
    if !scope_project {
        // Git history rewrites can rotate project IDs and orphan historical session
        // buckets. For directory scope we can safely include legacy buckets because
        // filtering remains strict to the requested directory path.
        append_legacy_directory_scope_session_dirs(&session_root, &mut session_dirs).await;
    }

    let offset_value = offset_raw.unwrap_or(0.0);
    let mut offset = if offset_value.is_sign_negative() {
        0usize
    } else {
        offset_value.floor() as usize
    };
    let limit = limit_raw.map(|v| {
        if v.is_sign_negative() {
            0usize
        } else {
            v.floor() as usize
        }
    });

    let mut records: Vec<SessionRecord> = Vec::new();
    let mut consistency = ResponseConsistency::default();
    let allow_descendants = false;

    let record_from_summary = |summary: crate::directory_session_index::SessionSummaryRecord| {
        if !scope_project && let Some(ref filter) = filter_directory {
            let matches_directory =
                normalize_dir_for_compare(&summary.directory_path).is_some_and(|dir| {
                    if allow_descendants {
                        Path::new(&dir).starts_with(filter)
                    } else {
                        dir == *filter
                    }
                });
            if !matches_directory {
                return None;
            }
        }

        let updated = summary.updated_at;
        if let Some(start) = start
            && updated < start
        {
            return None;
        }

        let session = summary.raw;
        if let Some(ref term) = term {
            let title = summary.title.as_str();
            let slug = session.get("slug").and_then(|v| v.as_str()).unwrap_or("");
            let id = summary.session_id.as_str();
            let matches = title.to_lowercase().contains(term)
                || slug.to_lowercase().contains(term)
                || id.to_lowercase().contains(term);
            if !matches {
                return None;
            }
        }

        Some(SessionRecord {
            id: summary.session_id,
            parent_id: summary.parent_id,
            updated,
            value: session,
        })
    };

    use std::collections::HashMap;
    let sqlite_db_exists = fs::metadata(opencode_db_path()).await.is_ok();
    let sqlite_project_scope = if scope_project {
        Some(project_id.as_str())
    } else {
        None
    };
    let sqlite_records = load_session_records_from_sqlite(sqlite_project_scope).await;
    let sqlite_available = sqlite_records.is_some();
    if sqlite_db_exists && !sqlite_available {
        consistency.note_io_skip();
    }

    let mut records_from_sqlite_by_id = HashMap::<String, SessionRecord>::new();
    for mut record in sqlite_records.unwrap_or_default() {
        if record.id.trim().is_empty() {
            continue;
        }
        if !scope_project
            && let Some(ref filter) = filter_directory
            && !session_matches_directory(&record.value, filter, allow_descendants)
        {
            continue;
        }

        if let Some(start) = start
            && record.updated < start
        {
            continue;
        }

        if let Some(ref term) = term {
            let title = record
                .value
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let slug = record
                .value
                .get("slug")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let matches = title.to_lowercase().contains(term)
                || slug.to_lowercase().contains(term)
                || record.id.to_lowercase().contains(term);
            if !matches {
                continue;
            }
        }

        if !crate::opencode_proxy::prune_session_summary_value(&mut record.value) {
            continue;
        }

        record.parent_id = record
            .value
            .get("parentID")
            .or_else(|| record.value.get("parentId"))
            .or_else(|| record.value.get("parent_id"))
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        state
            .directory_session_index
            .upsert_summary_from_value(&record.value);
        records_from_sqlite_by_id.insert(record.id.clone(), record);
    }

    if ids_filter_provided {
        for session_id in &ids_filter {
            let mut matched = false;

            if let Some(summary) = state.directory_session_index.summary(session_id)
                && let Some(record) = record_from_summary(summary)
            {
                records.push(record);
                matched = true;
            }

            if matched {
                continue;
            }

            if let Some(record) = records_from_sqlite_by_id.get(session_id) {
                records.push(record.clone());
                continue;
            }

            if !sqlite_available {
                for session_dir in &session_dirs {
                    let path = session_dir.join(format!("{session_id}.json"));
                    let (mut session, read_outcome) = match read_json_value(&path).await {
                        Ok(value) => value,
                        Err(err) => {
                            mark_consistency_read_error(&mut consistency, &err);
                            continue;
                        }
                    };
                    if read_outcome.stale_cache {
                        consistency.note_stale_read();
                    }

                    if !scope_project
                        && let Some(ref filter) = filter_directory
                        && !session_matches_directory(&session, filter, allow_descendants)
                    {
                        continue;
                    }

                    let updated = session
                        .get("time")
                        .and_then(|v| v.get("updated"))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);

                    if let Some(start) = start
                        && updated < start
                    {
                        continue;
                    }

                    if let Some(ref term) = term {
                        let title = session.get("title").and_then(|v| v.as_str()).unwrap_or("");
                        let slug = session.get("slug").and_then(|v| v.as_str()).unwrap_or("");
                        let id = session
                            .get("id")
                            .and_then(|v| v.as_str())
                            .filter(|v| !v.trim().is_empty())
                            .unwrap_or(session_id.as_str());
                        let matches = title.to_lowercase().contains(term)
                            || slug.to_lowercase().contains(term)
                            || id.to_lowercase().contains(term);
                        if !matches {
                            continue;
                        }
                    }

                    if !crate::opencode_proxy::prune_session_summary_value(&mut session) {
                        continue;
                    }

                    let parent_id = session
                        .get("parentID")
                        .or_else(|| session.get("parentId"))
                        .or_else(|| session.get("parent_id"))
                        .and_then(|v| v.as_str())
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty());

                    state
                        .directory_session_index
                        .upsert_summary_from_value(&session);
                    records.push(SessionRecord {
                        id: session_id.clone(),
                        parent_id,
                        updated,
                        value: session,
                    });
                    matched = true;
                    break;
                }
            }
            if matched {
                continue;
            }
        }
    } else {
        use std::collections::HashSet;

        let mut seen_ids: HashSet<String> = HashSet::new();
        for record in records_from_sqlite_by_id.values() {
            if !seen_ids.insert(record.id.clone()) {
                continue;
            }
            records.push(record.clone());
        }

        if !sqlite_available {
            enum ScanFetchResult {
                Record(Option<SessionRecord>, ReadJsonOutcome),
                ReadError(String, ReadJsonError),
            }

            for session_dir in &session_dirs {
                let session_ids = list_json_ids_cached(session_dir).await;
                let session_dir = session_dir.to_path_buf();
                let filter_directory = filter_directory.clone();
                let term = term.clone();
                let index = state.directory_session_index.clone();

                let fetched = futures_stream::iter(session_ids.into_iter().map(|session_id| {
                    let session_dir = session_dir.clone();
                    let filter_directory = filter_directory.clone();
                    let term = term.clone();
                    let index = index.clone();
                    async move {
                        let path = session_dir.join(format!("{session_id}.json"));
                        let (mut session, read_outcome) = match read_json_value(&path).await {
                            Ok(value) => value,
                            Err(err) => return ScanFetchResult::ReadError(session_id, err),
                        };

                        if !scope_project
                            && let Some(ref filter) = filter_directory
                            && !session_matches_directory(&session, filter, allow_descendants)
                        {
                            return ScanFetchResult::Record(None, read_outcome);
                        }

                        let updated = session
                            .get("time")
                            .and_then(|v| v.get("updated"))
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);

                        if let Some(start) = start
                            && updated < start
                        {
                            return ScanFetchResult::Record(None, read_outcome);
                        }

                        if let Some(ref term) = term {
                            let title = session.get("title").and_then(|v| v.as_str()).unwrap_or("");
                            let slug = session.get("slug").and_then(|v| v.as_str()).unwrap_or("");
                            let id = session
                                .get("id")
                                .and_then(|v| v.as_str())
                                .filter(|v| !v.trim().is_empty())
                                .unwrap_or(&session_id);
                            let matches = title.to_lowercase().contains(term)
                                || slug.to_lowercase().contains(term)
                                || id.to_lowercase().contains(term);
                            if !matches {
                                return ScanFetchResult::Record(None, read_outcome);
                            }
                        }

                        if !crate::opencode_proxy::prune_session_summary_value(&mut session) {
                            return ScanFetchResult::Record(None, read_outcome);
                        }

                        let parent_id = session
                            .get("parentID")
                            .or_else(|| session.get("parentId"))
                            .or_else(|| session.get("parent_id"))
                            .and_then(|v| v.as_str())
                            .map(|v| v.trim().to_string())
                            .filter(|v| !v.is_empty());

                        index.upsert_summary_from_value(&session);
                        ScanFetchResult::Record(
                            Some(SessionRecord {
                                id: session_id,
                                parent_id,
                                updated,
                                value: session,
                            }),
                            read_outcome,
                        )
                    }
                }))
                .buffer_unordered(SESSION_SCAN_CONCURRENCY)
                .collect::<Vec<_>>()
                .await;

                for item in fetched {
                    match item {
                        ScanFetchResult::Record(record, read_outcome) => {
                            let Some(record) = record else {
                                continue;
                            };
                            if read_outcome.stale_cache {
                                consistency.note_stale_read();
                            }
                            if !seen_ids.insert(record.id.clone()) {
                                continue;
                            }
                            records.push(record);
                        }
                        ScanFetchResult::ReadError(session_id, err) => {
                            mark_consistency_read_error(&mut consistency, &err);
                            if let Some(summary) =
                                state.directory_session_index.summary(&session_id)
                                && let Some(record) = record_from_summary(summary)
                            {
                                consistency.note_fallback_summary();
                                if !seen_ids.insert(record.id.clone()) {
                                    continue;
                                }
                                records.push(record);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut sessions: Vec<Value> = Vec::new();
    let total: usize;
    let has_more: bool;
    let next_offset: Option<usize>;
    let mut focus_root_id: Option<String> = None;
    let mut focus_root_index: Option<usize> = None;

    let needs_root_paging = roots || include_children || focus_session_id.is_some();

    if needs_root_paging {
        use std::collections::{HashMap, HashSet};

        let mut by_id: HashMap<String, SessionRecord> = HashMap::new();
        for record in &records {
            by_id.insert(record.id.clone(), record.clone());
        }

        let mut children_by_id: HashMap<String, Vec<String>> = HashMap::new();
        for record in &records {
            if let Some(parent) = record.parent_id.as_ref()
                && by_id.contains_key(parent)
            {
                children_by_id
                    .entry(parent.clone())
                    .or_default()
                    .push(record.id.clone());
            }
        }

        let mut root_ids: Vec<String> = records
            .iter()
            .filter(|record| {
                record
                    .parent_id
                    .as_ref()
                    .is_none_or(|pid| !by_id.contains_key(pid))
            })
            .map(|record| record.id.clone())
            .collect();

        root_ids.sort_by(|a, b| {
            let a_upd = by_id.get(a).map(|r| r.updated).unwrap_or(0.0);
            let b_upd = by_id.get(b).map(|r| r.updated).unwrap_or(0.0);
            b_upd
                .partial_cmp(&a_upd)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.cmp(b))
        });

        total = root_ids.len();

        if let Some(focus_id) = focus_session_id.as_ref()
            && by_id.contains_key(focus_id)
        {
            let mut current = focus_id.clone();
            let mut seen: HashSet<String> = HashSet::new();
            loop {
                if !seen.insert(current.clone()) {
                    break;
                }
                let parent = by_id
                    .get(&current)
                    .and_then(|r| r.parent_id.clone())
                    .filter(|pid| by_id.contains_key(pid));
                let Some(parent) = parent else {
                    break;
                };
                current = parent;
            }
            focus_root_id = Some(current.clone());
            if let Some(idx) = root_ids.iter().position(|id| id == &current) {
                focus_root_index = Some(idx);
            }
        }

        if !offset_provided
            && let (Some(idx), Some(limit)) = (focus_root_index, limit)
            && limit > 0
        {
            offset = (idx / limit) * limit;
        }

        if offset > total {
            offset = total;
        }

        let end = match limit {
            Some(limit) => offset.saturating_add(limit).min(total),
            None => total,
        };
        let page_roots = if offset >= total {
            Vec::new()
        } else {
            root_ids[offset..end].to_vec()
        };

        if include_children {
            for kids in children_by_id.values_mut() {
                kids.sort_by(|a, b| {
                    let a_upd = by_id.get(a).map(|r| r.updated).unwrap_or(0.0);
                    let b_upd = by_id.get(b).map(|r| r.updated).unwrap_or(0.0);
                    b_upd
                        .partial_cmp(&a_upd)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| a.cmp(b))
                });
            }

            fn collect_subtree(
                root_id: &str,
                by_id: &HashMap<String, SessionRecord>,
                children_by_id: &HashMap<String, Vec<String>>,
                out: &mut Vec<Value>,
            ) {
                if let Some(record) = by_id.get(root_id) {
                    out.push(record.value.clone());
                }
                if let Some(children) = children_by_id.get(root_id) {
                    for child in children {
                        collect_subtree(child, by_id, children_by_id, out);
                    }
                }
            }

            for root_id in &page_roots {
                collect_subtree(root_id, &by_id, &children_by_id, &mut sessions);
            }
        } else {
            for root_id in &page_roots {
                if let Some(record) = by_id.get(root_id) {
                    sessions.push(record.value.clone());
                }
            }
        }

        let roots_returned = page_roots.len();
        let limit_active = limit.unwrap_or(0) > 0;
        has_more = limit_active && offset.saturating_add(roots_returned) < total;
        next_offset = if has_more {
            Some(offset.saturating_add(roots_returned))
        } else {
            None
        };
    } else {
        // Match OpenCode CLI ordering: most recently updated first.
        // Preserve explicit ids ordering when the caller uses `ids=...`.
        if !ids_filter_provided {
            records.sort_by(|a, b| {
                b.updated
                    .partial_cmp(&a.updated)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.id.cmp(&b.id))
            });
        }

        total = records.len();
        if offset > total {
            offset = total;
        }
        let end = match limit {
            Some(limit) => offset.saturating_add(limit).min(total),
            None => total,
        };
        if offset < end {
            sessions = records[offset..end]
                .iter()
                .map(|record| record.value.clone())
                .collect();
        }
        let limit_active = limit.unwrap_or(0) > 0;
        has_more = limit_active && offset.saturating_add(sessions.len()) < total;
        next_offset = if has_more {
            Some(offset.saturating_add(sessions.len()))
        } else {
            None
        };
    }

    if include_total {
        Ok(Json(SessionListResponse {
            sessions,
            total,
            offset,
            limit,
            has_more,
            next_offset,
            focus_root_id,
            focus_root_index,
            consistency: consistency.into_option(),
        })
        .into_response())
    } else {
        Ok(Json(sessions).into_response())
    }
}

pub async fn session_post(
    State(state): State<Arc<crate::AppState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> ApiResult<Response> {
    crate::opencode_proxy::proxy_opencode_rest_inner(
        state,
        method,
        uri,
        headers,
        "session".to_string(),
        body,
    )
    .await
}

pub async fn session_message_get(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<SessionMessagesQuery>,
    AxumPath(session_id): AxumPath<String>,
) -> ApiResult<Response> {
    let include_total = parse_boolish(query.include_total);
    let offset = match parse_number(query.offset, "offset") {
        Ok(value) => value.unwrap_or(0.0),
        Err(resp) => return Ok(*resp),
    };
    let limit = match parse_number(query.limit, "limit") {
        Ok(value) => value.filter(|v| *v != 0.0),
        Err(resp) => return Ok(*resp),
    };
    let offset = if offset.is_sign_negative() {
        0usize
    } else {
        offset.floor() as usize
    };
    let limit = limit.map(|v| {
        if v.is_sign_negative() {
            0usize
        } else {
            v.floor() as usize
        }
    });

    let sqlite_db_exists = fs::metadata(opencode_db_path()).await.is_ok();
    let mut consistency = ResponseConsistency::default();
    let mut entries = Vec::new();
    let total: usize;

    if let Some(page) =
        load_session_message_page_from_sqlite(&session_id, offset, limit, include_total).await
    {
        entries = page.entries;
        total = page.total;
        consistency = page.consistency;
    } else {
        if sqlite_db_exists {
            consistency.note_io_skip();
        }

        let storage_dir = opencode_storage_dir();
        let message_dir = storage_dir.join("message").join(&session_id);
        let message_ids = list_json_ids_cached(&message_dir).await;
        total = message_ids.len();
        let mut skipped = 0usize;

        for message_id in message_ids.iter().rev() {
            if skipped < offset {
                skipped += 1;
                continue;
            }
            if let Some(limit) = limit
                && entries.len() >= limit
            {
                break;
            }

            let message_path = message_dir.join(format!("{message_id}.json"));
            let (info, read_outcome) = match read_json_value(&message_path).await {
                Ok(value) => value,
                Err(err) => {
                    mark_consistency_read_error(&mut consistency, &err);
                    continue;
                }
            };
            if read_outcome.stale_cache {
                consistency.note_stale_read();
            }

            let parts_dir = storage_dir.join("part").join(message_id);
            let part_ids = list_json_ids_cached(&parts_dir).await;
            let mut parts = Vec::new();
            for part_id in part_ids {
                let part_path = parts_dir.join(format!("{part_id}.json"));
                let (part, part_outcome) = match read_json_value(&part_path).await {
                    Ok(value) => value,
                    Err(err) => {
                        mark_consistency_read_error(&mut consistency, &err);
                        continue;
                    }
                };
                if part_outcome.stale_cache {
                    consistency.note_stale_read();
                }
                parts.push(part);
            }
            parts.sort_by(|a, b| {
                let a_id = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let b_id = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
                a_id.cmp(b_id)
            });

            entries.push(json!({
                "info": info,
                "parts": parts,
            }));
        }

        entries.reverse();
    }

    let mut payload = Value::Array(entries);

    let settings = state.settings.read().await;
    let filter = crate::opencode_proxy::activity_filter_from_settings(&settings);
    let detail = crate::opencode_proxy::activity_detail_policy_from_settings(&settings);
    crate::opencode_proxy::filter_message_payload(&mut payload, &filter, &detail);

    let mut entries = match payload {
        Value::Array(list) => list,
        _ => Vec::new(),
    };

    // Ensure each part carries stable IDs so the web UI can lazy-load details by
    // (sessionID, messageID, partID).
    for entry in entries.iter_mut() {
        let Some(obj) = entry.as_object_mut() else {
            continue;
        };
        let message_id = obj
            .get("info")
            .and_then(|v| v.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if message_id.is_empty() {
            continue;
        }

        let Some(parts) = obj.get_mut("parts").and_then(|v| v.as_array_mut()) else {
            continue;
        };
        for part in parts.iter_mut() {
            let Some(pobj) = part.as_object_mut() else {
                continue;
            };
            pobj.insert("sessionID".to_string(), Value::String(session_id.clone()));
            pobj.insert("messageID".to_string(), Value::String(message_id.clone()));
            let pid = pobj
                .get("id")
                .and_then(|v| v.as_str())
                .or_else(|| pobj.get("partID").and_then(|v| v.as_str()))
                .unwrap_or("")
                .trim();
            if !pid.is_empty() {
                pobj.insert("partID".to_string(), Value::String(pid.to_string()));
            }
        }
    }

    let body = if include_total {
        let has_more = limit.is_some() && offset.saturating_add(entries.len()) < total;
        let next_offset = if has_more {
            Some(offset.saturating_add(entries.len()))
        } else {
            None
        };
        serde_json::to_vec(&SessionMessageListResponse {
            entries,
            total,
            offset,
            limit,
            has_more,
            next_offset,
            consistency: consistency.into_option(),
        })
    } else {
        serde_json::to_vec(&Value::Array(entries))
    };
    let body = match body {
        Ok(body) => body,
        Err(err) => return Ok(unknown_error_response(format!("Error: {}", err))),
    };
    let mut out = Response::new(axum::body::Body::from(body));
    out.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    Ok(out)
}

pub async fn session_message_part_get(
    State(state): State<Arc<crate::AppState>>,
    AxumPath((session_id, message_id, part_id)): AxumPath<(String, String, String)>,
) -> ApiResult<Response> {
    let sid = session_id.trim();
    let mid = message_id.trim();
    let pid = part_id.trim();
    if sid.is_empty() || mid.is_empty() || pid.is_empty() {
        return Ok(json_response(
            StatusCode::BAD_REQUEST,
            json!({"error": "session_id, message_id, and part_id are required"}),
        ));
    }

    let sqlite = load_session_message_part_from_sqlite(sid, mid, pid).await;
    let (info, part) = if let Some((info, part)) = sqlite {
        (info, part)
    } else {
        let storage_dir = opencode_storage_dir();
        let message_path = storage_dir
            .join("message")
            .join(sid)
            .join(format!("{mid}.json"));
        let (info, _) = match read_json_value(&message_path).await {
            Ok(value) => value,
            Err(err) => return Ok(read_json_error_response(&message_path, err)),
        };

        let part_path = storage_dir
            .join("part")
            .join(mid)
            .join(format!("{pid}.json"));
        let (part, _) = match read_json_value(&part_path).await {
            Ok(value) => value,
            Err(err) => return Ok(read_json_error_response(&part_path, err)),
        };
        (info, part)
    };

    let mut payload = json!([
        {
            "info": info,
            "parts": [part]
        }
    ]);

    let settings = state.settings.read().await;
    let filter = crate::opencode_proxy::activity_filter_from_settings(&settings);
    let detail = crate::opencode_proxy::ActivityDetailPolicy {
        enabled: false,
        expanded: std::collections::HashSet::new(),
        expanded_tools: std::collections::HashSet::new(),
    };
    crate::opencode_proxy::filter_message_payload(&mut payload, &filter, &detail);

    let part = payload
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|v| v.get("parts"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .cloned();

    let mut part = match part {
        Some(v) => v,
        None => {
            return Ok(json_response(
                StatusCode::NOT_FOUND,
                json!({"error": "Part not available"}),
            ));
        }
    };

    if let Some(obj) = part.as_object_mut() {
        obj.insert("sessionID".to_string(), Value::String(sid.to_string()));
        obj.insert("messageID".to_string(), Value::String(mid.to_string()));
        obj.insert("partID".to_string(), Value::String(pid.to_string()));
        if obj
            .get("id")
            .and_then(|v| v.as_str())
            .is_none_or(|v| v.trim().is_empty())
        {
            obj.insert("id".to_string(), Value::String(pid.to_string()));
        }
    }

    Ok(Json(part).into_response())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::await_holding_lock)]

    use super::*;
    use axum::body::to_bytes;
    use axum::extract::{Query, State};
    use std::sync::{LazyLock, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    struct EnvVarGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: String) -> Self {
            let prev = std::env::var(key).ok();
            // NOTE: std::env::{set_var,remove_var} are unsafe in recent Rust because
            // modifying process-wide environment variables is not thread-safe.
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

    fn unique_tmp_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("opencode-studio-{label}-{nanos}"))
    }

    #[test]
    fn parse_boolish_honors_explicit_false_values() {
        assert!(parse_boolish(Some("true".to_string())));
        assert!(parse_boolish(Some("1".to_string())));
        assert!(parse_boolish(Some("".to_string())));
        assert!(parse_boolish(Some("custom".to_string())));

        assert!(!parse_boolish(Some("false".to_string())));
        assert!(!parse_boolish(Some("0".to_string())));
        assert!(!parse_boolish(Some("no".to_string())));
        assert!(!parse_boolish(None));
    }

    async fn write_json(path: &std::path::Path, value: &serde_json::Value) {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        tokio::fs::write(path, serde_json::to_vec_pretty(value).unwrap())
            .await
            .unwrap();
    }

    fn dummy_state() -> Arc<crate::AppState> {
        Arc::new(crate::AppState {
            ui_auth: crate::ui_auth::UiAuth::Disabled,
            ui_cookie_same_site: axum_extra::extract::cookie::SameSite::Strict,
            cors_allowed_origins: Vec::new(),
            opencode: Arc::new(crate::opencode::OpenCodeManager::new(
                "127.0.0.1".to_string(),
                Some(1),
                true,
                None,
            )),
            plugin_runtime: Arc::new(crate::plugin_runtime::PluginRuntime::new()),
            terminal: Arc::new(crate::terminal::TerminalManager::new()),
            session_activity: crate::session_activity::SessionActivityManager::new(),
            directory_session_index:
                crate::directory_session_index::DirectorySessionIndexManager::new(),
            settings_path: std::path::PathBuf::from("/tmp/opencode-studio-test-settings.json"),
            settings: Arc::new(tokio::sync::RwLock::new(
                crate::settings::Settings::default(),
            )),
        })
    }

    #[tokio::test]
    async fn session_list_defaults_to_directory_scope_and_sorts_by_updated() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-list");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        // Create two directories outside any git repo (project_id => global).
        let proj1 = tmp.join("proj1");
        let proj2 = tmp.join("proj2");
        tokio::fs::create_dir_all(&proj1).await.unwrap();
        tokio::fs::create_dir_all(&proj2).await.unwrap();

        let storage = tmp.join("opencode").join("storage");
        let session_dir = storage.join("session").join("global");

        // Three sessions in the same global project; two share the same directory.
        write_json(
            &session_dir.join("ses_a.json"),
            &serde_json::json!({
                "id": "ses_a",
                "directory": proj1.to_string_lossy(),
                "title": "A",
                "slug": "a",
                "time": {"updated": 100.0}
            }),
        )
        .await;
        write_json(
            &session_dir.join("ses_c.json"),
            &serde_json::json!({
                "id": "ses_c",
                "directory": proj1.to_string_lossy(),
                "title": "C",
                "slug": "c",
                "time": {"updated": 50.0}
            }),
        )
        .await;
        write_json(
            &session_dir.join("ses_b.json"),
            &serde_json::json!({
                "id": "ses_b",
                "directory": proj2.to_string_lossy(),
                "title": "B",
                "slug": "b",
                "time": {"updated": 200.0}
            }),
        )
        .await;

        // Default scope is directory: directory is used as a strict filter.
        let resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(proj1.to_string_lossy().to_string()),
                scope: None,
                roots: None,
                start: None,
                search: None,
                offset: None,
                limit: None,
                include_total: Some("true".to_string()),
                include_children: None,
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();

        let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let sessions = json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");

        assert_eq!(sessions.len(), 2);
        assert_eq!(json.get("total").and_then(|v| v.as_u64()), Some(2));

        // Sorted by time.updated desc.
        assert_eq!(
            sessions[0].get("id").and_then(|v| v.as_str()),
            Some("ses_a")
        );
        assert_eq!(
            sessions[1].get("id").and_then(|v| v.as_str()),
            Some("ses_c")
        );

        // Project scope should widen the list beyond the directory filter.
        let resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(proj1.to_string_lossy().to_string()),
                scope: Some("project".to_string()),
                roots: None,
                start: None,
                search: None,
                offset: None,
                limit: None,
                include_total: Some("true".to_string()),
                include_children: None,
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();
        let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let sessions = json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");
        assert_eq!(sessions.len(), 3);
        assert_eq!(json.get("total").and_then(|v| v.as_u64()), Some(3));
        assert_eq!(
            sessions[0].get("id").and_then(|v| v.as_str()),
            Some("ses_b")
        );
        assert_eq!(
            sessions[1].get("id").and_then(|v| v.as_str()),
            Some("ses_a")
        );
        assert_eq!(
            sessions[2].get("id").and_then(|v| v.as_str()),
            Some("ses_c")
        );

        // Explicit ids ordering should be preserved (when widening via project scope).
        let resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(proj1.to_string_lossy().to_string()),
                scope: Some("project".to_string()),
                roots: None,
                start: None,
                search: None,
                offset: None,
                limit: None,
                include_total: Some("true".to_string()),
                include_children: None,
                ids: Some("ses_c,ses_b,ses_a".to_string()),
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();
        let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let sessions = json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");
        assert_eq!(sessions.len(), 3);
        assert_eq!(
            sessions[0].get("id").and_then(|v| v.as_str()),
            Some("ses_c")
        );
        assert_eq!(
            sessions[1].get("id").and_then(|v| v.as_str()),
            Some("ses_b")
        );
        assert_eq!(
            sessions[2].get("id").and_then(|v| v.as_str()),
            Some("ses_a")
        );
    }

    #[tokio::test]
    async fn session_list_directory_scope_is_strict_and_isolates_global_bucket() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-list-strict");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let root = tmp.join("workspace");
        let sub = root.join("sub");
        let other = tmp.join("other");
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::create_dir_all(&sub).await.unwrap();
        tokio::fs::create_dir_all(&other).await.unwrap();

        let storage = tmp.join("opencode").join("storage");
        let session_dir = storage.join("session").join("global");

        write_json(
            &session_dir.join("root.json"),
            &serde_json::json!({
                "id": "root",
                "directory": root.to_string_lossy(),
                "title": "Root",
                "slug": "root",
                "time": {"updated": 300.0}
            }),
        )
        .await;

        write_json(
            &session_dir.join("sub.json"),
            &serde_json::json!({
                "id": "sub",
                "directory": sub.to_string_lossy(),
                "title": "Sub",
                "slug": "sub",
                "time": {"updated": 200.0}
            }),
        )
        .await;

        write_json(
            &session_dir.join("other.json"),
            &serde_json::json!({
                "id": "other",
                "directory": other.to_string_lossy(),
                "title": "Other",
                "slug": "other",
                "time": {"updated": 100.0}
            }),
        )
        .await;

        let strict_resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(root.to_string_lossy().to_string()),
                scope: None,
                roots: None,
                start: None,
                search: None,
                offset: None,
                limit: None,
                include_total: Some("true".to_string()),
                include_children: None,
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();

        let strict_body = to_bytes(strict_resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let strict_json: serde_json::Value = serde_json::from_slice(&strict_body).unwrap();
        let strict_sessions = strict_json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");

        assert_eq!(strict_sessions.len(), 1);
        assert_eq!(strict_json.get("total").and_then(|v| v.as_u64()), Some(1));
        assert_eq!(
            strict_sessions[0].get("id").and_then(|v| v.as_str()),
            Some("root")
        );

        let other_resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(other.to_string_lossy().to_string()),
                scope: None,
                roots: None,
                start: None,
                search: None,
                offset: None,
                limit: None,
                include_total: Some("true".to_string()),
                include_children: None,
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();

        let other_body = to_bytes(other_resp.into_body(), 1024 * 1024).await.unwrap();
        let other_json: serde_json::Value = serde_json::from_slice(&other_body).unwrap();
        let other_sessions = other_json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");

        assert_eq!(other_sessions.len(), 1);
        assert_eq!(
            other_sessions[0].get("id").and_then(|v| v.as_str()),
            Some("other")
        );

        let widened_resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(root.to_string_lossy().to_string()),
                scope: Some("project".to_string()),
                roots: None,
                start: None,
                search: None,
                offset: None,
                limit: None,
                include_total: Some("true".to_string()),
                include_children: None,
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();

        let widened_body = to_bytes(widened_resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let widened_json: serde_json::Value = serde_json::from_slice(&widened_body).unwrap();
        let widened_sessions = widened_json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");

        assert_eq!(widened_sessions.len(), 3);
        assert_eq!(widened_json.get("total").and_then(|v| v.as_u64()), Some(3));
    }

    #[tokio::test]
    async fn session_list_directory_scope_matches_trailing_slash_paths() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-list-trailing-slash");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let proj = tmp.join("proj");
        tokio::fs::create_dir_all(&proj).await.unwrap();

        let storage = tmp.join("opencode").join("storage");
        let session_dir = storage.join("session").join("global");

        write_json(
            &session_dir.join("slashy.json"),
            &serde_json::json!({
                "id": "slashy",
                "directory": format!("{}/", proj.to_string_lossy()),
                "title": "Slashy",
                "slug": "slashy",
                "time": {"updated": 10.0}
            }),
        )
        .await;

        let resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(proj.to_string_lossy().to_string()),
                scope: Some("directory".to_string()),
                roots: None,
                start: None,
                search: None,
                offset: None,
                limit: None,
                include_total: Some("true".to_string()),
                include_children: None,
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();

        let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let sessions = json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");

        assert_eq!(sessions.len(), 1);
        assert_eq!(json.get("total").and_then(|v| v.as_u64()), Some(1));
        assert_eq!(
            sessions[0].get("id").and_then(|v| v.as_str()),
            Some("slashy")
        );
    }

    #[tokio::test]
    async fn session_list_directory_scope_includes_legacy_global_bucket_for_git_dirs() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-list-legacy-global");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let proj = tmp.join("proj");
        let git_dir = proj.join(".git");
        tokio::fs::create_dir_all(&git_dir).await.unwrap();
        tokio::fs::write(git_dir.join("opencode"), "project_bucket")
            .await
            .unwrap();

        let storage = tmp.join("opencode").join("storage");

        write_json(
            &storage
                .join("session")
                .join("project_bucket")
                .join("newer.json"),
            &serde_json::json!({
                "id": "newer",
                "directory": proj.to_string_lossy(),
                "title": "Newer",
                "slug": "newer",
                "time": {"updated": 20.0}
            }),
        )
        .await;

        write_json(
            &storage.join("session").join("global").join("older.json"),
            &serde_json::json!({
                "id": "older",
                "directory": proj.to_string_lossy(),
                "title": "Older",
                "slug": "older",
                "time": {"updated": 10.0}
            }),
        )
        .await;

        let resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(proj.to_string_lossy().to_string()),
                scope: Some("directory".to_string()),
                roots: Some("true".to_string()),
                start: None,
                search: None,
                offset: Some("0".to_string()),
                limit: Some("30".to_string()),
                include_total: Some("true".to_string()),
                include_children: Some("true".to_string()),
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();

        let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let sessions = json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");

        assert_eq!(sessions.len(), 2);
        assert_eq!(json.get("total").and_then(|v| v.as_u64()), Some(2));
        assert_eq!(
            sessions[0].get("id").and_then(|v| v.as_str()),
            Some("newer")
        );
        assert_eq!(
            sessions[1].get("id").and_then(|v| v.as_str()),
            Some("older")
        );
    }

    #[tokio::test]
    async fn session_list_directory_scope_includes_legacy_project_bucket_for_git_dirs() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-list-legacy-project-bucket");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let proj = tmp.join("proj");
        let git_dir = proj.join(".git");
        tokio::fs::create_dir_all(&git_dir).await.unwrap();
        tokio::fs::write(git_dir.join("opencode"), "project_bucket_new")
            .await
            .unwrap();

        let storage = tmp.join("opencode").join("storage");

        write_json(
            &storage
                .join("session")
                .join("project_bucket_old")
                .join("legacy.json"),
            &serde_json::json!({
                "id": "legacy",
                "directory": proj.to_string_lossy(),
                "title": "Legacy",
                "slug": "legacy",
                "time": {"updated": 42.0}
            }),
        )
        .await;

        let resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(proj.to_string_lossy().to_string()),
                scope: Some("directory".to_string()),
                roots: Some("true".to_string()),
                start: None,
                search: None,
                offset: Some("0".to_string()),
                limit: Some("30".to_string()),
                include_total: Some("true".to_string()),
                include_children: Some("true".to_string()),
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();

        let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let sessions = json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");

        assert_eq!(sessions.len(), 1);
        assert_eq!(json.get("total").and_then(|v| v.as_u64()), Some(1));
        assert_eq!(
            sessions[0].get("id").and_then(|v| v.as_str()),
            Some("legacy")
        );
    }

    #[tokio::test]
    async fn session_list_reads_from_sqlite_when_json_storage_is_empty() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-list-sqlite");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let proj = tmp.join("proj");
        tokio::fs::create_dir_all(&proj).await.unwrap();

        let db_path = tmp.join("opencode").join("opencode.db");
        if let Some(parent) = db_path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }

        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "
                CREATE TABLE session (
                  id TEXT PRIMARY KEY,
                  project_id TEXT NOT NULL,
                  parent_id TEXT,
                  slug TEXT NOT NULL,
                  directory TEXT NOT NULL,
                  title TEXT NOT NULL,
                  version TEXT NOT NULL,
                  share_url TEXT,
                  summary_additions INTEGER,
                  summary_deletions INTEGER,
                  summary_files INTEGER,
                  summary_diffs TEXT,
                  revert TEXT,
                  permission TEXT,
                  time_created INTEGER NOT NULL,
                  time_updated INTEGER NOT NULL,
                  time_compacting INTEGER,
                  time_archived INTEGER
                );
                ",
            )
            .unwrap();

            conn.execute(
                "INSERT INTO session (
                    id, project_id, parent_id, slug, directory, title, version,
                    share_url, summary_additions, summary_deletions, summary_files,
                    summary_diffs, revert, permission, time_created, time_updated,
                    time_compacting, time_archived
                ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?7, ?8, NULL, NULL)",
                rusqlite::params![
                    "ses_sqlite",
                    "project_sqlite",
                    "sqlite",
                    proj.to_string_lossy().to_string(),
                    "SQLite Session",
                    "2",
                    1000i64,
                    2000i64
                ],
            )
            .unwrap();
        }

        let resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(proj.to_string_lossy().to_string()),
                scope: Some("directory".to_string()),
                roots: Some("true".to_string()),
                start: None,
                search: None,
                offset: Some("0".to_string()),
                limit: Some("30".to_string()),
                include_total: Some("true".to_string()),
                include_children: Some("true".to_string()),
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();

        let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let sessions = json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");

        assert_eq!(sessions.len(), 1);
        assert_eq!(json.get("total").and_then(|v| v.as_u64()), Some(1));
        assert_eq!(
            sessions[0].get("id").and_then(|v| v.as_str()),
            Some("ses_sqlite")
        );
    }

    #[tokio::test]
    async fn session_list_sqlite_project_scope_filters_by_project_id() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-list-sqlite-project-scope");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let proj = tmp.join("proj");
        let git_dir = proj.join(".git");
        tokio::fs::create_dir_all(&git_dir).await.unwrap();
        tokio::fs::write(git_dir.join("opencode"), "project_sqlite_a")
            .await
            .unwrap();

        let db_path = tmp.join("opencode").join("opencode.db");
        if let Some(parent) = db_path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }

        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "
                CREATE TABLE session (
                  id TEXT PRIMARY KEY,
                  project_id TEXT NOT NULL,
                  parent_id TEXT,
                  slug TEXT NOT NULL,
                  directory TEXT NOT NULL,
                  title TEXT NOT NULL,
                  version TEXT NOT NULL,
                  share_url TEXT,
                  summary_additions INTEGER,
                  summary_deletions INTEGER,
                  summary_files INTEGER,
                  summary_diffs TEXT,
                  revert TEXT,
                  permission TEXT,
                  time_created INTEGER NOT NULL,
                  time_updated INTEGER NOT NULL,
                  time_compacting INTEGER,
                  time_archived INTEGER
                );
                ",
            )
            .unwrap();

            conn.execute(
                "INSERT INTO session (
                    id, project_id, parent_id, slug, directory, title, version,
                    share_url, summary_additions, summary_deletions, summary_files,
                    summary_diffs, revert, permission, time_created, time_updated,
                    time_compacting, time_archived
                ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?7, ?8, NULL, NULL)",
                rusqlite::params![
                    "ses_proj_a",
                    "project_sqlite_a",
                    "proj-a",
                    proj.to_string_lossy().to_string(),
                    "SQLite Session A",
                    "2",
                    1000i64,
                    2000i64
                ],
            )
            .unwrap();

            conn.execute(
                "INSERT INTO session (
                    id, project_id, parent_id, slug, directory, title, version,
                    share_url, summary_additions, summary_deletions, summary_files,
                    summary_diffs, revert, permission, time_created, time_updated,
                    time_compacting, time_archived
                ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?7, ?8, NULL, NULL)",
                rusqlite::params![
                    "ses_proj_b",
                    "project_sqlite_b",
                    "proj-b",
                    proj.to_string_lossy().to_string(),
                    "SQLite Session B",
                    "2",
                    1100i64,
                    2100i64
                ],
            )
            .unwrap();
        }

        let resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(proj.to_string_lossy().to_string()),
                scope: Some("project".to_string()),
                roots: Some("true".to_string()),
                start: None,
                search: None,
                offset: Some("0".to_string()),
                limit: Some("30".to_string()),
                include_total: Some("true".to_string()),
                include_children: Some("true".to_string()),
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();

        let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let sessions = json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");

        assert_eq!(sessions.len(), 1);
        assert_eq!(json.get("total").and_then(|v| v.as_u64()), Some(1));
        assert_eq!(
            sessions[0].get("id").and_then(|v| v.as_str()),
            Some("ses_proj_a")
        );
    }

    #[tokio::test]
    async fn session_list_prunes_session_summary_fields() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-list-prune");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let proj = tmp.join("proj");
        tokio::fs::create_dir_all(&proj).await.unwrap();

        let storage = tmp.join("opencode").join("storage");
        let session_dir = storage.join("session").join("global");

        write_json(
            &session_dir.join("ses_1.json"),
            &serde_json::json!({
                "id": "ses_1",
                "directory": proj.to_string_lossy(),
                "title": "Title",
                "slug": "slug",
                "projectID": "proj_1",
                "summary": {"files": 1},
                "version": 2,
                "parentId": "parent_1",
                "time": {"created": 1.0, "updated": 2.0, "completed": 3.0}
            }),
        )
        .await;

        let resp = session_list(
            State(dummy_state()),
            HeaderMap::new(),
            Query(SessionListQuery {
                directory: Some(proj.to_string_lossy().to_string()),
                scope: None,
                roots: None,
                start: None,
                search: None,
                offset: None,
                limit: None,
                include_total: Some("true".to_string()),
                include_children: None,
                ids: None,
                focus_session_id: None,
            }),
        )
        .await
        .unwrap();

        let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let sessions = json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");
        assert_eq!(sessions.len(), 1);

        let session = sessions[0].as_object().expect("session");
        assert!(session.get("projectID").is_none());
        assert!(session.get("summary").is_none());
        assert!(session.get("version").is_none());
        assert_eq!(
            session.get("parentID").and_then(|v| v.as_str()),
            Some("parent_1")
        );
        assert!(
            session
                .get("time")
                .and_then(|v| v.get("completed"))
                .is_none()
        );
    }

    #[tokio::test]
    async fn session_list_keeps_cached_session_when_file_is_temporarily_partial() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-list-partial-write");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let proj = tmp.join("proj");
        tokio::fs::create_dir_all(&proj).await.unwrap();

        let storage = tmp.join("opencode").join("storage");
        let session_path = storage.join("session").join("global").join("ses_1.json");

        write_json(
            &session_path,
            &serde_json::json!({
                "id": "ses_1",
                "directory": proj.to_string_lossy(),
                "title": "Title",
                "slug": "slug",
                "time": {"updated": 10.0}
            }),
        )
        .await;

        let query_for = || SessionListQuery {
            directory: Some(proj.to_string_lossy().to_string()),
            scope: Some("directory".to_string()),
            roots: Some("true".to_string()),
            start: None,
            search: None,
            offset: Some("0".to_string()),
            limit: Some("30".to_string()),
            include_total: Some("true".to_string()),
            include_children: Some("true".to_string()),
            ids: None,
            focus_session_id: None,
        };

        let state = dummy_state();
        let initial = session_list(State(state.clone()), HeaderMap::new(), Query(query_for()))
            .await
            .unwrap();
        let initial_body = to_bytes(initial.into_body(), 1024 * 1024).await.unwrap();
        let initial_json: serde_json::Value = serde_json::from_slice(&initial_body).unwrap();
        let initial_sessions = initial_json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");
        assert_eq!(initial_sessions.len(), 1);

        let cached = STORAGE_CACHE
            .file_cache
            .get(&session_path)
            .expect("session should be cached after initial fetch");
        let cached_value = cached.value.clone();
        drop(cached);

        // Force a metadata mismatch so read_json_value attempts a fresh parse.
        STORAGE_CACHE.record_file(
            session_path.clone(),
            FileCacheEntry {
                modified: UNIX_EPOCH,
                value: cached_value,
            },
        );

        // Simulate a truncated in-place write from OpenCode.
        tokio::fs::write(&session_path, "{\"id\":\"ses_1\"")
            .await
            .unwrap();

        let follow_up = session_list(State(state), HeaderMap::new(), Query(query_for()))
            .await
            .unwrap();
        let follow_up_body = to_bytes(follow_up.into_body(), 1024 * 1024).await.unwrap();
        let follow_up_json: serde_json::Value = serde_json::from_slice(&follow_up_body).unwrap();
        let follow_up_sessions = follow_up_json
            .get("sessions")
            .and_then(|v| v.as_array())
            .expect("sessions array");

        assert_eq!(follow_up_sessions.len(), 1);
        assert_eq!(
            follow_up_sessions[0].get("id").and_then(|v| v.as_str()),
            Some("ses_1")
        );
        let consistency = follow_up_json
            .get("consistency")
            .and_then(|v| v.as_object())
            .expect("consistency object");
        assert_eq!(
            consistency.get("degraded").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            consistency.get("staleReads").and_then(|v| v.as_u64()),
            Some(1)
        );
    }

    #[tokio::test]
    async fn session_message_get_reads_from_sqlite_with_pagination() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-message-sqlite");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let db_path = tmp.join("opencode").join("opencode.db");
        if let Some(parent) = db_path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }

        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch(
                r#"
                CREATE TABLE message (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  role TEXT NOT NULL,
                  data TEXT NOT NULL,
                  time_created INTEGER NOT NULL,
                  time_updated INTEGER NOT NULL
                );
                CREATE TABLE part (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  message_id TEXT NOT NULL,
                  type TEXT NOT NULL,
                  data TEXT NOT NULL,
                  time_created INTEGER NOT NULL,
                  time_updated INTEGER NOT NULL
                );
                "#,
            )
            .unwrap();

            conn.execute(
                "INSERT INTO message (id, session_id, role, data, time_created, time_updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    "msg_old",
                    "ses_sql",
                    "user",
                    serde_json::json!({
                        "id": "msg_old",
                        "sessionID": "ses_sql",
                        "role": "user",
                        "time": {"created": 10}
                    })
                    .to_string(),
                    10i64,
                    10i64,
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO message (id, session_id, role, data, time_created, time_updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    "msg_new",
                    "ses_sql",
                    "assistant",
                    serde_json::json!({
                        "id": "msg_new",
                        "sessionID": "ses_sql",
                        "role": "assistant",
                        "time": {"created": 20}
                    })
                    .to_string(),
                    20i64,
                    20i64,
                ],
            )
            .unwrap();

            conn.execute(
                "INSERT INTO part (id, session_id, message_id, type, data, time_created, time_updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    "part_new",
                    "ses_sql",
                    "msg_new",
                    "text",
                    serde_json::json!({
                        "id": "part_new",
                        "messageID": "msg_new",
                        "sessionID": "ses_sql",
                        "type": "text",
                        "text": "latest"
                    })
                    .to_string(),
                    20i64,
                    20i64,
                ],
            )
            .unwrap();
        }

        let response = session_message_get(
            State(dummy_state()),
            Query(SessionMessagesQuery {
                offset: Some("0".to_string()),
                limit: Some("1".to_string()),
                include_total: Some("true".to_string()),
            }),
            AxumPath("ses_sql".to_string()),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(payload.get("total").and_then(|v| v.as_u64()), Some(2));
        assert_eq!(payload.get("offset").and_then(|v| v.as_u64()), Some(0));
        assert_eq!(payload.get("limit").and_then(|v| v.as_u64()), Some(1));
        assert_eq!(payload.get("hasMore").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(payload.get("nextOffset").and_then(|v| v.as_u64()), Some(1));

        let entries = payload
            .get("entries")
            .and_then(|v| v.as_array())
            .expect("entries array");
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0]
                .get("info")
                .and_then(|v| v.get("id"))
                .and_then(|v| v.as_str()),
            Some("msg_new")
        );
        assert_eq!(
            entries[0]
                .get("parts")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|v| v.get("partID"))
                .and_then(|v| v.as_str()),
            Some("part_new")
        );
    }

    #[tokio::test]
    async fn session_message_get_falls_back_to_json_when_sqlite_query_fails() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-message-sqlite-fallback");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let db_path = tmp.join("opencode").join("opencode.db");
        if let Some(parent) = db_path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch("CREATE TABLE unrelated (id TEXT PRIMARY KEY);")
                .unwrap();
        }

        let storage = tmp.join("opencode").join("storage");
        write_json(
            &storage.join("message").join("ses_json").join("msg_1.json"),
            &serde_json::json!({
                "id": "msg_1",
                "sessionID": "ses_json",
                "role": "user",
                "time": {"created": 1}
            }),
        )
        .await;
        write_json(
            &storage.join("part").join("msg_1").join("part_1.json"),
            &serde_json::json!({
                "id": "part_1",
                "sessionID": "ses_json",
                "messageID": "msg_1",
                "type": "text",
                "text": "fallback"
            }),
        )
        .await;

        let response = session_message_get(
            State(dummy_state()),
            Query(SessionMessagesQuery {
                offset: Some("0".to_string()),
                limit: Some("30".to_string()),
                include_total: Some("true".to_string()),
            }),
            AxumPath("ses_json".to_string()),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();

        let entries = payload
            .get("entries")
            .and_then(|v| v.as_array())
            .expect("entries array");
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0]
                .get("info")
                .and_then(|v| v.get("id"))
                .and_then(|v| v.as_str()),
            Some("msg_1")
        );

        let consistency = payload
            .get("consistency")
            .and_then(|v| v.as_object())
            .expect("consistency object");
        assert_eq!(
            consistency.get("degraded").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert!(
            consistency
                .get("ioSkips")
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                >= 1
        );
    }

    #[tokio::test]
    async fn session_message_part_get_reads_from_sqlite_when_json_missing() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-message-part-sqlite");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let db_path = tmp.join("opencode").join("opencode.db");
        if let Some(parent) = db_path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }

        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch(
                r#"
                CREATE TABLE message (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  role TEXT NOT NULL,
                  data TEXT NOT NULL,
                  time_created INTEGER NOT NULL,
                  time_updated INTEGER NOT NULL
                );
                CREATE TABLE part (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  message_id TEXT NOT NULL,
                  type TEXT NOT NULL,
                  data TEXT NOT NULL,
                  time_created INTEGER NOT NULL,
                  time_updated INTEGER NOT NULL
                );
                "#,
            )
            .unwrap();

            conn.execute(
                "INSERT INTO message (id, session_id, role, data, time_created, time_updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    "msg_sql",
                    "ses_sql",
                    "assistant",
                    serde_json::json!({
                        "id": "msg_sql",
                        "sessionID": "ses_sql",
                        "role": "assistant",
                        "time": {"created": 20}
                    })
                    .to_string(),
                    20i64,
                    20i64,
                ],
            )
            .unwrap();

            conn.execute(
                "INSERT INTO part (id, session_id, message_id, type, data, time_created, time_updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    "part_sql",
                    "ses_sql",
                    "msg_sql",
                    "tool",
                    serde_json::json!({
                        "id": "part_sql",
                        "sessionID": "ses_sql",
                        "messageID": "msg_sql",
                        "type": "tool",
                        "tool": {"name": "bash", "status": "completed"}
                    })
                    .to_string(),
                    20i64,
                    20i64,
                ],
            )
            .unwrap();
        }

        let response = session_message_part_get(
            State(dummy_state()),
            AxumPath((
                "ses_sql".to_string(),
                "msg_sql".to_string(),
                "part_sql".to_string(),
            )),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload.get("id").and_then(|v| v.as_str()), Some("part_sql"));
        assert_eq!(
            payload.get("sessionID").and_then(|v| v.as_str()),
            Some("ses_sql")
        );
        assert_eq!(
            payload.get("messageID").and_then(|v| v.as_str()),
            Some("msg_sql")
        );
        assert_eq!(
            payload.get("partID").and_then(|v| v.as_str()),
            Some("part_sql")
        );
    }

    #[tokio::test]
    async fn session_message_get_marks_transient_skips_as_degraded() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-message-list-degraded");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let storage = tmp.join("opencode").join("storage");
        let message_dir = storage.join("message").join("ses_1");
        let part_dir = storage.join("part").join("ok_msg");

        write_json(
            &message_dir.join("ok_msg.json"),
            &serde_json::json!({
                "id": "ok_msg",
                "role": "user",
                "time": {"created": 1.0}
            }),
        )
        .await;
        write_json(
            &part_dir.join("part_1.json"),
            &serde_json::json!({
                "id": "part_1",
                "type": "text",
                "text": "hello"
            }),
        )
        .await;

        // Simulate an in-progress write with no cached fallback.
        tokio::fs::write(
            &message_dir.join("broken_msg.json"),
            "{\"id\":\"broken_msg\"",
        )
        .await
        .unwrap();

        let response = session_message_get(
            State(dummy_state()),
            Query(SessionMessagesQuery {
                offset: Some("0".to_string()),
                limit: Some("30".to_string()),
                include_total: Some("true".to_string()),
            }),
            AxumPath("ses_1".to_string()),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let entries = payload
            .get("entries")
            .and_then(|v| v.as_array())
            .expect("entries array");
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0]
                .get("info")
                .and_then(|v| v.get("id"))
                .and_then(|v| v.as_str()),
            Some("ok_msg")
        );

        let consistency = payload
            .get("consistency")
            .and_then(|v| v.as_object())
            .expect("consistency object");
        assert_eq!(
            consistency.get("degraded").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert!(
            consistency
                .get("transientSkips")
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                >= 1
        );
        assert_eq!(
            consistency.get("retryAfterMs").and_then(|v| v.as_u64()),
            Some(DEFAULT_DEGRADED_RETRY_AFTER_MS as u64)
        );
    }

    #[tokio::test]
    async fn session_message_part_get_returns_retryable_for_transient_part_read() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        STORAGE_CACHE.clear();

        let tmp = unique_tmp_dir("session-message-part-transient");
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let storage = tmp.join("opencode").join("storage");
        let message_dir = storage.join("message").join("ses_2");
        let part_dir = storage.join("part").join("msg_1");

        write_json(
            &message_dir.join("msg_1.json"),
            &serde_json::json!({
                "id": "msg_1",
                "role": "assistant",
                "time": {"created": 2.0}
            }),
        )
        .await;
        tokio::fs::create_dir_all(&part_dir).await.unwrap();
        tokio::fs::write(&part_dir.join("part_1.json"), "{\"id\":\"part_1\"")
            .await
            .unwrap();

        let response = session_message_part_get(
            State(dummy_state()),
            AxumPath((
                "ses_2".to_string(),
                "msg_1".to_string(),
                "part_1".to_string(),
            )),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            payload.get("code").and_then(|v| v.as_str()),
            Some("temporarily_unavailable")
        );
        assert_eq!(
            payload.get("retryAfterMs").and_then(|v| v.as_u64()),
            Some(DEFAULT_DEGRADED_RETRY_AFTER_MS as u64)
        );
    }
}
