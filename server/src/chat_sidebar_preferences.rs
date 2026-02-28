use std::collections::{BTreeMap, HashSet, VecDeque};
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_stream::stream;
use axum::{
    Json,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response, sse::Event},
};
use fs2::FileExt as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{Mutex as AsyncMutex, RwLock, broadcast};

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub(crate) struct SessionsSidebarPreferences {
    #[serde(default)]
    pub version: u64,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub collapsed_directory_ids: Vec<String>,
    #[serde(default)]
    pub expanded_parent_session_ids: Vec<String>,
    #[serde(default)]
    pub pinned_session_ids: Vec<String>,
    #[serde(default)]
    pub directories_page: usize,
    #[serde(default)]
    pub session_root_page_by_directory_id: BTreeMap<String, usize>,
    #[serde(default)]
    pub pinned_sessions_open: bool,
    #[serde(default)]
    pub pinned_sessions_page: usize,
    #[serde(default)]
    pub recent_sessions_open: bool,
    #[serde(default)]
    pub recent_sessions_page: usize,
    #[serde(default)]
    pub running_sessions_open: bool,
    #[serde(default)]
    pub running_sessions_page: usize,
}

#[derive(Debug, Clone)]
struct SequencedPreferenceEvent {
    seq: u64,
    payload: String,
}

#[derive(Debug, Default)]
struct PreferenceReplayBuffer {
    items: VecDeque<SequencedPreferenceEvent>,
    bytes: usize,
}

struct SessionsSidebarPreferencesEventHub {
    tx: broadcast::Sender<SequencedPreferenceEvent>,
    buffer: Mutex<PreferenceReplayBuffer>,
    next_seq: AtomicU64,
    latest_unbuffered_seq: AtomicU64,
    next_client_id: AtomicU64,
}

const PREFS_EVENT_HUB_REPLAY_MAX_EVENTS: usize = 1024;
const PREFS_EVENT_HUB_REPLAY_MAX_BYTES: usize = 2 * 1024 * 1024;

impl SessionsSidebarPreferencesEventHub {
    fn new() -> Self {
        let (tx, _) = broadcast::channel(1024);
        Self {
            tx,
            buffer: Mutex::new(PreferenceReplayBuffer::default()),
            next_seq: AtomicU64::new(1),
            latest_unbuffered_seq: AtomicU64::new(0),
            next_client_id: AtomicU64::new(1),
        }
    }

