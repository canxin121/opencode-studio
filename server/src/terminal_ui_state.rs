use std::collections::{BTreeMap, HashSet};
use std::convert::Infallible;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_stream::stream;
use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response, sse::Event},
};
use fs2::FileExt as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{Mutex as AsyncMutex, RwLock, broadcast};

const DEFAULT_FOLDER_ID: &str = "terminal-default";
const DEFAULT_FOLDER_NAME: &str = "Default";

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalUiFolder {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalUiSessionMeta {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub last_used_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalUiState {
    #[serde(default)]
    pub version: u64,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub active_session_id: Option<String>,
    #[serde(default)]
    pub session_ids: Vec<String>,
    #[serde(default)]
    pub session_meta_by_id: BTreeMap<String, TerminalUiSessionMeta>,
    #[serde(default)]
    pub folders: Vec<TerminalUiFolder>,
}

impl Default for TerminalUiState {
    fn default() -> Self {
        Self {
            version: 0,
            updated_at: 0,
            active_session_id: None,
            session_ids: Vec::new(),
            session_meta_by_id: BTreeMap::new(),
            folders: vec![TerminalUiFolder {
                id: DEFAULT_FOLDER_ID.to_string(),
                name: DEFAULT_FOLDER_NAME.to_string(),
            }],
        }
    }
}

#[derive(Debug, Clone)]
struct SequencedTerminalUiStateEvent {
    seq: u64,
    payload: String,
}

struct TerminalUiStateEventHub {
    tx: broadcast::Sender<SequencedTerminalUiStateEvent>,
    next_seq: AtomicU64,
    next_client_id: AtomicU64,
}

impl TerminalUiStateEventHub {
    fn new() -> Self {
        let (tx, _) = broadcast::channel(1024);
        Self {
            tx,
            next_seq: AtomicU64::new(1),
            next_client_id: AtomicU64::new(1),
        }
    }

    fn allocate_client_id(&self) -> u64 {
        self.next_client_id.fetch_add(1, Ordering::Relaxed)
    }

    fn latest_seq(&self) -> u64 {
        self.next_seq.load(Ordering::Relaxed).saturating_sub(1)
    }

    fn publish_state_replace(&self, state: &TerminalUiState) {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let payload = serde_json::to_string(&json!({
            "type": "terminal-ui-state.patch",
            "seq": seq,
            "ts": now_millis(),
            "properties": {
                "ops": [
                    {
                        "type": "state.replace",
                        "state": state,
                    }
                ]
            }
        }))
        .unwrap_or_else(|_| "{}".to_string());

        if crate::global_sse_hub::downstream_client_count() > 0 {
            crate::global_sse_hub::publish_downstream_json(&payload);
        }

        let _ = self.tx.send(SequencedTerminalUiStateEvent { seq, payload });
    }
}

static TERMINAL_UI_STATE_CACHE: LazyLock<RwLock<Option<TerminalUiState>>> =
    LazyLock::new(|| RwLock::new(None));
static TERMINAL_UI_STATE_EVENT_HUB: LazyLock<TerminalUiStateEventHub> =
    LazyLock::new(TerminalUiStateEventHub::new);
static TERMINAL_UI_STATE_PUT_LOCK: LazyLock<AsyncMutex<()>> = LazyLock::new(|| AsyncMutex::new(()));

fn clip_chars(input: String, max_len: usize) -> String {
    input.chars().take(max_len).collect()
}

fn collapse_spaces(input: &str) -> String {
    input
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_session_id(raw: &str) -> String {
    raw.trim().to_string()
}

fn normalize_folder_id(raw: &str) -> String {
    clip_chars(raw.trim().to_string(), 80)
}

fn normalize_folder_name(raw: &str) -> String {
    clip_chars(collapse_spaces(raw), 40)
}

fn normalize_session_name(raw: &str) -> String {
    clip_chars(collapse_spaces(raw), 80)
}

fn sanitize_session_meta(
    input: TerminalUiSessionMeta,
    folder_ids: &HashSet<String>,
) -> Option<TerminalUiSessionMeta> {
    let mut out = TerminalUiSessionMeta::default();

    let name = normalize_session_name(input.name.as_deref().unwrap_or_default());
    if !name.is_empty() {
        out.name = Some(name);
    }

    let pinned = input.pinned.unwrap_or(false);
    if pinned {
        out.pinned = Some(true);
    }

    let folder_id = normalize_folder_id(input.folder_id.as_deref().unwrap_or_default());
    if !folder_id.is_empty() && folder_ids.contains(&folder_id) && folder_id != DEFAULT_FOLDER_ID {
        out.folder_id = Some(folder_id);
    }

    let last_used_at = input.last_used_at.unwrap_or(0);
    if last_used_at > 0 {
        out.last_used_at = Some(last_used_at);
    }

    if out.name.is_none()
        && out.pinned.is_none()
        && out.folder_id.is_none()
        && out.last_used_at.is_none()
    {
        return None;
    }
    Some(out)
}

fn sanitize_state(input: TerminalUiState) -> TerminalUiState {
    let mut session_ids = Vec::new();
    let mut session_seen = HashSet::<String>::new();
    for raw in input.session_ids {
        let sid = normalize_session_id(&raw);
        if sid.is_empty() {
            continue;
        }
        if session_seen.insert(sid.clone()) {
            session_ids.push(sid);
        }
    }

    let mut folders = Vec::<TerminalUiFolder>::new();
    let mut folder_ids = HashSet::<String>::new();
    for folder in input.folders {
        let id = normalize_folder_id(&folder.id);
        let name = normalize_folder_name(&folder.name);
        if id.is_empty() || name.is_empty() {
            continue;
        }
        if folder_ids.insert(id.clone()) {
            folders.push(TerminalUiFolder { id, name });
        }
    }

    if !folder_ids.contains(DEFAULT_FOLDER_ID) {
        folders.insert(
            0,
            TerminalUiFolder {
                id: DEFAULT_FOLDER_ID.to_string(),
                name: DEFAULT_FOLDER_NAME.to_string(),
            },
        );
        folder_ids.insert(DEFAULT_FOLDER_ID.to_string());
    }

    let mut session_meta_by_id = BTreeMap::<String, TerminalUiSessionMeta>::new();
    for sid in &session_ids {
        let Some(meta) = input.session_meta_by_id.get(sid).cloned() else {
            continue;
        };
        if let Some(compact) = sanitize_session_meta(meta, &folder_ids) {
            session_meta_by_id.insert(sid.clone(), compact);
        }
    }

    let requested_active =
        normalize_session_id(input.active_session_id.as_deref().unwrap_or_default());
    let active_session_id =
        if !requested_active.is_empty() && session_seen.contains(&requested_active) {
            Some(requested_active)
        } else {
            session_ids.first().cloned()
        };

    TerminalUiState {
        version: input.version,
        updated_at: input.updated_at,
        active_session_id,
        session_ids,
        session_meta_by_id,
        folders,
    }
}

fn terminal_ui_state_path() -> PathBuf {
    crate::persistence_paths::terminal_ui_state_path()
}

async fn acquire_state_disk_lock() -> Result<std::fs::File, String> {
    let lock_path = terminal_ui_state_path().with_extension("json.lock");
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

async fn load_state_from_disk() -> TerminalUiState {
    let path = terminal_ui_state_path();
    let raw = match tokio::fs::read_to_string(path).await {
        Ok(raw) => raw,
        Err(_) => return TerminalUiState::default(),
    };

    let parsed = serde_json::from_str::<TerminalUiState>(&raw).unwrap_or_default();
    sanitize_state(parsed)
}

async fn persist_state_to_disk(state: &TerminalUiState) -> Result<(), String> {
    let path = terminal_ui_state_path();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    let tmp_name = format!(
        "{}.tmp.{}.{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("terminal.state"),
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

async fn read_cached_state() -> TerminalUiState {
    {
        let guard = TERMINAL_UI_STATE_CACHE.read().await;
        if let Some(state) = guard.as_ref() {
            return state.clone();
        }
    }

    let loaded = load_state_from_disk().await;
    let mut guard = TERMINAL_UI_STATE_CACHE.write().await;
    if let Some(existing) = guard.as_ref() {
        return existing.clone();
    }
    *guard = Some(loaded.clone());
    loaded
}

async fn write_cached_state(state: TerminalUiState) {
    let mut guard = TERMINAL_UI_STATE_CACHE.write().await;
    *guard = Some(state);
}

fn snapshot_payload(state: &TerminalUiState) -> String {
    serde_json::to_string(&json!({
        "type": "terminal-ui-state.snapshot",
        "state": state,
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct TerminalUiStateEventsQuery {
    pub since: Option<String>,
}

pub(crate) async fn terminal_ui_state_get() -> Response {
    Json(read_cached_state().await).into_response()
}

pub(crate) async fn terminal_ui_state_put(Json(body): Json<TerminalUiState>) -> Response {
    let _put_guard = TERMINAL_UI_STATE_PUT_LOCK.lock().await;

    let _disk_lock = match acquire_state_disk_lock().await {
        Ok(lock) => lock,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error })),
            )
                .into_response();
        }
    };

    let current = load_state_from_disk().await;
    write_cached_state(current.clone()).await;

    let mut next = sanitize_state(body);
    next.version = current.version.saturating_add(1);
    next.updated_at = now_millis();

    if let Err(error) = persist_state_to_disk(&next).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error })),
        )
            .into_response();
    }

    write_cached_state(next.clone()).await;
    TERMINAL_UI_STATE_EVENT_HUB.publish_state_replace(&next);
    Json(next).into_response()
}

