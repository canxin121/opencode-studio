use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use axum::{
    Json,
    body::to_bytes,
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const BODY_READ_LIMIT: usize = 10 * 1024 * 1024;
const SIDEBAR_INDEX_CACHE_TTL: Duration = Duration::from_millis(400);
const SIDEBAR_INDEX_CACHE_MAX_RECENT_VARIANTS: usize = 1;
const SIDEBAR_INDEX_CACHE_MAX_RUNNING_VARIANTS: usize = 1;
const DIRECTORY_SESSIONS_PAGE_CACHE_TTL: Duration = Duration::from_millis(1200);
const DIRECTORY_SESSIONS_PAGE_CACHE_MAX_ENTRIES: usize = 256;
const SIDEBAR_STATE_DIRECTORIES_PAGE_SIZE_DEFAULT: usize = 15;
const SIDEBAR_STATE_DIRECTORY_SESSIONS_PAGE_SIZE_DEFAULT: usize = 10;
const SIDEBAR_STATE_FOOTER_PAGE_SIZE_DEFAULT: usize = 10;
const SIDEBAR_RECENT_INDEX_SEED_LIMIT: usize = 40;

#[derive(Debug, Clone)]
struct RecentIndexCacheEntry {
    built_at: Instant,
    patch_seq: u64,
    items: Vec<RecentIndexItem>,
}

#[derive(Debug, Clone)]
struct RunningIndexCacheEntry {
    built_at: Instant,
    patch_seq: u64,
    items: Vec<RunningIndexItem>,
}

#[derive(Debug, Default)]
struct SidebarIndexProjectionCache {
    recent: Option<RecentIndexCacheEntry>,
    running: Option<RunningIndexCacheEntry>,
}

#[derive(Debug, Clone)]
struct DirectorySessionsPageCacheEntry {
    key: String,
    built_at: Instant,
    patch_seq: u64,
    payload: Value,
}

#[derive(Debug, Default)]
struct DirectorySessionsPageCache {
    entries: BTreeMap<String, DirectorySessionsPageCacheEntry>,
    lru: std::collections::VecDeque<String>,
}

static SIDEBAR_INDEX_CACHE: LazyLock<Mutex<SidebarIndexProjectionCache>> =
    LazyLock::new(|| Mutex::new(SidebarIndexProjectionCache::default()));
static DIRECTORY_SESSIONS_PAGE_CACHE: LazyLock<Mutex<DirectorySessionsPageCache>> =
    LazyLock::new(|| Mutex::new(DirectorySessionsPageCache::default()));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryWire {
    id: String,
    path: String,
    added_at: i64,
    last_opened_at: i64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatSidebarIndexQuery {
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatSidebarStateQuery {
    pub directories_page_size: Option<usize>,
    pub directory_sessions_page_size: Option<usize>,
    pub recent_page_size: Option<usize>,
    pub running_page_size: Option<usize>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoriesQuery {
    pub offset: Option<usize>,
    pub limit: Option<usize>,
    pub query: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSummariesByIdsQuery {
    pub ids: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct DirectorySessionsPath {
    pub directory_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PagedIndexResponse<T>
where
    T: Serialize,
{
    items: Vec<T>,
    total: usize,
    offset: usize,
    limit: usize,
    has_more: bool,
    next_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentIndexItem {
    session_id: String,
    directory_id: String,
    directory_path: String,
    updated_at: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunningIndexItem {
    session_id: String,
    directory_id: Option<String>,
    directory_path: Option<String>,
    runtime: Value,
    updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionSummariesByIdsResponse {
    summaries: Vec<Value>,
    missing_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatSidebarStateResponse {
    preferences: crate::chat_sidebar_preferences::SessionsSidebarPreferences,
    seq: u64,
    directories_page: Value,
    session_pages_by_directory_id: BTreeMap<String, Value>,
    runtime_by_session_id: Value,
    recent_page: Value,
    running_page: Value,
}

fn normalize_path_for_match(path: &str) -> Option<String> {
    crate::path_utils::normalize_directory_for_match(path)
}

fn parse_limit(raw: Option<usize>, default_limit: usize, max_limit: usize) -> usize {
    raw.unwrap_or(default_limit).max(1).min(max_limit)
}

fn parse_offset(raw: Option<usize>) -> usize {
    raw.unwrap_or(0)
}

fn parse_ids_csv(raw: Option<&str>) -> Vec<String> {
    raw.unwrap_or("")
        .split(',')
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect()
}

fn parse_bool_param(raw: Option<&str>) -> bool {
    matches!(
        raw.map(|v| v.trim().to_ascii_lowercase()).as_deref(),
        Some("true") | Some("1") | Some("yes") | Some("on")
    )
}

fn cache_key_part(raw: Option<&str>) -> String {
    raw.map(|v| v.trim()).unwrap_or("").to_string()
}

fn directory_sessions_page_cache_key(
    directory_id: &str,
    query: &crate::opencode_session::SessionListQuery,
) -> String {
    [
        format!("directoryId={}", directory_id.trim()),
        format!("scope={}", cache_key_part(query.scope.as_deref())),
        format!("roots={}", cache_key_part(query.roots.as_deref())),
        format!(
            "includeChildren={}",
            cache_key_part(query.include_children.as_deref())
        ),
        format!(
            "includeTotal={}",
            cache_key_part(query.include_total.as_deref())
        ),
        format!("offset={}", cache_key_part(query.offset.as_deref())),
        format!("limit={}", cache_key_part(query.limit.as_deref())),
        format!(
            "focusSessionId={}",
            cache_key_part(query.focus_session_id.as_deref())
        ),
        format!("start={}", cache_key_part(query.start.as_deref())),
        format!("search={}", cache_key_part(query.search.as_deref())),
        format!("ids={}", cache_key_part(query.ids.as_deref())),
    ]
    .join("|")
}

fn is_cacheable_directory_sessions_query(
    query: &crate::opencode_session::SessionListQuery,
) -> bool {
    if query
        .ids
        .as_deref()
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
    {
        return false;
    }
    let scope_ok = query
        .scope
        .as_deref()
        .map(|v| v.trim().eq_ignore_ascii_case("directory"))
        .unwrap_or(false);
    let roots_ok = parse_bool_param(query.roots.as_deref());
    let children_ok = parse_bool_param(query.include_children.as_deref());
    scope_ok && roots_ok && children_ok
}

impl DirectorySessionsPageCache {
    fn get_fresh(&mut self, key: &str, patch_seq: u64) -> Option<Value> {
        let stale_keys = self
            .entries
            .iter()
            .filter_map(|(entry_key, entry)| {
                if entry.patch_seq != patch_seq
                    || entry.built_at.elapsed() > DIRECTORY_SESSIONS_PAGE_CACHE_TTL
                {
                    Some(entry_key.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        for stale in stale_keys {
            self.entries.remove(&stale);
            self.lru.retain(|k| k != &stale);
        }

        let payload = self.entries.get(key)?.payload.clone();
        self.lru.retain(|k| k != key);
        self.lru.push_back(key.to_string());
        Some(payload)
    }

    fn insert(&mut self, entry: DirectorySessionsPageCacheEntry) {
        let key = entry.key.clone();
        self.entries.insert(key.clone(), entry);
        self.lru.retain(|k| k != &key);
        self.lru.push_back(key.clone());

        while self.entries.len() > DIRECTORY_SESSIONS_PAGE_CACHE_MAX_ENTRIES {
            let Some(oldest) = self.lru.pop_front() else {
                break;
            };
            self.entries.remove(&oldest);
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

fn page<T>(items: Vec<T>, offset: usize, limit: usize) -> PagedIndexResponse<T>
where
    T: Serialize,
{
    let total = items.len();
    let clamped_offset = offset.min(total);
    let end = clamped_offset.saturating_add(limit).min(total);
    let paged = if clamped_offset < end {
        items.into_iter().skip(clamped_offset).take(limit).collect()
    } else {
        Vec::new()
    };
    let has_more = end < total;
    let next_offset = if has_more { Some(end) } else { None };
    PagedIndexResponse {
        items: paged,
        total,
        offset: clamped_offset,
        limit,
        has_more,
        next_offset,
    }
}

fn configured_directories(settings: &crate::settings::Settings) -> Vec<DirectoryWire> {
    let mut out = Vec::<DirectoryWire>::new();
    for project in settings.projects.iter() {
        let id = project.id.trim();
        let path = project.path.trim();
        if id.is_empty() || path.is_empty() {
            continue;
        }
        out.push(DirectoryWire {
            id: id.to_string(),
            path: path.to_string(),
            added_at: project.added_at,
            last_opened_at: project.last_opened_at,
        });
    }
    out
}

fn directory_path_by_id(
    settings: &crate::settings::Settings,
    directory_id: &str,
) -> Option<String> {
    let wanted = directory_id.trim();
    if wanted.is_empty() {
        return None;
    }
    settings
        .projects
        .iter()
        .find(|project| project.id.trim() == wanted)
        .map(|project| project.path.trim().to_string())
        .filter(|path| !path.is_empty())
}

async fn decode_json_response(response: Response) -> Option<Value> {
    if !response.status().is_success() {
        return None;
    }
    let bytes = to_bytes(response.into_body(), BODY_READ_LIMIT).await.ok()?;
    serde_json::from_slice::<Value>(&bytes).ok()
}

fn extract_sessions(payload: &Value) -> Vec<Value> {
    if let Some(list) = payload.as_array() {
        return list.to_vec();
    }
    payload
        .get("sessions")
        .and_then(|value| value.as_array())
        .map(|list| list.to_vec())
        .unwrap_or_default()
}

fn session_parent_id(value: &Value) -> Option<String> {
    value
        .get("parentID")
        .or_else(|| value.get("parentId"))
        .or_else(|| value.get("parent_id"))
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn expanded_directory_ids(
    directories: &[DirectoryWire],
    collapsed_directory_ids: &[String],
) -> Vec<String> {
    let collapsed = collapsed_directory_ids
        .iter()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect::<HashSet<String>>();
    directories
        .iter()
        .filter_map(|directory| {
            if collapsed.contains(directory.id.trim()) {
                None
            } else {
                Some(directory.id.clone())
            }
        })
        .collect()
}

fn page_to_offset(page: usize, page_size: usize) -> usize {
    page.saturating_mul(page_size)
}

fn attach_directory_tree_hint(payload: &mut Value) {
    let Some(obj) = payload.as_object_mut() else {
        return;
    };
    let Some(sessions) = obj.get("sessions").and_then(|v| v.as_array()) else {
        return;
    };

    let mut root_ids = Vec::<String>::new();
    let mut children = BTreeMap::<String, Vec<String>>::new();
    for session in sessions {
        let Some(session_id) = session_id(session) else {
            continue;
        };
        if let Some(parent_id) = session_parent_id(session) {
            children.entry(parent_id).or_default().push(session_id);
        } else {
            root_ids.push(session_id);
        }
    }

    for list in children.values_mut() {
        list.sort();
        list.dedup();
    }

    obj.insert(
        "treeHint".to_string(),
        json!({
            "rootSessionIds": root_ids,
            "childrenByParentSessionId": children,
        }),
    );
}

async fn read_json_success_response(response: Response) -> Option<Value> {
    if !response.status().is_success() {
        return None;
    }
    let bytes = to_bytes(response.into_body(), BODY_READ_LIMIT).await.ok()?;
    serde_json::from_slice::<Value>(&bytes).ok()
}

fn session_id(value: &Value) -> Option<String> {
    value
        .get("id")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn cache_entry_is_fresh(entry_patch_seq: u64, now_patch_seq: u64, built_at: Instant) -> bool {
    entry_patch_seq == now_patch_seq && built_at.elapsed() <= SIDEBAR_INDEX_CACHE_TTL
}

fn bounded_variant_len(kind: &str) -> usize {
    match kind {
        "recent" => SIDEBAR_INDEX_CACHE_MAX_RECENT_VARIANTS,
        "running" => SIDEBAR_INDEX_CACHE_MAX_RUNNING_VARIANTS,
        _ => 0,
    }
}

fn build_recent_index_items(state: &Arc<crate::AppState>) -> Vec<RecentIndexItem> {
    let mut items = Vec::<RecentIndexItem>::new();
    for recent in state.directory_session_index.recent_sessions_snapshot() {
        items.push(RecentIndexItem {
            session_id: recent.session_id,
            directory_id: recent.directory_id,
            directory_path: recent.directory_path,
            updated_at: recent.updated_at,
        });
    }
    items
}

async fn build_running_index_items(state: &Arc<crate::AppState>) -> Vec<RunningIndexItem> {
    let directories = {
        let settings = state.settings.read().await;
        configured_directories(&settings)
    };

    let mut directory_id_by_normalized_path = BTreeMap::<String, String>::new();
    for directory in directories {
        if let Some(path_key) = normalize_path_for_match(&directory.path) {
            directory_id_by_normalized_path.insert(path_key, directory.id);
        }
    }

    let runtime = state.directory_session_index.runtime_snapshot_json();
    let mut items = Vec::<RunningIndexItem>::new();

    if let Some(map) = runtime.as_object() {
        for (session_id, runtime) in map {
            let sid = session_id.trim();
            if sid.is_empty() {
                continue;
            }

            let effective_type = runtime
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("idle");
            if effective_type == "idle" {
                continue;
            }

            let directory_path = state.directory_session_index.directory_for_session(sid);
            let directory_id = directory_path
                .as_deref()
                .and_then(normalize_path_for_match)
                .and_then(|path_key| directory_id_by_normalized_path.get(&path_key).cloned());
            let updated_at = runtime
                .get("updatedAt")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);

            items.push(RunningIndexItem {
                session_id: sid.to_string(),
                directory_id,
                directory_path,
                runtime: runtime.clone(),
                updated_at,
            });
        }
    }

    items.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.session_id.cmp(&b.session_id))
    });
    items
}

pub(crate) async fn chat_sidebar_bootstrap(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<crate::directory_sessions::DirectorySessionsBootstrapQuery>,
) -> Response {
    crate::directory_sessions::directory_sessions_bootstrap(State(state), Query(query)).await
}

pub(crate) async fn chat_sidebar_events(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(query): Query<crate::directory_sessions::DirectorySessionsEventsQuery>,
) -> Response {
    crate::directory_sessions::directory_sessions_events(State(state), headers, Query(query)).await
}

pub(crate) async fn directories_get(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<DirectoriesQuery>,
) -> Response {
    let limit = parse_limit(query.limit, 50, 400);
    let offset = parse_offset(query.offset);
    let query_norm = query.query.unwrap_or_default().trim().to_lowercase();

    let settings = state.settings.read().await;
    let mut items = configured_directories(&settings);
    if !query_norm.is_empty() {
        items.retain(|entry| {
            entry.id.to_lowercase().contains(&query_norm)
                || entry.path.to_lowercase().contains(&query_norm)
        });
    }
    Json(page(items, offset, limit)).into_response()
}

pub(crate) async fn directory_sessions_by_id_get(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    AxumPath(path): AxumPath<DirectorySessionsPath>,
    Query(mut query): Query<crate::opencode_session::SessionListQuery>,
) -> crate::ApiResult<Response> {
    let directory_id = path.directory_id.trim().to_string();
    if directory_id.is_empty() {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "directory not found"})),
        )
            .into_response());
    }

    let resolved_directory = {
        let settings = state.settings.read().await;
        directory_path_by_id(&settings, &directory_id)
    };

    let Some(directory_path) = resolved_directory else {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "directory not found"})),
        )
            .into_response());
    };

    query.directory = Some(directory_path);

    let cacheable = is_cacheable_directory_sessions_query(&query);
    let patch_seq = crate::directory_sessions::directory_sessions_latest_seq();
    let cache_key = directory_sessions_page_cache_key(&directory_id, &query);

    if cacheable
        && let Ok(mut cache) = DIRECTORY_SESSIONS_PAGE_CACHE.lock()
        && let Some(payload) = cache.get_fresh(&cache_key, patch_seq)
    {
        return Ok(Json(payload).into_response());
    }

    let response =
        crate::opencode_session::session_list(State(state), headers, Query(query)).await?;
    if !cacheable {
        return Ok(response);
    }

    let Some(mut payload) = read_json_success_response(response).await else {
        return Ok((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "invalid directory sessions response"})),
        )
            .into_response());
    };
    attach_directory_tree_hint(&mut payload);

    if let Ok(mut cache) = DIRECTORY_SESSIONS_PAGE_CACHE.lock() {
        cache.insert(DirectorySessionsPageCacheEntry {
            key: cache_key,
            built_at: Instant::now(),
            patch_seq,
            payload: payload.clone(),
        });
    }

    Ok(Json(payload).into_response())
}

pub(crate) async fn chat_sidebar_recent_index(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<ChatSidebarIndexQuery>,
) -> Response {
    let limit = parse_limit(query.limit, 40, 40);
    let offset = parse_offset(query.offset);

    let patch_seq = crate::directory_sessions::directory_sessions_latest_seq();
    let mut items = if let Ok(cache) = SIDEBAR_INDEX_CACHE.lock() {
        if let Some(entry) = cache.recent.as_ref() {
            if cache_entry_is_fresh(entry.patch_seq, patch_seq, entry.built_at) {
                entry.items.clone()
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    if items.is_empty() {
        items = build_recent_index_items(&state);
        if let Ok(mut cache) = SIDEBAR_INDEX_CACHE.lock()
            && bounded_variant_len("recent") > 0
        {
            cache.recent = Some(RecentIndexCacheEntry {
                built_at: Instant::now(),
                patch_seq,
                items: items.clone(),
            });
        }
    }

    Json(page(items, offset, limit)).into_response()
}

pub(crate) async fn chat_sidebar_running_index(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<ChatSidebarIndexQuery>,
) -> Response {
    let limit = parse_limit(query.limit, 40, 400);
    let offset = parse_offset(query.offset);

    let patch_seq = crate::directory_sessions::directory_sessions_latest_seq();
    let mut items = if let Ok(cache) = SIDEBAR_INDEX_CACHE.lock() {
        if let Some(entry) = cache.running.as_ref() {
            if cache_entry_is_fresh(entry.patch_seq, patch_seq, entry.built_at) {
                entry.items.clone()
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    if items.is_empty() {
        items = build_running_index_items(&state).await;
        if let Ok(mut cache) = SIDEBAR_INDEX_CACHE.lock()
            && bounded_variant_len("running") > 0
        {
            cache.running = Some(RunningIndexCacheEntry {
                built_at: Instant::now(),
                patch_seq,
                items: items.clone(),
            });
        }
    }

    Json(page(items, offset, limit)).into_response()
}

pub(crate) async fn chat_sidebar_state(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<ChatSidebarStateQuery>,
) -> crate::ApiResult<Response> {
    let preferences = crate::chat_sidebar_preferences::chat_sidebar_preferences_snapshot().await;
    let seq = crate::directory_sessions::directory_sessions_latest_seq();
    let runtime_by_session_id = state.directory_session_index.runtime_snapshot_json();

    let directories_page_size = parse_limit(
        query.directories_page_size,
        SIDEBAR_STATE_DIRECTORIES_PAGE_SIZE_DEFAULT,
        400,
    );
    let directory_sessions_page_size = parse_limit(
        query.directory_sessions_page_size,
        SIDEBAR_STATE_DIRECTORY_SESSIONS_PAGE_SIZE_DEFAULT,
        200,
    );
    let recent_page_size = parse_limit(
        query.recent_page_size,
        SIDEBAR_STATE_FOOTER_PAGE_SIZE_DEFAULT,
        40,
    );
    let running_page_size = parse_limit(
        query.running_page_size,
        SIDEBAR_STATE_FOOTER_PAGE_SIZE_DEFAULT,
        400,
    );

    let directories_offset = page_to_offset(preferences.directories_page, directories_page_size);
    let directories_page_response = directories_get(
        State(state.clone()),
        Query(DirectoriesQuery {
            offset: Some(directories_offset),
            limit: Some(directories_page_size),
            query: None,
        }),
    )
    .await;
    let Some(directories_page) = decode_json_response(directories_page_response).await else {
        return Ok((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "invalid directories response"})),
        )
            .into_response());
    };

    let configured = {
        let settings = state.settings.read().await;
        configured_directories(&settings)
    };
    state.directory_session_index.replace_directory_mappings(
        configured
            .iter()
            .map(|directory| (directory.id.clone(), directory.path.clone()))
            .collect(),
    );
    let should_seed_recent_index = state
        .directory_session_index
        .recent_sessions_snapshot()
        .is_empty();
    let expanded_ids = expanded_directory_ids(&configured, &preferences.collapsed_directory_ids);
    let expanded_id_set = expanded_ids.iter().cloned().collect::<HashSet<String>>();

    let mut session_pages_by_directory_id = BTreeMap::<String, Value>::new();
    for directory_id in expanded_ids {
        let root_page = preferences
            .session_root_page_by_directory_id
            .get(&directory_id)
            .copied()
            .unwrap_or(0);
        let directory_response = directory_sessions_by_id_get(
            State(state.clone()),
            HeaderMap::new(),
            AxumPath(DirectorySessionsPath {
                directory_id: directory_id.clone(),
            }),
            Query(crate::opencode_session::SessionListQuery {
                directory: None,
                scope: Some("directory".to_string()),
                roots: Some("true".to_string()),
                start: None,
                search: None,
                offset: Some(page_to_offset(root_page, directory_sessions_page_size).to_string()),
                limit: Some(directory_sessions_page_size.to_string()),
                include_total: Some("true".to_string()),
                include_children: Some("true".to_string()),
                ids: None,
                focus_session_id: None,
            }),
        )
        .await?;
        let Some(directory_page) = decode_json_response(directory_response).await else {
            return Ok((
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": "invalid directory sessions response",
                    "directoryId": directory_id,
                })),
            )
                .into_response());
        };
        session_pages_by_directory_id.insert(directory_id, directory_page);
    }

    if should_seed_recent_index {
        for directory in configured
            .iter()
            .filter(|directory| !expanded_id_set.contains(&directory.id))
        {
            let response = match directory_sessions_by_id_get(
                State(state.clone()),
                HeaderMap::new(),
                AxumPath(DirectorySessionsPath {
                    directory_id: directory.id.clone(),
                }),
                Query(crate::opencode_session::SessionListQuery {
                    directory: None,
                    scope: Some("directory".to_string()),
                    roots: Some("true".to_string()),
                    start: None,
                    search: None,
                    offset: Some("0".to_string()),
                    limit: Some(SIDEBAR_RECENT_INDEX_SEED_LIMIT.to_string()),
                    include_total: Some("false".to_string()),
                    include_children: Some("true".to_string()),
                    ids: None,
                    focus_session_id: None,
                }),
            )
            .await
            {
                Ok(response) => response,
                Err(_) => continue,
            };

            let Some(payload) = decode_json_response(response).await else {
                continue;
            };
            for session in extract_sessions(&payload) {
                state
                    .directory_session_index
                    .upsert_summary_from_value(&session);
            }
        }
    }

    let recent_page_response = chat_sidebar_recent_index(
        State(state.clone()),
        Query(ChatSidebarIndexQuery {
            offset: Some(page_to_offset(
                preferences.recent_sessions_page,
                recent_page_size,
            )),
            limit: Some(recent_page_size),
        }),
    )
    .await;
    let Some(recent_page) = decode_json_response(recent_page_response).await else {
        return Ok((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "invalid recent index response"})),
        )
            .into_response());
    };

    let running_page_response = chat_sidebar_running_index(
        State(state),
        Query(ChatSidebarIndexQuery {
            offset: Some(page_to_offset(
                preferences.running_sessions_page,
                running_page_size,
            )),
            limit: Some(running_page_size),
        }),
    )
    .await;
    let Some(running_page) = decode_json_response(running_page_response).await else {
        return Ok((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "invalid running index response"})),
        )
            .into_response());
    };

    Ok(Json(ChatSidebarStateResponse {
        preferences,
        seq,
        directories_page,
        session_pages_by_directory_id,
        runtime_by_session_id,
        recent_page,
        running_page,
    })
    .into_response())
}