    fn allocate_client_id(&self) -> u64 {
        self.next_client_id.fetch_add(1, Ordering::Relaxed)
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

    fn oldest_seq(&self) -> Option<u64> {
        let buf = self.buffer.lock().unwrap();
        buf.items.front().map(|event| event.seq)
    }

    fn replay_since_until(
        &self,
        last_seq: u64,
        max_seq_inclusive: u64,
    ) -> Vec<SequencedPreferenceEvent> {
        let buf = self.buffer.lock().unwrap();
        buf.items
            .iter()
            .filter(|event| event.seq > last_seq && event.seq <= max_seq_inclusive)
            .cloned()
            .collect()
    }

    #[cfg(test)]
    fn replay_bytes(&self) -> usize {
        let buf = self.buffer.lock().unwrap();
        buf.bytes
    }

    fn publish_preferences_replace(&self, preferences: &SessionsSidebarPreferences) {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let ts = now_millis();

        let payload = serde_json::to_string(&json!({
            "type": "chat-sidebar-preferences.patch",
            "seq": seq,
            "ts": ts,
            "properties": {
                "ops": [
                    {
                        "type": "preferences.replace",
                        "preferences": preferences,
                    }
                ]
            }
        }))
        .unwrap_or_else(|_| "{}".to_string());

        // Also publish into the global SSE hub so frontends can use a single connection.
        if crate::global_sse_hub::downstream_client_count() > 0 {
            crate::global_sse_hub::publish_downstream_json(&payload);
        }

        let event = SequencedPreferenceEvent { seq, payload };
        let payload_len = event.payload.len();

        if payload_len <= PREFS_EVENT_HUB_REPLAY_MAX_BYTES {
            let mut buf = self.buffer.lock().unwrap();
            buf.bytes = buf.bytes.saturating_add(payload_len);
            buf.items.push_back(event.clone());
            while (buf.items.len() > PREFS_EVENT_HUB_REPLAY_MAX_EVENTS
                || buf.bytes > PREFS_EVENT_HUB_REPLAY_MAX_BYTES)
                && !buf.items.is_empty()
            {
                if let Some(front) = buf.items.pop_front() {
                    buf.bytes = buf.bytes.saturating_sub(front.payload.len());
                }
            }
        } else {
            self.mark_unbuffered_seq(seq);
            tracing::warn!(
                target: "opencode_studio.sessions_sidebar_preferences.sse",
                seq,
                payload_bytes = payload_len,
                replay_max_bytes = PREFS_EVENT_HUB_REPLAY_MAX_BYTES,
                "sessions sidebar preferences patch too large for replay buffer; sending live only"
            );
        }

        let _ = self.tx.send(event);
    }
}

static PREFS_CACHE: LazyLock<RwLock<Option<SessionsSidebarPreferences>>> =
    LazyLock::new(|| RwLock::new(None));
static PREFS_EVENT_HUB: LazyLock<SessionsSidebarPreferencesEventHub> =
    LazyLock::new(SessionsSidebarPreferencesEventHub::new);
static PREFS_PUT_LOCK: LazyLock<AsyncMutex<()>> = LazyLock::new(|| AsyncMutex::new(()));

fn sanitize_id_list(list: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::<String>::new();
    for value in list {
        let id = value.trim();
        if id.is_empty() {
            continue;
        }
        if seen.insert(id.to_string()) {
            out.push(id.to_string());
        }
    }
    out
}

fn sanitize_page_map(map: BTreeMap<String, usize>) -> BTreeMap<String, usize> {
    let mut out = BTreeMap::new();
    for (key, page) in map {
        let id = key.trim();
        if id.is_empty() {
            continue;
        }
        out.insert(id.to_string(), page);
    }
    out
}

fn sanitize_preferences(input: SessionsSidebarPreferences) -> SessionsSidebarPreferences {
    SessionsSidebarPreferences {
        version: input.version,
        updated_at: input.updated_at,
        collapsed_directory_ids: sanitize_id_list(input.collapsed_directory_ids),
        expanded_parent_session_ids: sanitize_id_list(input.expanded_parent_session_ids),
        pinned_session_ids: sanitize_id_list(input.pinned_session_ids),
        directories_page: input.directories_page,
        session_root_page_by_directory_id: sanitize_page_map(
            input.session_root_page_by_directory_id,
        ),
        pinned_sessions_open: input.pinned_sessions_open,
        pinned_sessions_page: input.pinned_sessions_page,
        recent_sessions_open: input.recent_sessions_open,
        recent_sessions_page: input.recent_sessions_page,
        running_sessions_open: input.running_sessions_open,
        running_sessions_page: input.running_sessions_page,
    }
}

fn preferences_path() -> PathBuf {
    crate::persistence_paths::sidebar_preferences_path()
}

async fn acquire_preferences_disk_lock() -> Result<std::fs::File, String> {
    let lock_path = preferences_path().with_extension("json.lock");
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = lock_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&lock_path)
            .map_err(|error| error.to_string())?;

        file.lock_exclusive().map_err(|error| error.to_string())?;