pub(crate) async fn terminal_ui_state_events(
    Query(query): Query<TerminalUiStateEventsQuery>,
) -> Response {
    let client_id = TERMINAL_UI_STATE_EVENT_HUB.allocate_client_id();
    let mut rx = TERMINAL_UI_STATE_EVENT_HUB.tx.subscribe();
    let current_state = read_cached_state().await;
    let current_seq = TERMINAL_UI_STATE_EVENT_HUB.latest_seq();
    let initial = snapshot_payload(&current_state);

    tracing::debug!(
        target: "opencode_studio.terminal_ui_state.sse",
        client_id,
        requested_since = query.since.unwrap_or_default(),
        latest_seq = current_seq,
        downstream_clients = TERMINAL_UI_STATE_EVENT_HUB.tx.receiver_count(),
        "terminal UI state SSE client connected"
    );

    let sse_stream = stream! {
        yield Ok::<Event, Infallible>(Event::default().data(initial));

        loop {
            match rx.recv().await {
                Ok(event) => {
                    yield Ok::<Event, Infallible>(
                        Event::default()
                            .id(event.seq.to_string())
                            .data(event.payload),
                    );
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    tracing::warn!(
                        target: "opencode_studio.terminal_ui_state.sse",
                        client_id,
                        downstream_clients = TERMINAL_UI_STATE_EVENT_HUB.tx.receiver_count(),
                        "terminal UI state SSE client lagged; closing stream"
                    );
                    break;
                }
                Err(broadcast::error::RecvError::Closed) => {
                    tracing::debug!(
                        target: "opencode_studio.terminal_ui_state.sse",
                        client_id,
                        "terminal UI state SSE client disconnected"
                    );
                    break;
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
