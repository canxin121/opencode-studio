use std::collections::{BTreeMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_stream::stream;
use axum::{
    Json,
    body::to_bytes,
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response, sse::Event},
};
use futures_util::stream::{self as futures_stream, StreamExt as _};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::sync::broadcast;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectorySessionsBootstrapQuery {
    pub limit_per_directory: Option<usize>,
    pub expanded_directory_ids: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectorySessionsEventsQuery {
    pub limit_per_directory: Option<usize>,
}

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
struct SessionPageWire {
    offset: usize,
    limit: usize,
    total: usize,
    sessions: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    consistency: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectorySessionsBootstrapWire {
    directory_entries: Vec<DirectoryEntryWire>,
    session_summaries_by_directory_id: Map<String, Value>,
    runtime_by_session_id: Value,
    seq: u64,
}

#[derive(Debug, Clone)]
struct SequencedPatchEvent {
    seq: u64,
    payload: String,
}

#[derive(Debug, Default)]
struct PatchReplayBuffer {
    items: VecDeque<SequencedPatchEvent>,
    bytes: usize,
}

#[derive(Debug, Default, Clone)]
struct SidebarSnapshot {
    directories: BTreeMap<String, Value>,
    sessions: BTreeMap<String, Value>,
    runtime: BTreeMap<String, Value>,
}

#[derive(Debug, Default, Clone)]
struct SnapshotBundle {
    directory_entries: Vec<DirectoryEntryWire>,
    pages_by_directory_id: Map<String, Value>,
    runtime_by_session_id: Value,
    snapshot: SidebarSnapshot,
    fetched_directory_ids: HashSet<String>,
}

struct DirectorySessionsEventHub {
    tx: broadcast::Sender<SequencedPatchEvent>,
    buffer: Mutex<PatchReplayBuffer>,
    next_seq: AtomicU64,
    latest_unbuffered_seq: AtomicU64,
    poller_started: AtomicBool,
    next_client_id: AtomicU64,
    active_limit_by_client_id: Mutex<BTreeMap<u64, usize>>,
}

const EVENT_HUB_REPLAY_MAX_EVENTS: usize = 2048;
const EVENT_HUB_REPLAY_MAX_BYTES: usize = 8 * 1024 * 1024;
const DIRECTORY_SESSIONS_LIMIT_DEFAULT: usize = 10;
const DIRECTORY_SESSIONS_LIMIT_MIN: usize = 10;
const DIRECTORY_SESSIONS_LIMIT_MAX: usize = 200;
const DIRECTORY_SESSIONS_INDEX_SEED_LIMIT: usize = 40;
const DIRECTORY_SESSIONS_INTERNAL_BODY_LIMIT: usize = 5 * 1024 * 1024;

impl DirectorySessionsEventHub {
    fn new() -> Self {
        let (tx, _) = broadcast::channel(2048);
        Self {
            tx,
            buffer: Mutex::new(PatchReplayBuffer::default()),
            next_seq: AtomicU64::new(1),
            latest_unbuffered_seq: AtomicU64::new(0),
            poller_started: AtomicBool::new(false),
            next_client_id: AtomicU64::new(1),
            active_limit_by_client_id: Mutex::new(BTreeMap::new()),
        }
    }

    fn latest_seq(&self) -> u64 {
        self.next_seq.load(Ordering::Relaxed).saturating_sub(1)
    }

    fn latest_unbuffered_seq(&self) -> u64 {
        self.latest_unbuffered_seq.load(Ordering::Relaxed)
    }

    fn mark_unbuffered_seq(&self, seq: u64) {
        let _ = self.latest_unbuffered_seq.fetch_max(seq, Ordering::SeqCst);
    }

    fn publish_ops(&self, ops: Vec<Value>) {
        if ops.is_empty() {
            return;
        }

        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let payload = serde_json::to_string(&json!({
            "seq": seq,
            "ts": now_millis(),
            "ops": ops,
        }))
        .unwrap_or_else(|_| "{}".to_string());

        // Also publish into the global SSE hub so frontends can use a single connection.
        // This payload intentionally has no `type` and relies on the web SSE client to
        // normalize { seq, ts, ops } into a `chat-sidebar.patch` event.
        if crate::global_sse_hub::downstream_client_count() > 0 {
            crate::global_sse_hub::publish_downstream_json(&payload);
        }

        let evt = SequencedPatchEvent { seq, payload };
        let payload_len = evt.payload.len();

        if payload_len <= EVENT_HUB_REPLAY_MAX_BYTES {
            let mut buf = self.buffer.lock().unwrap();
            buf.bytes = buf.bytes.saturating_add(payload_len);
            buf.items.push_back(evt.clone());
            while (buf.items.len() > EVENT_HUB_REPLAY_MAX_EVENTS
                || buf.bytes > EVENT_HUB_REPLAY_MAX_BYTES)
                && !buf.items.is_empty()
            {
                if let Some(front) = buf.items.pop_front() {
                    buf.bytes = buf.bytes.saturating_sub(front.payload.len());
                }
            }
        } else {
            self.mark_unbuffered_seq(seq);
            tracing::warn!(
                target: "opencode_studio.directory_sessions.sse",
                seq,
                payload_bytes = payload_len,
                replay_max_bytes = EVENT_HUB_REPLAY_MAX_BYTES,
                "sessions sidebar patch too large for replay buffer; sending live only"
            );
        }

        let _ = self.tx.send(evt);
    }

    fn replay_since_until(
        &self,
        last_seq: u64,
        max_seq_inclusive: u64,
    ) -> Vec<SequencedPatchEvent> {
        let buf = self.buffer.lock().unwrap();
        buf.items
            .iter()
            .filter(|evt| evt.seq > last_seq && evt.seq <= max_seq_inclusive)
            .cloned()
            .collect()
    }

    fn oldest_seq(&self) -> Option<u64> {
        let buf = self.buffer.lock().unwrap();
        buf.items.front().map(|evt| evt.seq)
    }

    #[cfg(test)]
    fn replay_bytes(&self) -> usize {
        let buf = self.buffer.lock().unwrap();
        buf.bytes
    }

    fn mark_poller_started(&self) -> bool {
        !self.poller_started.swap(true, Ordering::SeqCst)
    }

    fn register_client_limit(&self, limit_per_directory: usize) -> u64 {
        let limit =
            limit_per_directory.clamp(DIRECTORY_SESSIONS_LIMIT_MIN, DIRECTORY_SESSIONS_LIMIT_MAX);
        let client_id = self.next_client_id.fetch_add(1, Ordering::Relaxed);
        let mut map = self.active_limit_by_client_id.lock().unwrap();
        map.insert(client_id, limit);
        client_id
    }

    fn unregister_client_limit(&self, client_id: u64) {
        let mut map = self.active_limit_by_client_id.lock().unwrap();
        map.remove(&client_id);
    }

    fn requested_limit_per_directory(&self) -> usize {
        let map = self.active_limit_by_client_id.lock().unwrap();
        map.values()
            .copied()
            .max()
            .unwrap_or(DIRECTORY_SESSIONS_LIMIT_DEFAULT)
            .clamp(DIRECTORY_SESSIONS_LIMIT_MIN, DIRECTORY_SESSIONS_LIMIT_MAX)
    }

    fn downstream_client_count(&self) -> usize {
        self.tx.receiver_count()
    }
}

static EVENT_HUB: LazyLock<DirectorySessionsEventHub> =
    LazyLock::new(DirectorySessionsEventHub::new);

struct DirectorySessionsClientLimitGuard {
    client_id: Option<u64>,
}

impl DirectorySessionsClientLimitGuard {
    fn register(limit_per_directory: usize) -> Self {
        Self {
            client_id: Some(EVENT_HUB.register_client_limit(limit_per_directory)),
        }
    }

    fn client_id(&self) -> u64 {
        self.client_id.unwrap_or(0)
    }
}

impl Drop for DirectorySessionsClientLimitGuard {
    fn drop(&mut self) {
        if let Some(client_id) = self.client_id.take() {
            EVENT_HUB.unregister_client_limit(client_id);
        }
    }
}

fn should_force_snapshot_replay(
    hub: &DirectorySessionsEventHub,
    last_event_id: u64,
    seq_at_subscribe: u64,
) -> bool {
    if last_event_id == 0 {
        return false;
    }

    if seq_at_subscribe == 0 {
        return false;
    }

    if last_event_id > seq_at_subscribe {
        return true;
    }

    let latest_unbuffered_seq = hub.latest_unbuffered_seq().min(seq_at_subscribe);
    if latest_unbuffered_seq > 0 && last_event_id < latest_unbuffered_seq {
        return true;
    }

    let Some(oldest_seq) = hub.oldest_seq() else {
        return false;
    };

    last_event_id.saturating_add(1) < oldest_seq
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn parse_limit(raw: Option<usize>) -> usize {
    // Keep limit bounded so sidebar pagination remains predictable.
    raw.unwrap_or(DIRECTORY_SESSIONS_LIMIT_DEFAULT)
        .clamp(DIRECTORY_SESSIONS_LIMIT_MIN, DIRECTORY_SESSIONS_LIMIT_MAX)
}

const DIRECTORY_SESSIONS_FETCH_CONCURRENCY: usize = 6;

fn parse_directory_ids_csv(raw: &str) -> HashSet<String> {
    raw.split(',')
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect()
}

fn parse_last_event_id(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
}

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

fn parse_session_page(payload: &Value, limit: usize) -> SessionPageWire {
    if let Some(list) = payload.as_array() {
        let sessions = sanitize_session_summary_list(list.to_vec());
        return SessionPageWire {
            offset: 0,
            limit,
            total: sessions.len(),
            sessions,
            consistency: None,
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

    SessionPageWire {
        offset,
        limit: resolved_limit,
        total,
        sessions,
        consistency,
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

async fn build_snapshot_bundle(
    state: &Arc<crate::AppState>,
    limit_per_directory: usize,
    expanded_directory_ids: Option<&HashSet<String>>,
) -> SnapshotBundle {
    let had_recent_before = !state
        .directory_session_index
        .recent_sessions_snapshot()
        .is_empty();
    let settings = state.settings.read().await.clone();
    let entries = build_directory_entries(&settings);
    let bundle = build_snapshot_bundle_from_entries(
        state,
        entries,
        limit_per_directory,
        expanded_directory_ids,
    )
    .await;

    // Cold-start guard: when the in-memory index is empty (typically after server
    // restart), seed summaries from collapsed directories too so global recent/running
    // indexes remain complete even if the UI booted with all directories collapsed.
    if !had_recent_before {
        seed_index_from_collapsed_directories(
            state,
            &bundle.directory_entries,
            expanded_directory_ids,
        )
        .await;
    }

    bundle
}

async fn seed_index_from_collapsed_directories(
    state: &Arc<crate::AppState>,
    entries: &[DirectoryEntryWire],
    expanded_directory_ids: Option<&HashSet<String>>,
) {
    let Some(expanded_directory_ids) = expanded_directory_ids else {
        return;
    };

    let targets: Vec<(String, String)> = entries
        .iter()
        .filter(|entry| !expanded_directory_ids.contains(&entry.id))
        .map(|entry| (entry.id.clone(), entry.path.clone()))
        .collect();
    if targets.is_empty() {
        return;
    }

    let index = state.directory_session_index.clone();

    let results =
        futures_stream::iter(targets.into_iter().map(|(_directory_id, directory_path)| {
            let state = state.clone();
            let index = index.clone();
            async move {
                let (page, _) = fetch_directory_session_page(
                    state,
                    directory_path,
                    DIRECTORY_SESSIONS_INDEX_SEED_LIMIT,
                )
                .await;

                let indexed = page.sessions.len();
                for session in &page.sessions {
                    index.upsert_summary_from_value(session);
                }
                indexed
            }
        }))
        .buffer_unordered(DIRECTORY_SESSIONS_FETCH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

    let indexed_session_count: usize = results.into_iter().sum();
    tracing::debug!(
        target: "opencode_studio.directory_sessions.metrics",
        seeded_directory_count = entries
            .iter()
            .filter(|entry| !expanded_directory_ids.contains(&entry.id))
            .count(),
        indexed_session_count,
        "directory sessions index seed from collapsed directories completed"
    );
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
        directory_entries: entries,
        pages_by_directory_id,
        runtime_by_session_id,
        snapshot,
        fetched_directory_ids,
    }
}

fn upsert_remove_ops(
    prev: &BTreeMap<String, Value>,
    next: &BTreeMap<String, Value>,
    upsert_type: &str,
    remove_type: &str,
    upsert_key: &str,
    remove_key: &str,
) -> Vec<Value> {
    let mut ops = Vec::<Value>::new();

    for (id, value) in next {
        let changed = prev.get(id).map(|old| old != value).unwrap_or(true);
        if changed {
            ops.push(json!({
                "type": upsert_type,
                upsert_key: value,
            }));
        }
    }

    for id in prev.keys() {
        if !next.contains_key(id) {
            ops.push(json!({
                "type": remove_type,
                remove_key: id,
            }));
        }
    }

    ops
}

fn snapshot_to_full_upserts(snapshot: &SidebarSnapshot) -> Vec<Value> {
    let mut ops = Vec::<Value>::new();
    for value in snapshot.directories.values() {
        ops.push(json!({
            "type": "directoryEntry.upsert",
            "entry": value,
        }));
    }
    for value in snapshot.sessions.values() {
        ops.push(json!({
            "type": "sessionSummary.upsert",
            "session": value,
        }));
    }
    for value in snapshot.runtime.values() {
        ops.push(json!({
            "type": "sessionRuntime.upsert",
            "runtime": value,
        }));
    }
    ops
}

fn diff_snapshots(prev: &SidebarSnapshot, next: &SidebarSnapshot) -> Vec<Value> {
    let mut ops = Vec::<Value>::new();

    ops.extend(upsert_remove_ops(
        &prev.directories,
        &next.directories,
        "directoryEntry.upsert",
        "directoryEntry.remove",
        "entry",
        "directoryId",
    ));

    ops.extend(upsert_remove_ops(
        &prev.sessions,
        &next.sessions,
        "sessionSummary.upsert",
        "sessionSummary.remove",
        "session",
        "sessionId",
    ));

    ops.extend(upsert_remove_ops(
        &prev.runtime,
        &next.runtime,
        "sessionRuntime.upsert",
        "sessionRuntime.remove",
        "runtime",
        "sessionId",
    ));

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
            if EVENT_HUB.downstream_client_count() == 0
                && crate::global_sse_hub::downstream_client_count() == 0
            {
                initialized = false;
                prev = SidebarSnapshot::default();
                poll_delay = idle_delay;
                tokio::time::sleep(idle_delay).await;
                continue;
            }

            let patch_started = Instant::now();

            let settings = state.settings.read().await.clone();
            let entries = build_directory_entries(&settings);

            let preferences =
                crate::chat_sidebar_preferences::chat_sidebar_preferences_snapshot().await;
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

            let poll_limit_per_directory = EVENT_HUB.requested_limit_per_directory();

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

            let ops = if !initialized {
                initialized = true;
                snapshot_to_full_upserts(&next_snapshot)
            } else {
                diff_snapshots(&prev, &next_snapshot)
            };
            prev = next_snapshot;

            for op in &ops {
                let kind = op
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                if kind != "sessionSummary.remove" {
                    continue;
                }
                if let Some(session_id) = op.get("sessionId").and_then(|value| value.as_str()) {
                    state
                        .directory_session_index
                        .remove_recent_session_entry(session_id);
                }
            }

            let ops_count = ops.len();
            EVENT_HUB.publish_ops(ops);
            tracing::debug!(
                target: "opencode_studio.directory_sessions.metrics",
                patch_latency_ms = patch_started.elapsed().as_secs_f64() * 1000.0,
                ops_count,
                latest_seq = EVENT_HUB.latest_seq(),
                "directory sessions patch published"
            );

            if ops_count == 0 {
                poll_delay = (poll_delay * 2).min(max_delay);
            } else {
                poll_delay = min_delay;
            }
            tokio::time::sleep(poll_delay).await;
        }
    });
}

pub(crate) async fn directory_sessions_bootstrap(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<DirectorySessionsBootstrapQuery>,
) -> Response {
    let limit_per_directory = parse_limit(query.limit_per_directory);
    let expanded_directory_ids = query
        .expanded_directory_ids
        .as_deref()
        .map(parse_directory_ids_csv);
    start_directory_sessions_poller_if_needed(state.clone());

    // Capture the sequence baseline before building the snapshot so clients can
    // replay all patches that happened during snapshot construction.
    let seq_baseline = EVENT_HUB.latest_seq();

    let bundle =
        build_snapshot_bundle(&state, limit_per_directory, expanded_directory_ids.as_ref()).await;
    let out = DirectorySessionsBootstrapWire {
        directory_entries: bundle.directory_entries,
        session_summaries_by_directory_id: bundle.pages_by_directory_id,
        runtime_by_session_id: bundle.runtime_by_session_id,
        seq: seq_baseline,
    };

    Json(out).into_response()
}

pub(crate) async fn directory_sessions_events(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(query): Query<DirectorySessionsEventsQuery>,
) -> Response {
    let limit_per_directory = parse_limit(query.limit_per_directory);
    start_directory_sessions_poller_if_needed(state.clone());

    // Track active clients so poller fetch limits can adapt to current demand.
    let client_limit_guard = DirectorySessionsClientLimitGuard::register(limit_per_directory);
    let client_id = client_limit_guard.client_id();

    // Subscribe first, then cap replay to the sequence visible at subscribe time.
    // This avoids replay/live overlap that can reorder duplicate seq values on the client.
    let mut rx = EVENT_HUB.tx.subscribe();
    let seq_at_subscribe = EVENT_HUB.latest_seq();

    let last_event_id = parse_last_event_id(&headers).unwrap_or(0);
    let forced_replay = should_force_snapshot_replay(&EVENT_HUB, last_event_id, seq_at_subscribe);
    let emit_floor_seq = if forced_replay {
        seq_at_subscribe
    } else {
        last_event_id.min(seq_at_subscribe)
    };
    let mut forced_snapshot_event: Option<SequencedPatchEvent> = None;
    let replay = if forced_replay {
        let bundle = build_snapshot_bundle(&state, limit_per_directory, None).await;
        let forced_seq = seq_at_subscribe;
        let forced_ops = snapshot_to_full_upserts(&bundle.snapshot);
        let payload = serde_json::to_string(&json!({
            "seq": forced_seq,
            "ts": now_millis(),
            "ops": forced_ops,
        }))
        .unwrap_or_else(|_| "{}".to_string());
        forced_snapshot_event = Some(SequencedPatchEvent {
            seq: forced_seq,
            payload,
        });
        Vec::new()
    } else {
        EVENT_HUB.replay_since_until(last_event_id, seq_at_subscribe)
    };

    tracing::debug!(
        target: "opencode_studio.directory_sessions.sse",
        client_id,
        last_event_id,
        seq_at_subscribe,
        emit_floor_seq,
        replay_len = replay.len(),
        forced_replay,
        forced_snapshot_seq = forced_snapshot_event.as_ref().map(|evt| evt.seq).unwrap_or(0),
        latest_seq = EVENT_HUB.latest_seq(),
        downstream_clients = EVENT_HUB.tx.receiver_count(),
        "sessions sidebar SSE client connected"
    );

    let sse_stream = stream! {
        // Hold registration for the stream lifetime.
        let _client_limit_guard = client_limit_guard;
        let mut last_emitted_seq = emit_floor_seq;

        if let Some(evt) = forced_snapshot_event {
            if evt.seq > last_emitted_seq {
                last_emitted_seq = evt.seq;
            }
            yield Ok::<Event, std::convert::Infallible>(
                Event::default()
                    .event("patch")
                    .id(evt.seq.to_string())
                    .data(evt.payload),
            );
        }

        for evt in replay {
            if evt.seq <= last_emitted_seq {
                continue;
            }
            last_emitted_seq = evt.seq;
            yield Ok::<Event, std::convert::Infallible>(
                Event::default()
                    .event("patch")
                    .id(evt.seq.to_string())
                    .data(evt.payload),
            );
        }

        loop {
            match tokio::time::timeout(Duration::from_secs(25), rx.recv()).await {
                Ok(Ok(evt)) => {
                    if evt.seq <= last_emitted_seq {
                        continue;
                    }
                    last_emitted_seq = evt.seq;
                    yield Ok::<Event, std::convert::Infallible>(
                        Event::default()
                            .event("patch")
                            .id(evt.seq.to_string())
                            .data(evt.payload),
                    );
                }
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => {
                    tracing::warn!(
                        target: "opencode_studio.directory_sessions.sse",
                        client_id,
                        last_emitted_seq,
                        downstream_clients = EVENT_HUB.tx.receiver_count(),
                        "sessions sidebar SSE client lagged; closing stream"
                    );
                    break;
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => {
                    tracing::debug!(
                        target: "opencode_studio.directory_sessions.sse",
                        client_id,
                        last_emitted_seq,
                        disconnect_reason = "closed",
                        "sessions sidebar SSE client disconnected"
                    );
                    break;
                }
                Err(_) => {
                    yield Ok::<Event, std::convert::Infallible>(Event::default().event("heartbeat").data("{}"));
                }
            }
        }
    };

    axum::response::sse::Sse::new(sse_stream)
        .keep_alive(
            axum::response::sse::KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("heartbeat"),
        )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn parse_last_event_id_handles_valid_and_invalid_values() {
        let mut headers = HeaderMap::new();
        assert_eq!(parse_last_event_id(&headers), None);

        headers.insert("last-event-id", HeaderValue::from_static("42"));
        assert_eq!(parse_last_event_id(&headers), Some(42));

        headers.insert("last-event-id", HeaderValue::from_static("invalid"));
        assert_eq!(parse_last_event_id(&headers), None);
    }

    #[test]
    fn event_hub_replay_since_returns_only_newer_events() {
        let hub = DirectorySessionsEventHub::new();
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": { "id": "s_1" }
        })]);
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": { "id": "s_2" }
        })]);

        let replay = hub.replay_since_until(1, hub.latest_seq());
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].seq, 2);
        assert!(replay[0].payload.contains("s_2"));
    }

    #[test]
    fn event_hub_replay_since_stale_seq_is_empty() {
        let hub = DirectorySessionsEventHub::new();
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": { "id": "s_1" }
        })]);

        let replay = hub.replay_since_until(999, hub.latest_seq());
        assert!(replay.is_empty());
    }

    #[test]
    fn event_hub_replay_since_until_caps_at_subscribe_seq() {
        let hub = DirectorySessionsEventHub::new();
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": { "id": "s_1" }
        })]);

        let seq_at_subscribe = hub.latest_seq();

        // Simulate events that arrive after downstream subscription.
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": { "id": "s_2" }
        })]);

        let replay = hub.replay_since_until(0, seq_at_subscribe);
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].seq, 1);
        assert!(replay[0].payload.contains("s_1"));
    }

    #[test]
    fn force_snapshot_replay_when_last_event_id_is_ahead() {
        let hub = DirectorySessionsEventHub::new();
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": { "id": "s_1" }
        })]);

        assert!(should_force_snapshot_replay(&hub, 999, hub.latest_seq()));
    }

    #[test]
    fn force_snapshot_replay_when_last_event_id_falls_behind_buffer() {
        let hub = DirectorySessionsEventHub::new();
        for i in 0..2050 {
            hub.publish_ops(vec![json!({
                "type": "sessionSummary.upsert",
                "session": { "id": format!("s_{i}") }
            })]);
        }

        // Buffer keeps newest 2048 events; last_event_id=1 is now too old.
        assert!(should_force_snapshot_replay(&hub, 1, hub.latest_seq()));
    }

    #[test]
    fn no_forced_snapshot_replay_when_client_is_at_latest_seq() {
        let hub = DirectorySessionsEventHub::new();
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": { "id": "s_1" }
        })]);

        assert!(!should_force_snapshot_replay(
            &hub,
            hub.latest_seq(),
            hub.latest_seq()
        ));
    }

    #[test]
    fn force_snapshot_replay_when_oversized_event_cannot_be_replayed() {
        let hub = DirectorySessionsEventHub::new();
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": { "id": "s_small" }
        })]);
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": {
                "id": "s_big",
                "title": "x".repeat(EVENT_HUB_REPLAY_MAX_BYTES + 1024),
            }
        })]);

        assert!(should_force_snapshot_replay(&hub, 1, hub.latest_seq()));
        assert!(!should_force_snapshot_replay(
            &hub,
            hub.latest_seq(),
            hub.latest_seq()
        ));
    }

    #[test]
    fn event_hub_byte_budget_evicts_large_events() {
        let hub = DirectorySessionsEventHub::new();
        let large = "x".repeat(EVENT_HUB_REPLAY_MAX_BYTES / 2 + 1024);

        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": {
                "id": "s_1",
                "title": large,
            }
        })]);
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": {
                "id": "s_2",
                "title": "y".repeat(EVENT_HUB_REPLAY_MAX_BYTES / 2 + 1024),
            }
        })]);

        let replay = hub.replay_since_until(0, hub.latest_seq());
        assert_eq!(hub.oldest_seq(), Some(2));
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].seq, 2);
        assert!(hub.replay_bytes() <= EVENT_HUB_REPLAY_MAX_BYTES);
    }

    #[test]
    fn event_hub_does_not_buffer_single_oversized_event() {
        let hub = DirectorySessionsEventHub::new();
        hub.publish_ops(vec![json!({
            "type": "sessionSummary.upsert",
            "session": {
                "id": "s_big",
                "title": "x".repeat(EVENT_HUB_REPLAY_MAX_BYTES + 1024),
            }
        })]);

        assert_eq!(hub.replay_since_until(0, hub.latest_seq()).len(), 0);
        assert_eq!(hub.replay_bytes(), 0);
    }

    #[test]
    fn event_hub_tracks_max_limit_across_active_clients() {
        let hub = DirectorySessionsEventHub::new();

        assert_eq!(
            hub.requested_limit_per_directory(),
            DIRECTORY_SESSIONS_LIMIT_DEFAULT
        );

        let client_a = hub.register_client_limit(DIRECTORY_SESSIONS_LIMIT_MIN);
        assert_eq!(
            hub.requested_limit_per_directory(),
            DIRECTORY_SESSIONS_LIMIT_MIN
        );

        let client_b = hub.register_client_limit(DIRECTORY_SESSIONS_LIMIT_MAX);
        assert_eq!(
            hub.requested_limit_per_directory(),
            DIRECTORY_SESSIONS_LIMIT_MAX
        );

        hub.unregister_client_limit(client_b);
        assert_eq!(
            hub.requested_limit_per_directory(),
            DIRECTORY_SESSIONS_LIMIT_MIN
        );

        hub.unregister_client_limit(client_a);
        assert_eq!(
            hub.requested_limit_per_directory(),
            DIRECTORY_SESSIONS_LIMIT_DEFAULT
        );
    }

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
    fn diff_snapshots_emits_upserts_and_removals() {
        let mut prev = SidebarSnapshot::default();
        prev.sessions
            .insert("s_old".to_string(), json!({ "id": "s_old" }));

        let mut next = SidebarSnapshot::default();
        next.sessions
            .insert("s_new".to_string(), json!({ "id": "s_new" }));

        let ops = diff_snapshots(&prev, &next);
        let kinds = ops
            .iter()
            .filter_map(|op| op.get("type").and_then(|v| v.as_str()).map(str::to_string))
            .collect::<Vec<String>>();

        assert!(kinds.iter().any(|k| k == "sessionSummary.remove"));
        assert!(kinds.iter().any(|k| k == "sessionSummary.upsert"));
    }
}