        Ok(file)
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn load_preferences_from_disk() -> SessionsSidebarPreferences {
    let primary = preferences_path();
    let raw = match tokio::fs::read_to_string(&primary).await {
        Ok(raw) => raw,
        Err(_) => return SessionsSidebarPreferences::default(),
    };

    let parsed = serde_json::from_str::<SessionsSidebarPreferences>(&raw)
        .unwrap_or_else(|_| SessionsSidebarPreferences::default());
    sanitize_preferences(parsed)
}

async fn persist_preferences_to_disk(
    preferences: &SessionsSidebarPreferences,
) -> Result<(), String> {
    let path = preferences_path();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(preferences).map_err(|error| error.to_string())?;
    let tmp_name = format!(
        "{}.tmp.{}.{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("prefs"),
        std::process::id(),
        now_millis(),
    );
    let tmp = path.with_file_name(tmp_name);
    tokio::fs::write(&tmp, payload)
        .await
        .map_err(|error| error.to_string())?;
    tokio::fs::rename(&tmp, &path)
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

async fn read_cached_preferences() -> SessionsSidebarPreferences {
    {
        let guard = PREFS_CACHE.read().await;
        if let Some(preferences) = guard.as_ref() {
            return preferences.clone();
        }
    }

    let loaded = load_preferences_from_disk().await;
    let mut guard = PREFS_CACHE.write().await;
    if let Some(existing) = guard.as_ref() {
        return existing.clone();
    }
    *guard = Some(loaded.clone());
    loaded
}

pub(crate) async fn chat_sidebar_preferences_snapshot() -> SessionsSidebarPreferences {
    read_cached_preferences().await
}

async fn write_cached_preferences(preferences: SessionsSidebarPreferences) {
    let mut guard = PREFS_CACHE.write().await;
    *guard = Some(preferences);
}

fn parse_last_event_id(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
}

fn parse_if_match_version(headers: &HeaderMap) -> Option<u64> {
    let raw = headers.get(header::IF_MATCH)?.to_str().ok()?.trim();
    if raw.is_empty() || raw == "*" {
        return None;
    }

    let weak_trimmed = raw.strip_prefix("W/").unwrap_or(raw).trim();
    let quoted_trimmed = weak_trimmed.trim_matches('"').trim();
    if quoted_trimmed.is_empty() {
        return None;
    }

    quoted_trimmed.parse::<u64>().ok()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PutPrecondition {
    Ok,
    Missing,
    Conflict,
}

fn validate_put_precondition(headers: &HeaderMap, current_version: u64) -> PutPrecondition {
    let Some(expected_version) = parse_if_match_version(headers) else {
        return PutPrecondition::Missing;
    };
    if expected_version != current_version {
        return PutPrecondition::Conflict;
    }
    PutPrecondition::Ok
}

fn should_force_replay_for_hub(
    hub: &SessionsSidebarPreferencesEventHub,
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
    let Some(oldest) = hub.oldest_seq() else {
        return false;
    };
    last_event_id.saturating_add(1) < oldest
}

fn should_force_replay(last_event_id: u64, seq_at_subscribe: u64) -> bool {
    should_force_replay_for_hub(&PREFS_EVENT_HUB, last_event_id, seq_at_subscribe)
}

pub(crate) async fn chat_sidebar_preferences_get() -> Response {
    let preferences = read_cached_preferences().await;
    Json(preferences).into_response()
}

pub(crate) async fn chat_sidebar_preferences_put(
    headers: HeaderMap,
    Json(body): Json<SessionsSidebarPreferences>,
) -> Response {
    // Serialize writes so If-Match compare-and-set stays atomic across concurrent clients.
    let _put_guard = PREFS_PUT_LOCK.lock().await;
    let _disk_lock = match acquire_preferences_disk_lock().await {
        Ok(lock) => lock,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error })),
            )
                .into_response();
        }
    };

    // Refresh from disk while holding the disk lock so cross-process writers
    // observe a single serialized version stream.
    let current = load_preferences_from_disk().await;
    write_cached_preferences(current.clone()).await;

    match validate_put_precondition(&headers, current.version) {
        PutPrecondition::Ok => {}
        PutPrecondition::Missing => {
            return (
                StatusCode::PRECONDITION_REQUIRED,
                Json(json!({
                    "error": "Missing If-Match version precondition",
                    "code": "missing_precondition",
                    "current": current,
                })),
            )
                .into_response();
        }
        PutPrecondition::Conflict => {
            return (
                StatusCode::CONFLICT,
                Json(json!({
                    "error": "Sessions sidebar preferences version conflict",
                    "code": "version_conflict",
                    "current": current,
                })),
            )
                .into_response();
        }
    }

    let mut preferences = sanitize_preferences(body);
    preferences.version = current.version.saturating_add(1);
    preferences.updated_at = now_millis();
    if let Err(error) = persist_preferences_to_disk(&preferences).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error })),
        )
            .into_response();
    }

    write_cached_preferences(preferences.clone()).await;
    PREFS_EVENT_HUB.publish_preferences_replace(&preferences);
    Json(preferences).into_response()
}