pub(crate) async fn sessions_summaries_get(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<SessionSummariesByIdsQuery>,
) -> Response {
    let ids = parse_ids_csv(query.ids.as_deref());
    if ids.is_empty() {
        return Json(SessionSummariesByIdsResponse {
            summaries: Vec::new(),
            missing_ids: Vec::new(),
        })
        .into_response();
    }

    let mut summaries_by_id = BTreeMap::<String, Value>::new();
    for id in &ids {
        if let Some(summary) = state.directory_session_index.summary(id) {
            summaries_by_id.insert(id.clone(), summary.raw);
        }
    }

    let mut missing: Vec<String> = ids
        .iter()
        .filter(|id| !summaries_by_id.contains_key(*id))
        .cloned()
        .collect();

    if !missing.is_empty() {
        let directories = {
            let settings = state.settings.read().await;
            configured_directories(&settings)
        };

        for directory in directories {
            if missing.is_empty() {
                break;
            }
            let ids_csv = missing.join(",");
            let query = crate::opencode_session::SessionListQuery {
                directory: Some(directory.path),
                scope: Some("directory".to_string()),
                roots: None,
                start: None,
                search: None,
                offset: None,
                limit: None,
                include_total: None,
                include_children: None,
                ids: Some(ids_csv),
                focus_session_id: None,
            };

            let response = match crate::opencode_session::session_list(
                State(state.clone()),
                HeaderMap::new(),
                Query(query),
            )
            .await
            {
                Ok(response) => response,
                Err(_) => continue,
            };
            let Some(payload) = decode_json_response(response).await else {
                continue;
            };

            for session in extract_sessions(&payload) {
                let Some(session_id) = session_id(&session) else {
                    continue;
                };
                summaries_by_id.insert(session_id, session);
            }

            let found_ids: HashSet<String> = summaries_by_id.keys().cloned().collect();
            missing.retain(|id| !found_ids.contains(id));
        }
    }

    let summaries = ids
        .iter()
        .filter_map(|id| summaries_by_id.get(id).cloned())
        .collect::<Vec<_>>();

    Json(SessionSummariesByIdsResponse {
        summaries,
        missing_ids: missing,
    })
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn parse_ids_csv_drops_empty_values() {
        let ids = parse_ids_csv(Some(" a, ,b,, c "));
        assert_eq!(ids, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }

    #[test]
    fn normalize_path_for_match_trims_and_normalizes() {
        let normalized = normalize_path_for_match("/tmp/demo//").expect("normalized");
        assert_eq!(normalized, "/tmp/demo");
    }

    #[test]
    fn normalize_path_for_match_windows_drive_is_case_insensitive() {
        let normalized = normalize_path_for_match("C:\\Users\\Alice\\Repo\\").expect("normalized");
        assert_eq!(normalized, "c:/users/alice/repo");
    }

    #[test]
    fn normalize_path_for_match_linux_remains_case_sensitive() {
        let normalized = normalize_path_for_match("/home/Alice/Repo/").expect("normalized");
        assert_eq!(normalized, "/home/Alice/Repo");
    }

    #[test]
    fn page_returns_expected_window() {
        let out = page(vec![1, 2, 3, 4, 5], 1, 2);
        assert_eq!(out.items, vec![2, 3]);
        assert_eq!(out.total, 5);
        assert_eq!(out.offset, 1);
        assert_eq!(out.limit, 2);
        assert!(out.has_more);
        assert_eq!(out.next_offset, Some(3));
    }

    #[test]
    fn cache_entry_is_fresh_requires_matching_patch_seq_and_ttl() {
        let fresh = cache_entry_is_fresh(10, 10, Instant::now());
        assert!(fresh);

        let stale_seq = cache_entry_is_fresh(9, 10, Instant::now());
        assert!(!stale_seq);

        let stale_age = cache_entry_is_fresh(
            10,
            10,
            Instant::now() - SIDEBAR_INDEX_CACHE_TTL - Duration::from_millis(5),
        );
        assert!(!stale_age);
    }

    #[test]
    fn bounded_variant_len_is_fixed_and_bounded() {
        assert_eq!(
            bounded_variant_len("recent"),
            SIDEBAR_INDEX_CACHE_MAX_RECENT_VARIANTS
        );
        assert_eq!(
            bounded_variant_len("running"),
            SIDEBAR_INDEX_CACHE_MAX_RUNNING_VARIANTS
        );
        assert_eq!(bounded_variant_len("unknown"), 0);
        assert_eq!(SIDEBAR_INDEX_CACHE_MAX_RECENT_VARIANTS, 1);
        assert_eq!(SIDEBAR_INDEX_CACHE_MAX_RUNNING_VARIANTS, 1);
    }

    #[test]
    fn directory_sessions_page_cache_key_covers_core_query_fields() {
        let query = crate::opencode_session::SessionListQuery {
            directory: None,
            scope: Some("directory".to_string()),
            roots: Some("true".to_string()),
            start: Some("cursor".to_string()),
            search: Some("abc".to_string()),
            offset: Some("20".to_string()),
            limit: Some("10".to_string()),
            include_total: Some("true".to_string()),
            include_children: Some("true".to_string()),
            ids: None,
            focus_session_id: Some("ses_focus".to_string()),
        };

        let key = directory_sessions_page_cache_key("dir_1", &query);
        assert!(key.contains("directoryId=dir_1"));
        assert!(key.contains("scope=directory"));
        assert!(key.contains("roots=true"));
        assert!(key.contains("includeChildren=true"));
        assert!(key.contains("includeTotal=true"));
        assert!(key.contains("offset=20"));
        assert!(key.contains("limit=10"));
        assert!(key.contains("focusSessionId=ses_focus"));
    }

    #[test]
    fn directory_sessions_page_cache_is_bounded_and_seq_aware() {
        let mut cache = DirectorySessionsPageCache::default();
        for i in 0..(DIRECTORY_SESSIONS_PAGE_CACHE_MAX_ENTRIES + 4) {
            cache.insert(DirectorySessionsPageCacheEntry {
                key: format!("k_{i}"),
                built_at: Instant::now(),
                patch_seq: 10,
                payload: json!({"i": i}),
            });
        }

        assert_eq!(cache.len(), DIRECTORY_SESSIONS_PAGE_CACHE_MAX_ENTRIES);
        assert!(cache.get_fresh("k_0", 10).is_none());
        assert!(cache.get_fresh("k_4", 10).is_some());
        assert!(cache.get_fresh("k_4", 11).is_none());
    }

    #[test]
    fn directory_sessions_page_cache_ttl_expires_entries() {
        let mut cache = DirectorySessionsPageCache::default();
        cache.insert(DirectorySessionsPageCacheEntry {
            key: "fresh".to_string(),
            built_at: Instant::now(),
            patch_seq: 7,
            payload: json!({"ok": true}),
        });
        cache.insert(DirectorySessionsPageCacheEntry {
            key: "stale".to_string(),
            built_at: Instant::now() - DIRECTORY_SESSIONS_PAGE_CACHE_TTL - Duration::from_millis(5),
            patch_seq: 7,
            payload: json!({"ok": false}),
        });

        assert!(cache.get_fresh("stale", 7).is_none());
        assert!(cache.get_fresh("fresh", 7).is_some());
    }

    #[test]
    fn attach_directory_tree_hint_extracts_roots_and_children() {
        let mut payload = json!({
            "sessions": [
                {"id": "root_a"},
                {"id": "child_a", "parentID": "root_a"},
                {"id": "child_b", "parentId": "root_a"}
            ]
        });

        attach_directory_tree_hint(&mut payload);

        let tree = payload
            .get("treeHint")
            .and_then(|v| v.as_object())
            .expect("treeHint object");
        let roots = tree
            .get("rootSessionIds")
            .and_then(|v| v.as_array())
            .expect("rootSessionIds");
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].as_str(), Some("root_a"));

        let children = tree
            .get("childrenByParentSessionId")
            .and_then(|v| v.as_object())
            .expect("children map");
        let root_children = children
            .get("root_a")
            .and_then(|v| v.as_array())
            .expect("root children");
        assert_eq!(root_children.len(), 2);
    }

    #[test]
    fn expanded_directory_ids_excludes_collapsed_entries() {
        let directories = vec![
            DirectoryWire {
                id: "dir_a".to_string(),
                path: "/tmp/a".to_string(),
                added_at: 0,
                last_opened_at: 0,
            },
            DirectoryWire {
                id: "dir_b".to_string(),
                path: "/tmp/b".to_string(),
                added_at: 0,
                last_opened_at: 0,
            },
        ];

        let expanded = expanded_directory_ids(&directories, &[" dir_b ".to_string()]);
        assert_eq!(expanded, vec!["dir_a".to_string()]);
    }

    #[test]
    fn page_to_offset_saturates() {
        assert_eq!(page_to_offset(3, 10), 30);
        assert_eq!(page_to_offset(usize::MAX, 2), usize::MAX);
    }
}
