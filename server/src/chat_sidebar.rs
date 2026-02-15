use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentIndexItem {
    session_id: String,
    directory_id: String,
    directory_path: String,
    updated_at: f64,
}

#[derive(Debug, Serialize)]
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

fn normalize_path_for_match(path: &str) -> Option<String> {
    let normalized = crate::path_utils::normalize_directory_path(path);
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.replace('\\', "/").trim_end_matches('/').to_string())
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

fn session_id(value: &Value) -> Option<String> {
    value
        .get("id")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
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
    let resolved_directory = {
        let settings = state.settings.read().await;
        directory_path_by_id(&settings, &path.directory_id)
    };

    let Some(directory_path) = resolved_directory else {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "directory not found"})),
        )
            .into_response());
    };

    query.directory = Some(directory_path);
    crate::opencode_session::session_list(State(state), headers, Query(query)).await
}

pub(crate) async fn chat_sidebar_recent_index(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<ChatSidebarIndexQuery>,
) -> Response {
    let limit = parse_limit(query.limit, 40, 40);
    let offset = parse_offset(query.offset);

    let mut items = Vec::<RecentIndexItem>::new();
    for recent in state.directory_session_index.recent_sessions_snapshot() {
        items.push(RecentIndexItem {
            session_id: recent.session_id,
            directory_id: recent.directory_id,
            directory_path: recent.directory_path,
            updated_at: recent.updated_at,
        });
    }

    Json(page(items, offset, limit)).into_response()
}

pub(crate) async fn chat_sidebar_running_index(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<ChatSidebarIndexQuery>,
) -> Response {
    let limit = parse_limit(query.limit, 40, 400);
    let offset = parse_offset(query.offset);

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

    Json(page(items, offset, limit)).into_response()
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
    fn page_returns_expected_window() {
        let out = page(vec![1, 2, 3, 4, 5], 1, 2);
        assert_eq!(out.items, vec![2, 3]);
        assert_eq!(out.total, 5);
        assert_eq!(out.offset, 1);
        assert_eq!(out.limit, 2);
        assert!(out.has_more);
        assert_eq!(out.next_offset, Some(3));
    }
}