pub(crate) async fn chat_sidebar_preferences_events(headers: HeaderMap) -> Response {
    let client_id = PREFS_EVENT_HUB.allocate_client_id();
    let last_event_id = parse_last_event_id(&headers).unwrap_or(0);
    // Subscribe first, then cap replay to the sequence visible at subscribe time.
    // This avoids replay/live overlap that can reorder duplicate seq values on the client.
    let mut rx = PREFS_EVENT_HUB.tx.subscribe();
    let seq_at_subscribe = PREFS_EVENT_HUB.latest_seq();

    let forced_replay = should_force_replay(last_event_id, seq_at_subscribe);
    let emit_floor_seq = if forced_replay {
        seq_at_subscribe
    } else {
        last_event_id.min(seq_at_subscribe)
    };
    let mut forced_snapshot_event: Option<SequencedPreferenceEvent> = None;
    let replay = if forced_replay {
        let preferences = read_cached_preferences().await;
        let forced_seq = seq_at_subscribe;
        let payload = serde_json::to_string(&json!({
            "type": "chat-sidebar-preferences.patch",
            "seq": forced_seq,
            "ts": now_millis(),
            "properties": {
                "ops": [
                    {
                        "type": "preferences.replace",
                        "preferences": preferences,
                    }
                ]
            }
        }))
        .unwrap_or_else(|_| "{}".to_string());
        forced_snapshot_event = Some(SequencedPreferenceEvent {
            seq: forced_seq,
            payload,
        });
        Vec::new()
    } else {
        PREFS_EVENT_HUB.replay_since_until(last_event_id, seq_at_subscribe)
    };

    tracing::debug!(
        target: "opencode_studio.sessions_sidebar_preferences.sse",
        client_id,
        last_event_id,
        seq_at_subscribe,
        emit_floor_seq,
        replay_len = replay.len(),
        forced_replay,
        forced_snapshot_seq = forced_snapshot_event.as_ref().map(|evt| evt.seq).unwrap_or(0),
        latest_seq = PREFS_EVENT_HUB.latest_seq(),
        downstream_clients = PREFS_EVENT_HUB.tx.receiver_count(),
        "sessions sidebar preferences SSE client connected"
    );

    let sse_stream = stream! {
        let mut last_emitted_seq = emit_floor_seq;

        if let Some(event) = forced_snapshot_event {
            if event.seq > last_emitted_seq {
                last_emitted_seq = event.seq;
            }
            yield Ok::<Event, std::convert::Infallible>(
                Event::default()
                    .event("patch")
                    .id(event.seq.to_string())
                    .data(event.payload),
            );
        }

        for event in replay {
            if event.seq <= last_emitted_seq {
                continue;
            }
            last_emitted_seq = event.seq;
            yield Ok::<Event, std::convert::Infallible>(
                Event::default()
                    .event("patch")
                    .id(event.seq.to_string())
                    .data(event.payload),
            );
        }

        loop {
            match tokio::time::timeout(Duration::from_secs(25), rx.recv()).await {
                Ok(Ok(event)) => {
                    if event.seq <= last_emitted_seq {
                        continue;
                    }
                    last_emitted_seq = event.seq;
                    yield Ok::<Event, std::convert::Infallible>(
                        Event::default()
                            .event("patch")
                            .id(event.seq.to_string())
                            .data(event.payload),
                    );
                }
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => {
                    tracing::warn!(
                        target: "opencode_studio.sessions_sidebar_preferences.sse",
                        client_id,
                        last_emitted_seq,
                        downstream_clients = PREFS_EVENT_HUB.tx.receiver_count(),
                        "sessions sidebar preferences SSE client lagged; closing stream"
                    );
                    break;
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => {
                    tracing::debug!(
                        target: "opencode_studio.sessions_sidebar_preferences.sse",
                        client_id,
                        last_emitted_seq,
                        disconnect_reason = "closed",
                        "sessions sidebar preferences SSE client disconnected"
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
    fn sanitize_preferences_trims_and_deduplicates_ids() {
        let input = SessionsSidebarPreferences {
            collapsed_directory_ids: vec![" d1 ".to_string(), "d1".to_string(), "".to_string()],
            expanded_parent_session_ids: vec![" p1 ".to_string(), "p1".to_string()],
            pinned_session_ids: vec![" s1 ".to_string(), "s2".to_string(), "s1".to_string()],
            session_root_page_by_directory_id: BTreeMap::from([
                (" d1 ".to_string(), 2usize),
                ("".to_string(), 1usize),
            ]),
            ..SessionsSidebarPreferences::default()
        };

        let out = sanitize_preferences(input);
        assert_eq!(out.collapsed_directory_ids, vec!["d1".to_string()]);
        assert_eq!(out.expanded_parent_session_ids, vec!["p1".to_string()]);
        assert_eq!(
            out.pinned_session_ids,
            vec!["s1".to_string(), "s2".to_string()]
        );
        assert_eq!(
            out.session_root_page_by_directory_id.get("d1"),
            Some(&2usize)
        );
        assert_eq!(out.session_root_page_by_directory_id.len(), 1);
    }

    #[test]
    fn event_hub_replay_since_returns_new_events_only() {
        let hub = SessionsSidebarPreferencesEventHub::new();
        hub.publish_preferences_replace(&SessionsSidebarPreferences::default());
        hub.publish_preferences_replace(&SessionsSidebarPreferences {
            pinned_session_ids: vec!["s_1".to_string()],
            ..SessionsSidebarPreferences::default()
        });

        let replay = hub.replay_since_until(1, hub.latest_seq());
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].seq, 2);
        assert!(replay[0].payload.contains("s_1"));
    }

    #[test]
    fn event_hub_replay_since_until_caps_at_subscribe_seq() {
        let hub = SessionsSidebarPreferencesEventHub::new();
        hub.publish_preferences_replace(&SessionsSidebarPreferences {
            pinned_session_ids: vec!["s_1".to_string()],
            ..SessionsSidebarPreferences::default()
        });

        let seq_at_subscribe = hub.latest_seq();

        // Simulate events that arrive after downstream subscription.
        hub.publish_preferences_replace(&SessionsSidebarPreferences {
            pinned_session_ids: vec!["s_2".to_string()],
            ..SessionsSidebarPreferences::default()
        });

        let replay = hub.replay_since_until(0, seq_at_subscribe);
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].seq, 1);
        assert!(replay[0].payload.contains("s_1"));
    }

    #[test]
    fn event_hub_does_not_buffer_single_oversized_event() {
        let hub = SessionsSidebarPreferencesEventHub::new();
        hub.publish_preferences_replace(&SessionsSidebarPreferences {
            pinned_session_ids: vec!["x".repeat(PREFS_EVENT_HUB_REPLAY_MAX_BYTES + 1024)],
            ..SessionsSidebarPreferences::default()
        });

        assert_eq!(hub.replay_since_until(0, hub.latest_seq()).len(), 0);
        assert_eq!(hub.replay_bytes(), 0);
    }

    #[test]
    fn should_force_replay_when_oversized_event_is_unbuffered() {
        let hub = SessionsSidebarPreferencesEventHub::new();
        hub.publish_preferences_replace(&SessionsSidebarPreferences {
            pinned_session_ids: vec!["s_1".to_string()],
            ..SessionsSidebarPreferences::default()
        });
        hub.publish_preferences_replace(&SessionsSidebarPreferences {
            pinned_session_ids: vec!["x".repeat(PREFS_EVENT_HUB_REPLAY_MAX_BYTES + 1024)],
            ..SessionsSidebarPreferences::default()
        });

        assert!(should_force_replay_for_hub(&hub, 1, hub.latest_seq()));
        assert!(!should_force_replay_for_hub(
            &hub,
            hub.latest_seq(),
            hub.latest_seq()
        ));
    }

    #[test]
    fn parse_if_match_version_accepts_plain_and_quoted_values() {
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_MATCH, HeaderValue::from_static("12"));
        assert_eq!(parse_if_match_version(&headers), Some(12));

        headers.insert(header::IF_MATCH, HeaderValue::from_static("\"42\""));
        assert_eq!(parse_if_match_version(&headers), Some(42));

        headers.insert(header::IF_MATCH, HeaderValue::from_static("W/\"7\""));
        assert_eq!(parse_if_match_version(&headers), Some(7));
    }

    #[test]
    fn validate_put_precondition_detects_missing_and_conflict() {
        let mut headers = HeaderMap::new();
        assert_eq!(
            validate_put_precondition(&headers, 3),
            PutPrecondition::Missing
        );

        headers.insert(header::IF_MATCH, HeaderValue::from_static("2"));
        assert_eq!(
            validate_put_precondition(&headers, 3),
            PutPrecondition::Conflict
        );

        headers.insert(header::IF_MATCH, HeaderValue::from_static("3"));
        assert_eq!(validate_put_precondition(&headers, 3), PutPrecondition::Ok);
    }
}
