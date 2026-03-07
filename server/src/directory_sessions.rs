use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use axum::{
    body::to_bytes,
    extract::{Query, State},
    http::HeaderMap,
};
use futures_util::stream::{self as futures_stream, StreamExt as _};
use serde::Serialize;
use serde_json::{Map, Value, json};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntryWire {
    id: String,
    path: String,
    added_at: i64,
    last_opened_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionTreeHintWire {
    root_session_ids: Vec<String>,
    children_by_parent_session_id: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionPageWire {
    offset: usize,
    limit: usize,
    total: usize,
    sessions: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consistency: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tree_hint: Option<SessionTreeHintWire>,
}

#[derive(Debug, Default, Clone)]
struct SidebarSnapshot {
    directories: BTreeMap<String, Value>,
    sessions: BTreeMap<String, Value>,
    runtime: BTreeMap<String, Value>,
}

#[derive(Debug, Default, Clone)]
struct SnapshotBundle {
    snapshot: SidebarSnapshot,
    fetched_directory_ids: HashSet<String>,
}

#[derive(Debug, Default)]
struct SnapshotDelta {
    changed_count: usize,
    removed_session_ids: Vec<String>,
    changed_directory_ids: Vec<String>,
    changed_session_ids: Vec<String>,
    changed_runtime_session_ids: Vec<String>,
}

struct DirectorySessionsEventHub {
    next_seq: AtomicU64,
    poller_started: AtomicBool,
}

const DIRECTORY_SESSIONS_LIMIT_DEFAULT: usize = 10;
const DIRECTORY_SESSIONS_INTERNAL_BODY_LIMIT: usize = 5 * 1024 * 1024;

impl DirectorySessionsEventHub {
    fn new() -> Self {
        Self {
            next_seq: AtomicU64::new(1),
            poller_started: AtomicBool::new(false),
        }
    }

    fn latest_seq(&self) -> u64 {
        self.next_seq.load(Ordering::Relaxed).saturating_sub(1)
    }

    fn bump_seq(&self) -> u64 {
        self.next_seq.fetch_add(1, Ordering::SeqCst)
    }

    fn mark_poller_started(&self) -> bool {
        !self.poller_started.swap(true, Ordering::SeqCst)
    }
}

static EVENT_HUB: LazyLock<DirectorySessionsEventHub> =
    LazyLock::new(DirectorySessionsEventHub::new);

pub(crate) fn directory_sessions_latest_seq() -> u64 {
    EVENT_HUB.latest_seq()
}

pub(crate) fn ensure_directory_sessions_poller_started(state: Arc<crate::AppState>) {
    start_directory_sessions_poller_if_needed(state);
}

const DIRECTORY_SESSIONS_FETCH_CONCURRENCY: usize = 6;

fn sanitize_session_summary_list(sessions: Vec<Value>) -> Vec<Value> {
    sessions
        .into_iter()
        .filter_map(|mut session| {
            if crate::opencode_proxy::prune_session_summary_value(&mut session) {
                Some(session)
            } else {
                None
            }
        })
        .collect()
}

fn session_summary_id(value: &Value) -> Option<String> {
    value
        .get("id")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn session_summary_parent_id(value: &Value) -> Option<String> {
    value
        .get("parentID")
        .or_else(|| value.get("parentId"))
        .or_else(|| value.get("parent_id"))
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn extract_session_tree_hint(sessions: &[Value]) -> Option<SessionTreeHintWire> {
    let session_ids = sessions
        .iter()
        .filter_map(session_summary_id)
        .collect::<HashSet<_>>();

    if session_ids.is_empty() {
        return None;
    }

    let mut root_session_ids = Vec::<String>::new();
    let mut children_by_parent_session_id = BTreeMap::<String, Vec<String>>::new();

    for session in sessions {
        let Some(session_id) = session_summary_id(session) else {
            continue;
        };
        let parent_id = session_summary_parent_id(session);
        if let Some(parent_id) = parent_id
            && session_ids.contains(&parent_id)
        {
            children_by_parent_session_id
                .entry(parent_id)
                .or_default()
                .push(session_id);
            continue;
        }
        root_session_ids.push(session_id);
    }

    root_session_ids.sort();
    root_session_ids.dedup();
    for child_ids in children_by_parent_session_id.values_mut() {
        child_ids.sort();
        child_ids.dedup();
    }

    if root_session_ids.is_empty() && children_by_parent_session_id.is_empty() {
        None
    } else {
        Some(SessionTreeHintWire {
            root_session_ids,
            children_by_parent_session_id,
        })
    }
}

fn parse_session_page(payload: &Value, limit: usize) -> SessionPageWire {
    if let Some(list) = payload.as_array() {
        let sessions = sanitize_session_summary_list(list.to_vec());
        let tree_hint = extract_session_tree_hint(&sessions);
        return SessionPageWire {
            offset: 0,
            limit,
            total: sessions.len(),
            sessions,
            consistency: None,
            tree_hint,
        };
    }

    let sessions = payload
        .get("sessions")
        .and_then(|v| v.as_array())
        .map(|arr| arr.to_vec())
        .unwrap_or_default();
    let sessions = sanitize_session_summary_list(sessions);
    let total = payload
        .get("total")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(sessions.len());
    let offset = payload
        .get("offset")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(0);
    let resolved_limit = payload
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(limit);
    let consistency = payload
        .get("consistency")
        .and_then(|v| v.as_object())
        .map(|obj| Value::Object(obj.clone()));
    let tree_hint = extract_session_tree_hint(&sessions);

    SessionPageWire {
        offset,
        limit: resolved_limit,
        total,
        sessions,
        consistency,
        tree_hint,
    }
}

fn degraded_page_consistency() -> Value {
    json!({
        "degraded": true,
        "retryAfterMs": 180,
    })
}

fn degraded_session_page(limit: usize) -> SessionPageWire {
    SessionPageWire {
        offset: 0,
        limit,
        total: 0,
        sessions: Vec::new(),
        consistency: Some(degraded_page_consistency()),
        tree_hint: None,
    }
}

async fn fetch_directory_session_page(
    state: Arc<crate::AppState>,
    directory_path: String,
    limit_per_directory: usize,
) -> (SessionPageWire, bool) {
    let query = crate::opencode_session::SessionListQuery {
        directory: Some(directory_path),
        scope: Some("directory".to_string()),
        roots: Some("true".to_string()),
        start: None,
        search: None,
        offset: Some("0".to_string()),
        limit: Some(limit_per_directory.to_string()),
        include_total: Some("true".to_string()),
        include_children: Some("true".to_string()),
        ids: None,
        focus_session_id: None,
    };

    let response =
        match crate::opencode_session::session_list(State(state), HeaderMap::new(), Query(query))
            .await
        {
            Ok(response) => response,
            Err(_) => return (degraded_session_page(limit_per_directory), false),
        };

    if !response.status().is_success() {
        return (degraded_session_page(limit_per_directory), false);
    }

    let body = match to_bytes(response.into_body(), DIRECTORY_SESSIONS_INTERNAL_BODY_LIMIT).await {
        Ok(body) => body,
        Err(_) => return (degraded_session_page(limit_per_directory), false),
    };

    let payload = match serde_json::from_slice::<Value>(&body) {
        Ok(payload) => payload,
        Err(_) => return (degraded_session_page(limit_per_directory), false),
    };

    (parse_session_page(&payload, limit_per_directory), true)
}

fn build_directory_entries(settings: &crate::settings::Settings) -> Vec<DirectoryEntryWire> {
    let mut out = Vec::<DirectoryEntryWire>::new();
    for entry in settings.projects.iter() {
        let id = entry.id.trim();
        let path = entry.path.trim();
        if id.is_empty() || path.is_empty() {
            continue;
        }
        out.push(DirectoryEntryWire {
            id: id.to_string(),
            path: path.to_string(),
            added_at: entry.added_at,
            last_opened_at: entry.last_opened_at,
        });
    }
    out
}

fn snapshot_from_parts(
    entries: &[DirectoryEntryWire],
    pages_by_directory_id: &Map<String, Value>,
    runtime_by_session_id: &Value,
) -> SidebarSnapshot {
    let mut directories = BTreeMap::<String, Value>::new();
    let mut sessions = BTreeMap::<String, Value>::new();
    let mut runtime = BTreeMap::<String, Value>::new();

    for entry in entries {
        directories.insert(entry.id.clone(), json!(entry));
    }

    for page in pages_by_directory_id.values() {
        let list = page
            .get("sessions")
            .and_then(|v| v.as_array())
            .map(|arr| arr.to_vec())
            .unwrap_or_default();
        for session in list {
            let id = session
                .get("id")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
            if let Some(id) = id {
                sessions.insert(id, session);
            }
        }
    }

    if let Some(map) = runtime_by_session_id.as_object() {
        for (sid, value) in map {
            let id = sid.trim();
            if id.is_empty() {
                continue;
            }
            runtime.insert(id.to_string(), value.clone());
        }
    }

    SidebarSnapshot {
        directories,
        sessions,
        runtime,
    }
}

async fn build_snapshot_bundle_from_entries(
    state: &Arc<crate::AppState>,
    entries: Vec<DirectoryEntryWire>,
    limit_per_directory: usize,
    expanded_directory_ids: Option<&HashSet<String>>,
) -> SnapshotBundle {
    let snapshot_started = Instant::now();

    state.directory_session_index.replace_directory_mappings(
        entries
            .iter()
            .map(|entry| (entry.id.clone(), entry.path.clone()))
            .collect(),
    );

    let mut pages_by_directory_id = Map::<String, Value>::new();
    let mut fetched_directory_ids = HashSet::<String>::new();
    let mut indexed_session_count = 0usize;
    let mut index_update_elapsed = Duration::ZERO;
    let mut fetched_directory_count = 0usize;
    let mut fetch_failed_directory_count = 0usize;

    let should_include = |entry: &DirectoryEntryWire| {
        expanded_directory_ids
            .map(|set| set.contains(&entry.id))
            .unwrap_or(true)
    };

    let index = state.directory_session_index.clone();

    // Build an owned work list so the async stream does not borrow `entries`
    // across `.await` (which would make the future self-referential).
    let fetch_targets: Vec<(String, String)> = entries
        .iter()
        .filter(|entry| should_include(entry))
        .map(|entry| (entry.id.clone(), entry.path.clone()))
        .collect();

    let results = futures_stream::iter(fetch_targets.into_iter().map(
        |(directory_id, directory_path)| {
            let state = state.clone();
            let index = index.clone();
            async move {
                let (page, fetch_ok) =
                    fetch_directory_session_page(state, directory_path, limit_per_directory).await;

                let index_started = Instant::now();
                for session in &page.sessions {
                    index.upsert_summary_from_value(session);
                }
                let indexed = page.sessions.len();
                let index_elapsed = index_started.elapsed();

                (directory_id, page, indexed, index_elapsed, fetch_ok)
            }
        },
    ))
    .buffer_unordered(DIRECTORY_SESSIONS_FETCH_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;

    for (directory_id, page, indexed, elapsed, fetch_ok) in results {
        fetched_directory_count += 1;
        if fetch_ok {
            fetched_directory_ids.insert(directory_id.clone());
        } else {
            fetch_failed_directory_count += 1;
        }
        indexed_session_count += indexed;
        index_update_elapsed += elapsed;
        pages_by_directory_id.insert(directory_id, json!(page));
    }

    let activity_runtime = state.session_activity.snapshot_json();
    state
        .directory_session_index
        .reconcile_runtime_phase_map(&activity_runtime);
    let runtime_by_session_id = state.directory_session_index.runtime_snapshot_json();
    let snapshot = snapshot_from_parts(&entries, &pages_by_directory_id, &runtime_by_session_id);

    tracing::debug!(
        target: "opencode_studio.directory_sessions.metrics",
        snapshot_build_ms = snapshot_started.elapsed().as_secs_f64() * 1000.0,
        index_update_ms = index_update_elapsed.as_secs_f64() * 1000.0,
        indexed_session_count,
        directory_count = entries.len(),
        directory_count_fetched = fetched_directory_count,
        directory_count_fetch_failed = fetch_failed_directory_count,
        snapshot_session_count = snapshot.sessions.len(),
        snapshot_runtime_count = snapshot.runtime.len(),
        "directory sessions snapshot built"
    );

    SnapshotBundle {
        snapshot,
        fetched_directory_ids,
    }
}

fn changed_map_keys(prev: &BTreeMap<String, Value>, next: &BTreeMap<String, Value>) -> Vec<String> {
    let mut changed = HashSet::<String>::new();

    for (id, value) in next {
        let entry_changed = prev.get(id).map(|old| old != value).unwrap_or(true);
        if entry_changed {
            changed.insert(id.clone());
        }
    }

    for id in prev.keys() {
        if !next.contains_key(id) {
            changed.insert(id.clone());
        }
    }

    let mut out = changed.into_iter().collect::<Vec<_>>();
    out.sort();
    out
}

fn snapshot_full_entry_count(snapshot: &SidebarSnapshot) -> usize {
    snapshot.directories.len() + snapshot.sessions.len() + snapshot.runtime.len()
}

fn diff_snapshots(prev: &SidebarSnapshot, next: &SidebarSnapshot) -> SnapshotDelta {
    let changed_directory_ids = changed_map_keys(&prev.directories, &next.directories);
    let changed_session_ids = changed_map_keys(&prev.sessions, &next.sessions);
    let changed_runtime_session_ids = changed_map_keys(&prev.runtime, &next.runtime);
    let changed_count =
        changed_directory_ids.len() + changed_session_ids.len() + changed_runtime_session_ids.len();
    let removed_session_ids = prev
        .sessions
        .keys()
        .filter(|session_id| !next.sessions.contains_key(*session_id))
        .cloned()
        .collect();

    SnapshotDelta {
        changed_count,
        removed_session_ids,
        changed_directory_ids,
        changed_session_ids,
        changed_runtime_session_ids,
    }
}

fn directory_id_by_path_from_snapshot(snapshot: &SidebarSnapshot) -> BTreeMap<String, String> {
    let mut out = BTreeMap::<String, String>::new();
    for value in snapshot.directories.values() {
        let Some(id) = value
            .get("id")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        else {
            continue;
        };
        let Some(path_key) = value
            .get("path")
            .and_then(|v| v.as_str())
            .and_then(crate::path_utils::normalize_directory_for_match)
        else {
            continue;
        };
        out.insert(path_key, id);
    }
    out
}

fn session_directory_id(
    session: &Value,
    directory_id_by_path: &BTreeMap<String, String>,
) -> Option<String> {
    let path_key = session
        .get("directory")
        .and_then(|v| v.as_str())
        .and_then(crate::path_utils::normalize_directory_for_match)?;
    directory_id_by_path.get(&path_key).cloned()
}

fn session_parent_id(session: &Value) -> Option<String> {
    session
        .get("parentID")
        .or_else(|| session.get("parentId"))
        .or_else(|| session.get("parent_id"))
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn session_value_for_id<'a>(
    session_id: &str,
    prev: &'a SidebarSnapshot,
    next: &'a SidebarSnapshot,
) -> Option<&'a Value> {
    next.sessions
        .get(session_id)
        .or_else(|| prev.sessions.get(session_id))
}

fn collect_affected_session_lineage_ids(
    prev: &SidebarSnapshot,
    next: &SidebarSnapshot,
    seed_session_ids: impl IntoIterator<Item = String>,
) -> HashSet<String> {
    const MAX_LINEAGE_IDS: usize = 4096;

    let mut lineage_ids = HashSet::<String>::new();
    let mut pending = seed_session_ids.into_iter().collect::<Vec<_>>();

    while let Some(session_id) = pending.pop() {
        let sid = session_id.trim();
        if sid.is_empty() {
            continue;
        }
        if !lineage_ids.insert(sid.to_string()) {
            continue;
        }
        if lineage_ids.len() > MAX_LINEAGE_IDS {
            break;
        }

        if let Some(parent_id) = session_value_for_id(sid, prev, next).and_then(session_parent_id) {
            pending.push(parent_id);
        }
    }

    lineage_ids
}

fn chat_sidebar_patch_ops_for_delta(
    prev: &SidebarSnapshot,
    next: &SidebarSnapshot,
    delta: &SnapshotDelta,
) -> Vec<crate::chat_sidebar::ChatSidebarPatchOp> {
    if !delta.changed_runtime_session_ids.is_empty() {
        return vec![crate::chat_sidebar::ChatSidebarPatchOp::State];
    }

    let mut ops = Vec::<crate::chat_sidebar::ChatSidebarPatchOp>::new();

    if !delta.changed_directory_ids.is_empty() {
        ops.push(crate::chat_sidebar::ChatSidebarPatchOp::DirectoriesPage);
    }

    let mut directory_id_by_path = directory_id_by_path_from_snapshot(next);
    if directory_id_by_path.is_empty() {
        directory_id_by_path = directory_id_by_path_from_snapshot(prev);
    }

    let mut affected_directory_ids = delta
        .changed_directory_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<HashSet<_>>();

    let lineage_ids = collect_affected_session_lineage_ids(
        prev,
        next,
        delta
            .changed_session_ids
            .iter()
            .chain(delta.removed_session_ids.iter())
            .cloned(),
    );
    for session_id in lineage_ids {
        let sid = session_id.trim();
        if sid.is_empty() {
            continue;
        }
        let session = session_value_for_id(sid, prev, next);
        let Some(session) = session else {
            continue;
        };
        if let Some(directory_id) = session_directory_id(session, &directory_id_by_path) {
            affected_directory_ids.insert(directory_id);
        }
    }

    let mut sorted_directory_ids = affected_directory_ids.into_iter().collect::<Vec<_>>();
    sorted_directory_ids.sort();
    for directory_id in sorted_directory_ids {
        ops.push(crate::chat_sidebar::ChatSidebarPatchOp::Directory { directory_id });
    }

    if !delta.changed_session_ids.is_empty() {
        ops.push(crate::chat_sidebar::ChatSidebarPatchOp::Footer {
            kind: "pinned".to_string(),
        });
        ops.push(crate::chat_sidebar::ChatSidebarPatchOp::Footer {
            kind: "recent".to_string(),
        });
        ops.push(crate::chat_sidebar::ChatSidebarPatchOp::Footer {
            kind: "running".to_string(),
        });
    }

    ops
}

fn start_directory_sessions_poller_if_needed(state: Arc<crate::AppState>) {
    if !EVENT_HUB.mark_poller_started() {
        return;
    }

    tokio::spawn(async move {
        let mut prev = SidebarSnapshot::default();
        let mut initialized = false;
        let min_delay = Duration::from_millis(1500);
        let max_delay = Duration::from_millis(8000);
        let idle_delay = Duration::from_millis(2500);
        let mut poll_delay = min_delay;
        loop {
            if crate::global_sse_hub::downstream_client_count() == 0 {
                initialized = false;
                prev = SidebarSnapshot::default();
                poll_delay = idle_delay;
                tokio::time::sleep(idle_delay).await;
                continue;
            }

            let patch_started = Instant::now();

            let settings = state.settings.read().await.clone();
            let entries = build_directory_entries(&settings);

            let preferences = crate::chat_sidebar::chat_sidebar_preferences_snapshot().await;
            let collapsed = preferences
                .collapsed_directory_ids
                .iter()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .collect::<HashSet<String>>();
            let expanded_directory_ids = entries
                .iter()
                .map(|entry| entry.id.trim().to_string())
                .filter(|id| !id.is_empty() && !collapsed.contains(id))
                .collect::<HashSet<String>>();

            let poll_limit_per_directory = DIRECTORY_SESSIONS_LIMIT_DEFAULT;

            let bundle = build_snapshot_bundle_from_entries(
                &state,
                entries,
                poll_limit_per_directory,
                Some(&expanded_directory_ids),
            )
            .await;

            // When we fetch a subset of directories, keep previous summaries for the rest.
            // This prevents "missing" directories from producing spurious remove ops.
            let mut next_snapshot = bundle.snapshot;
            let fetched_directory_ids = bundle.fetched_directory_ids;
            if !expanded_directory_ids.is_empty() {
                for (sid, session) in prev.sessions.iter() {
                    if state.directory_session_index.is_recently_deleted(sid) {
                        continue;
                    }

                    let directory_path = session
                        .get("directory")
                        .and_then(|v| v.as_str())
                        .map(|v| v.trim())
                        .unwrap_or("");

                    let did = state
                        .directory_session_index
                        .directory_id_for_path(directory_path);

                    let should_keep = did
                        .as_deref()
                        .map(|id| {
                            !expanded_directory_ids.contains(id)
                                || !fetched_directory_ids.contains(id)
                        })
                        .unwrap_or(true);
                    if should_keep {
                        next_snapshot
                            .sessions
                            .entry(sid.clone())
                            .or_insert_with(|| session.clone());
                    }
                }
            } else {
                // All directories are treated as collapsed; keep previous snapshot summaries.
                for (sid, session) in prev.sessions.iter() {
                    if state.directory_session_index.is_recently_deleted(sid) {
                        continue;
                    }

                    next_snapshot
                        .sessions
                        .entry(sid.clone())
                        .or_insert_with(|| session.clone());
                }
            }

            // For sessions we intentionally preserve (e.g. failed upstream fetch), keep
            // previous runtime entries as well to avoid false runtime.remove churn.
            for sid in next_snapshot.sessions.keys() {
                if next_snapshot.runtime.contains_key(sid) {
                    continue;
                }
                if let Some(runtime) = prev.runtime.get(sid) {
                    next_snapshot
                        .runtime
                        .entry(sid.clone())
                        .or_insert_with(|| runtime.clone());
                }
            }

            let delta = if !initialized {
                initialized = true;
                SnapshotDelta {
                    changed_count: snapshot_full_entry_count(&next_snapshot),
                    removed_session_ids: Vec::new(),
                    changed_directory_ids: next_snapshot.directories.keys().cloned().collect(),
                    changed_session_ids: next_snapshot.sessions.keys().cloned().collect(),
                    changed_runtime_session_ids: next_snapshot.runtime.keys().cloned().collect(),
                }
            } else {
                diff_snapshots(&prev, &next_snapshot)
            };

            let patch_ops = if delta.changed_count > 0 {
                chat_sidebar_patch_ops_for_delta(&prev, &next_snapshot, &delta)
            } else {
                Vec::new()
            };
            prev = next_snapshot;

            for session_id in &delta.removed_session_ids {
                state
                    .directory_session_index
                    .remove_recent_session_entry(session_id);
            }

            let changed_count = delta.changed_count;
            if changed_count > 0 {
                EVENT_HUB.bump_seq();
                let _ = crate::chat_sidebar::publish_chat_sidebar_delta_event(patch_ops);
            }

            tracing::debug!(
                target: "opencode_studio.directory_sessions.metrics",
                publish_latency_ms = patch_started.elapsed().as_secs_f64() * 1000.0,
                changed_count,
                latest_seq = EVENT_HUB.latest_seq(),
                "directory sessions state publish tick"
            );

            if changed_count == 0 {
                poll_delay = (poll_delay * 2).min(max_delay);
            } else {
                poll_delay = min_delay;
            }
            tokio::time::sleep(poll_delay).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_session_page_prunes_session_fields() {
        let payload = json!({
            "sessions": [
                {
                    "id": "ses_1",
                    "title": "Title",
                    "slug": "slug",
                    "directory": "/tmp/proj",
                    "projectID": "proj_1",
                    "summary": {"files": 1},
                    "time": {"created": 1, "updated": 2, "completed": 3}
                }
            ],
            "total": 9,
            "offset": 0,
            "limit": 1
        });

        let page = parse_session_page(&payload, 80);
        assert_eq!(page.sessions.len(), 1);
        assert_eq!(page.total, 9);

        let s = page.sessions[0].as_object().expect("session");
        assert!(s.get("projectID").is_none());
        assert!(s.get("summary").is_none());
        assert!(s.get("time").and_then(|v| v.get("completed")).is_none());
    }

    #[test]
    fn extract_session_tree_hint_supports_parent_variants_and_deterministic_children() {
        let sessions = vec![
            json!({"id": "child_b", "parentID": "root_a"}),
            json!({"id": "root_b"}),
            json!({"id": "child_a", "parentId": "root_a"}),
            json!({"id": "root_a"}),
            json!({"id": "child_c", "parent_id": "root_a"}),
            json!({"id": "orphan", "parentId": "missing_root"}),
            json!({"id": "child_a", "parentID": "root_a"}),
        ];

        let hint = extract_session_tree_hint(&sessions).expect("tree hint");
        assert_eq!(hint.root_session_ids, vec!["orphan", "root_a", "root_b"]);
        assert_eq!(
            hint.children_by_parent_session_id.get("root_a"),
            Some(&vec![
                "child_a".to_string(),
                "child_b".to_string(),
                "child_c".to_string()
            ])
        );
    }

    #[test]
    fn parse_session_page_emits_tree_hint_with_stable_ordering() {
        let payload = json!({
            "sessions": [
                {"id": "child_2", "parentID": "root_1"},
                {"id": "root_1"},
                {"id": "child_1", "parentID": "root_1"},
                {"id": "child_1", "parentID": "root_1"}
            ],
            "total": 4,
            "offset": 0,
            "limit": 4
        });

        let page = parse_session_page(&payload, 80);
        let hint = page.tree_hint.expect("tree hint");
        assert_eq!(hint.root_session_ids, vec!["root_1"]);
        assert_eq!(
            hint.children_by_parent_session_id.get("root_1"),
            Some(&vec!["child_1".to_string(), "child_2".to_string()])
        );
    }

    #[test]
    fn parse_session_page_preserves_consistency_metadata() {
        let payload = json!({
            "sessions": [{"id": "ses_1", "directory": "/tmp/proj"}],
            "total": 1,
            "offset": 0,
            "limit": 1,
            "consistency": {
                "degraded": true,
                "staleReads": 2,
                "retryAfterMs": 180
            }
        });

        let page = parse_session_page(&payload, 80);
        let consistency = page
            .consistency
            .as_ref()
            .and_then(|v| v.as_object())
            .expect("consistency object");

        assert_eq!(
            consistency.get("degraded").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            consistency.get("staleReads").and_then(|v| v.as_u64()),
            Some(2)
        );
    }

    #[test]
    fn diff_snapshots_counts_changes_and_removals() {
        let mut prev = SidebarSnapshot::default();
        prev.sessions
            .insert("s_old".to_string(), json!({ "id": "s_old" }));

        let mut next = SidebarSnapshot::default();
        next.sessions
            .insert("s_new".to_string(), json!({ "id": "s_new" }));

        let delta = diff_snapshots(&prev, &next);
        assert_eq!(delta.changed_count, 2);
        assert_eq!(delta.removed_session_ids, vec!["s_old".to_string()]);
    }

    #[test]
    fn runtime_delta_requests_authoritative_sidebar_state_resync() {
        let delta = SnapshotDelta {
            changed_count: 1,
            removed_session_ids: Vec::new(),
            changed_directory_ids: vec!["dir_1".to_string()],
            changed_session_ids: vec!["ses_1".to_string()],
            changed_runtime_session_ids: vec!["ses_1".to_string()],
        };

        let ops = chat_sidebar_patch_ops_for_delta(
            &SidebarSnapshot::default(),
            &SidebarSnapshot::default(),
            &delta,
        );

        assert_eq!(ops.len(), 1);
        assert!(matches!(
            ops[0],
            crate::chat_sidebar::ChatSidebarPatchOp::State
        ));
    }

    #[test]
    fn session_delta_invalidates_ancestor_directories_for_cross_directory_children() {
        let mut prev = SidebarSnapshot::default();
        prev.directories.insert(
            "dir_parent".to_string(),
            json!({
                "id": "dir_parent",
                "path": "/tmp/root"
            }),
        );
        prev.directories.insert(
            "dir_child".to_string(),
            json!({
                "id": "dir_child",
                "path": "/tmp/worktree"
            }),
        );
        prev.sessions.insert(
            "parent_1".to_string(),
            json!({
                "id": "parent_1",
                "directory": "/tmp/root"
            }),
        );

        let mut next = prev.clone();
        next.sessions.insert(
            "child_1".to_string(),
            json!({
                "id": "child_1",
                "parentID": "parent_1",
                "directory": "/tmp/worktree"
            }),
        );

        let delta = SnapshotDelta {
            changed_count: 1,
            removed_session_ids: Vec::new(),
            changed_directory_ids: Vec::new(),
            changed_session_ids: vec!["child_1".to_string()],
            changed_runtime_session_ids: Vec::new(),
        };

        let ops = chat_sidebar_patch_ops_for_delta(&prev, &next, &delta);

        let invalidated_dirs = ops
            .iter()
            .filter_map(|op| match op {
                crate::chat_sidebar::ChatSidebarPatchOp::Directory { directory_id } => {
                    Some(directory_id.clone())
                }
                _ => None,
            })
            .collect::<HashSet<_>>();

        assert!(invalidated_dirs.contains("dir_parent"));
        assert!(invalidated_dirs.contains("dir_child"));
        assert!(ops.iter().any(|op| matches!(
            op,
            crate::chat_sidebar::ChatSidebarPatchOp::Footer { kind } if kind == "recent"
        )));
    }
}
