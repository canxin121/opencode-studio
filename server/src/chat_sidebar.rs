use std::collections::{BTreeMap, HashSet, VecDeque};
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use axum::{
    Json,
    body::to_bytes,
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use fs2::FileExt as _;
use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{Mutex as AsyncMutex, RwLock};

const BODY_READ_LIMIT: usize = 10 * 1024 * 1024;
const SIDEBAR_INDEX_CACHE_TTL: Duration = Duration::from_millis(400);
const SIDEBAR_INDEX_CACHE_MAX_RECENT_VARIANTS: usize = 1;
const DIRECTORY_SESSIONS_PAGE_CACHE_TTL: Duration = Duration::from_millis(1200);
const DIRECTORY_SESSIONS_PAGE_CACHE_MAX_ENTRIES: usize = 256;
const SIDEBAR_STATE_DIRECTORIES_PAGE_SIZE_DEFAULT: usize = 15;
const SIDEBAR_STATE_DIRECTORY_SESSIONS_PAGE_SIZE_DEFAULT: usize = 10;
const SIDEBAR_STATE_FOOTER_PAGE_SIZE_DEFAULT: usize = 10;
const SIDEBAR_DIRECTORY_PAGE_FETCH_CONCURRENCY: usize = 6;
const SIDEBAR_RECENT_INDEX_SEED_LIMIT: usize = 40;
const SIDEBAR_RESPONSE_CACHE_TTL: Duration = Duration::from_millis(450);
const SIDEBAR_RESPONSE_CACHE_MAX_ENTRIES: usize = 64;
const SIDEBAR_PREFS_FLUSH_DEBOUNCE: Duration = Duration::from_millis(180);
const SIDEBAR_PREFS_FLUSH_RETRY_DELAY: Duration = Duration::from_millis(1200);

#[derive(Debug, Clone)]
struct RecentIndexCacheEntry {
    built_at: Instant,
    delta_seq: u64,
    items: Vec<RecentIndexItem>,
}

#[derive(Debug, Default)]
struct SidebarIndexProjectionCache {
    recent: Option<RecentIndexCacheEntry>,
}

#[derive(Debug, Clone)]
struct DirectorySessionsPageCacheEntry {
    key: String,
    built_at: Instant,
    delta_seq: u64,
    payload: Value,
}

#[derive(Debug, Default)]
struct DirectorySessionsPageCache {
    entries: BTreeMap<String, DirectorySessionsPageCacheEntry>,
    lru: std::collections::VecDeque<String>,
}

#[derive(Debug, Clone)]
struct SidebarResponseCacheEntry {
    key: String,
    built_at: Instant,
    delta_seq: u64,
    payload: Value,
}

#[derive(Debug, Default)]
struct SidebarResponseCache {
    entries: BTreeMap<String, SidebarResponseCacheEntry>,
    lru: VecDeque<String>,
}

#[derive(Debug, Default)]
struct SidebarPreferencesFlushQueue {
    pending: Option<SessionsSidebarPreferences>,
    worker_running: bool,
}

static SIDEBAR_INDEX_CACHE: LazyLock<Mutex<SidebarIndexProjectionCache>> =
    LazyLock::new(|| Mutex::new(SidebarIndexProjectionCache::default()));
static DIRECTORY_SESSIONS_PAGE_CACHE: LazyLock<Mutex<DirectorySessionsPageCache>> =
    LazyLock::new(|| Mutex::new(DirectorySessionsPageCache::default()));
static SIDEBAR_STATE_RESPONSE_CACHE: LazyLock<Mutex<SidebarResponseCache>> =
    LazyLock::new(|| Mutex::new(SidebarResponseCache::default()));
static CHAT_SIDEBAR_DELTA_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
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

static SIDEBAR_PREFS_CACHE: LazyLock<RwLock<Option<SessionsSidebarPreferences>>> =
    LazyLock::new(|| RwLock::new(None));
static SIDEBAR_PREFS_PUT_LOCK: LazyLock<AsyncMutex<()>> = LazyLock::new(|| AsyncMutex::new(()));
static SIDEBAR_PREFS_FLUSH_QUEUE: LazyLock<Mutex<SidebarPreferencesFlushQueue>> =
    LazyLock::new(|| Mutex::new(SidebarPreferencesFlushQueue::default()));

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

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

fn sanitize_sidebar_preferences(input: SessionsSidebarPreferences) -> SessionsSidebarPreferences {
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

fn sidebar_preferences_path() -> PathBuf {
    crate::persistence_paths::sidebar_preferences_path()
}

async fn acquire_sidebar_preferences_disk_lock() -> Result<std::fs::File, String> {
    let lock_path = sidebar_preferences_path().with_extension("json.lock");
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

async fn load_sidebar_preferences_from_disk() -> SessionsSidebarPreferences {
    let path = sidebar_preferences_path();
    let raw = match tokio::fs::read_to_string(path).await {
        Ok(raw) => raw,
        Err(_) => return SessionsSidebarPreferences::default(),
    };
    let parsed = serde_json::from_str::<SessionsSidebarPreferences>(&raw)
        .unwrap_or_else(|_| SessionsSidebarPreferences::default());
    sanitize_sidebar_preferences(parsed)
}

async fn persist_sidebar_preferences_to_disk(
    preferences: &SessionsSidebarPreferences,
) -> Result<(), String> {
    let path = sidebar_preferences_path();
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

async fn read_sidebar_preferences_cached() -> SessionsSidebarPreferences {
    {
        let guard = SIDEBAR_PREFS_CACHE.read().await;
        if let Some(preferences) = guard.as_ref() {
            return preferences.clone();
        }
    }

    let loaded = load_sidebar_preferences_from_disk().await;
    let mut guard = SIDEBAR_PREFS_CACHE.write().await;
    if let Some(existing) = guard.as_ref() {
        return existing.clone();
    }
    *guard = Some(loaded.clone());
    loaded
}

async fn write_sidebar_preferences_cached(preferences: SessionsSidebarPreferences) {
    let mut guard = SIDEBAR_PREFS_CACHE.write().await;
    *guard = Some(preferences);
}

fn queue_sidebar_preferences_flush(preferences: SessionsSidebarPreferences) {
    let mut should_spawn = false;
    if let Ok(mut queue) = SIDEBAR_PREFS_FLUSH_QUEUE.lock() {
        queue.pending = Some(preferences);
        if !queue.worker_running {
            queue.worker_running = true;
            should_spawn = true;
        }
    }

    if !should_spawn {
        return;
    }

    tokio::spawn(async {
        loop {
            tokio::time::sleep(SIDEBAR_PREFS_FLUSH_DEBOUNCE).await;

            let pending = if let Ok(mut queue) = SIDEBAR_PREFS_FLUSH_QUEUE.lock() {
                queue.pending.take()
            } else {
                None
            };

            let Some(candidate) = pending else {
                if let Ok(mut queue) = SIDEBAR_PREFS_FLUSH_QUEUE.lock() {
                    if queue.pending.is_none() {
                        queue.worker_running = false;
                        break;
                    }
                    continue;
                }
                break;
            };

            let latest = read_sidebar_preferences_cached().await;
            if candidate.version < latest.version {
                continue;
            }

            let _disk_lock = match acquire_sidebar_preferences_disk_lock().await {
                Ok(lock) => lock,
                Err(error) => {
                    tracing::warn!(
                        target: "opencode_studio.chat_sidebar",
                        error = %error,
                        "failed to acquire sidebar preferences disk lock; will retry"
                    );
                    if let Ok(mut queue) = SIDEBAR_PREFS_FLUSH_QUEUE.lock()
                        && queue.pending.is_none()
                    {
                        queue.pending = Some(candidate);
                    }
                    tokio::time::sleep(SIDEBAR_PREFS_FLUSH_RETRY_DELAY).await;
                    continue;
                }
            };

            if let Err(error) = persist_sidebar_preferences_to_disk(&candidate).await {
                tracing::warn!(
                    target: "opencode_studio.chat_sidebar",
                    error = %error,
                    "failed to persist sidebar preferences; will retry"
                );
                if let Ok(mut queue) = SIDEBAR_PREFS_FLUSH_QUEUE.lock()
                    && queue.pending.is_none()
                {
                    queue.pending = Some(candidate);
                }
                tokio::time::sleep(SIDEBAR_PREFS_FLUSH_RETRY_DELAY).await;
                continue;
            }
        }
    });
}

pub(crate) async fn chat_sidebar_preferences_snapshot() -> SessionsSidebarPreferences {
    read_sidebar_preferences_cached().await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub directories_page: Option<usize>,
    pub directory_query: Option<String>,
    pub directories_page_size: Option<usize>,
    pub directory_sessions_page_size: Option<usize>,
    pub focus_session_id: Option<String>,
    pub pinned_page: Option<usize>,
    pub recent_page: Option<usize>,
    pub running_page: Option<usize>,
    pub recent_page_size: Option<usize>,
    pub running_page_size: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum ChatSidebarCommandRequest {
    #[serde(rename = "setDirectoriesPage")]
    DirectoriesPage { page: usize },
    #[serde(rename = "setDirectoryCollapsed")]
    DirectoryCollapsed {
        #[serde(rename = "directoryId", alias = "directory_id")]
        directory_id: String,
        collapsed: bool,
    },
    #[serde(rename = "setDirectoryRootPage")]
    DirectoryRootPage {
        #[serde(rename = "directoryId", alias = "directory_id")]
        directory_id: String,
        page: usize,
    },
    #[serde(rename = "setSessionPinned")]
    SessionPinned {
        #[serde(rename = "sessionId", alias = "session_id")]
        session_id: String,
        pinned: bool,
    },
    #[serde(rename = "setSessionExpanded")]
    SessionExpanded {
        #[serde(rename = "sessionId", alias = "session_id")]
        session_id: String,
        expanded: bool,
    },
    #[serde(rename = "setFooterOpen")]
    FooterOpen { kind: String, open: bool },
    #[serde(rename = "setFooterPage")]
    FooterPage { kind: String, page: usize },
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(crate) enum ChatSidebarCommandsRequest {
    Single(ChatSidebarCommandRequest),
    List(Vec<ChatSidebarCommandRequest>),
    Wrapped {
        commands: Vec<ChatSidebarCommandRequest>,
    },
}

impl ChatSidebarCommandsRequest {
    fn into_commands(self) -> Vec<ChatSidebarCommandRequest> {
        match self {
            Self::Single(command) => vec![command],
            Self::List(commands) | Self::Wrapped { commands } => commands,
        }
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatSidebarSessionSearchQuery {
    pub query: Option<String>,
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
struct ChatSidebarSessionSearchHitWire {
    directory: DirectoryWire,
    session: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatSidebarSessionSearchResponse {
    items: Vec<ChatSidebarSessionSearchHitWire>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidebarSessionRowWire {
    id: String,
    session: Option<Value>,
    directory: Option<DirectoryWire>,
    render_key: String,
    depth: usize,
    parent_id: Option<String>,
    root_id: String,
    is_parent: bool,
    is_expanded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectorySidebarViewWire {
    session_count: usize,
    root_page: usize,
    root_page_count: usize,
    has_active_or_blocked: bool,
    has_running_sessions: bool,
    has_blocked_sessions: bool,
    pinned_rows: Vec<SidebarSessionRowWire>,
    recent_rows: Vec<SidebarSessionRowWire>,
    recent_parent_by_id: BTreeMap<String, Option<String>>,
    recent_root_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidebarFooterViewWire {
    total: usize,
    page: usize,
    page_count: usize,
    rows: Vec<SidebarSessionRowWire>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatSidebarViewWire {
    directory_rows_by_id: BTreeMap<String, DirectorySidebarViewWire>,
    pinned_footer: SidebarFooterViewWire,
    recent_footer: SidebarFooterViewWire,
    running_footer: SidebarFooterViewWire,
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
    preferences: SessionsSidebarPreferences,
    seq: u64,
    directories_page: Value,
    session_pages_by_directory_id: BTreeMap<String, Value>,
    runtime_by_session_id: Value,
    recent_page: Value,
    running_page: Value,
    focus: Option<ChatSidebarFocusWire>,
    view: ChatSidebarViewWire,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatSidebarDeltaWire {
    ops: Vec<ChatSidebarPatchOp>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatSidebarCommandsResponse {
    preferences: SessionsSidebarPreferences,
    seq: u64,
    delta: ChatSidebarDeltaWire,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum ChatSidebarPatchOp {
    #[serde(rename = "invalidateState")]
    State,
    #[serde(rename = "invalidatePreferences")]
    Preferences,
    #[serde(rename = "invalidateDirectoriesPage")]
    DirectoriesPage,
    #[serde(rename = "invalidateDirectory")]
    Directory {
        #[serde(rename = "directoryId")]
        directory_id: String,
    },
    #[serde(rename = "applyDirectoryView")]
    DirectoryView {
        #[serde(rename = "directoryId")]
        directory_id: String,
        view: DirectorySidebarViewWire,
    },
    #[serde(rename = "invalidateFooter")]
    Footer { kind: String },
}

fn chat_sidebar_delta_latest_seq() -> u64 {
    CHAT_SIDEBAR_DELTA_SEQ
        .load(Ordering::Relaxed)
        .saturating_sub(1)
}

fn chat_sidebar_delta_next_seq() -> u64 {
    CHAT_SIDEBAR_DELTA_SEQ.fetch_add(1, Ordering::SeqCst)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChatSidebarFooterKind {
    Pinned,
    Recent,
    Running,
}

impl ChatSidebarFooterKind {
    fn parse(raw: &str) -> Option<Self> {
        let normalized = raw.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "pinned" => Some(Self::Pinned),
            "recent" => Some(Self::Recent),
            "running" => Some(Self::Running),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Pinned => "pinned",
            Self::Recent => "recent",
            Self::Running => "running",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatSidebarFocusWire {
    session_id: String,
    directory_id: String,
    directory_path: String,
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

fn sidebar_state_cache_key(query: &ChatSidebarStateQuery) -> String {
    [
        format!(
            "directoriesPage={}",
            query
                .directories_page
                .map(|value| value.to_string())
                .unwrap_or_default()
        ),
        format!(
            "directoryQuery={}",
            query
                .directory_query
                .as_deref()
                .map(|value| value.trim().to_string())
                .unwrap_or_default()
        ),
        format!(
            "directoriesPageSize={}",
            query
                .directories_page_size
                .map(|value| value.to_string())
                .unwrap_or_default()
        ),
        format!(
            "directorySessionsPageSize={}",
            query
                .directory_sessions_page_size
                .map(|value| value.to_string())
                .unwrap_or_default()
        ),
        format!(
            "focusSessionId={}",
            query
                .focus_session_id
                .as_deref()
                .map(|value| value.trim().to_string())
                .unwrap_or_default()
        ),
        format!(
            "pinnedPage={}",
            query
                .pinned_page
                .map(|value| value.to_string())
                .unwrap_or_default()
        ),
        format!(
            "recentPage={}",
            query
                .recent_page
                .map(|value| value.to_string())
                .unwrap_or_default()
        ),
        format!(
            "runningPage={}",
            query
                .running_page
                .map(|value| value.to_string())
                .unwrap_or_default()
        ),
        format!(
            "recentPageSize={}",
            query
                .recent_page_size
                .map(|value| value.to_string())
                .unwrap_or_default()
        ),
        format!(
            "runningPageSize={}",
            query
                .running_page_size
                .map(|value| value.to_string())
                .unwrap_or_default()
        ),
    ]
    .join("|")
}

fn directory_sessions_page_cache_key(
    directory_id: &str,
    query: &crate::opencode_session::SessionListQuery,
    preferences: &SessionsSidebarPreferences,
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
        format!("prefsVersion={}", preferences.version),
        format!("prefsUpdatedAt={}", preferences.updated_at),
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
    fn get_fresh(&mut self, key: &str, delta_seq: u64) -> Option<Value> {
        let stale_keys = self
            .entries
            .iter()
            .filter_map(|(entry_key, entry)| {
                if entry.delta_seq != delta_seq
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

impl SidebarResponseCache {
    fn get_fresh(&mut self, key: &str, delta_seq: u64) -> Option<Value> {
        let stale_keys = self
            .entries
            .iter()
            .filter_map(|(entry_key, entry)| {
                if entry.delta_seq != delta_seq
                    || entry.built_at.elapsed() > SIDEBAR_RESPONSE_CACHE_TTL
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

    fn insert(&mut self, entry: SidebarResponseCacheEntry) {
        let key = entry.key.clone();
        self.entries.insert(key.clone(), entry);
        self.lru.retain(|k| k != &key);
        self.lru.push_back(key.clone());

        while self.entries.len() > SIDEBAR_RESPONSE_CACHE_MAX_ENTRIES {
            let Some(oldest) = self.lru.pop_front() else {
                break;
            };
            self.entries.remove(&oldest);
        }
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

#[derive(Debug, Clone)]
struct SidebarDirectoryPageRequest {
    directory_id: String,
    root_page: usize,
    focus_session_id: Option<String>,
}

async fn fetch_sidebar_directory_session_pages(
    state: Arc<crate::AppState>,
    requests: Vec<SidebarDirectoryPageRequest>,
    directory_sessions_page_size: usize,
) -> Result<BTreeMap<String, Value>, Response> {
    if requests.is_empty() {
        return Ok(BTreeMap::new());
    }

    let mut fetches = stream::iter(requests.into_iter().map(|request| {
        let state = state.clone();
        async move {
            let directory_id = request.directory_id;
            let directory_response = directory_sessions_by_id_get(
                State(state),
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
                    offset: if request.focus_session_id.is_some() {
                        None
                    } else {
                        Some(
                            page_to_offset(request.root_page, directory_sessions_page_size)
                                .to_string(),
                        )
                    },
                    limit: Some(directory_sessions_page_size.to_string()),
                    include_total: Some("true".to_string()),
                    include_children: Some("true".to_string()),
                    ids: None,
                    focus_session_id: request.focus_session_id,
                }),
            )
            .await
            .map_err(|error| error.into_response())?;

            let Some(directory_page) = decode_json_response(directory_response).await else {
                return Err((
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "error": "invalid directory sessions response",
                        "directoryId": directory_id,
                    })),
                )
                    .into_response());
            };

            Ok::<(String, Value), Response>((directory_id, directory_page))
        }
    }))
    .buffer_unordered(SIDEBAR_DIRECTORY_PAGE_FETCH_CONCURRENCY.max(1));

    let mut session_pages_by_directory_id = BTreeMap::<String, Value>::new();
    while let Some(result) = fetches.next().await {
        let (directory_id, directory_page) = result?;
        session_pages_by_directory_id.insert(directory_id, directory_page);
    }

    Ok(session_pages_by_directory_id)
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

fn normalize_directory_wires_by_id(entries: &[DirectoryWire]) -> BTreeMap<String, DirectoryWire> {
    let mut out = BTreeMap::<String, DirectoryWire>::new();
    for entry in entries {
        let id = entry.id.trim();
        let path = entry.path.trim();
        if id.is_empty() || path.is_empty() {
            continue;
        }
        out.insert(id.to_string(), entry.clone());
    }
    out
}

fn normalize_directory_id_by_path(entries: &[DirectoryWire]) -> BTreeMap<String, String> {
    let mut out = BTreeMap::<String, String>::new();
    for entry in entries {
        let id = entry.id.trim();
        if id.is_empty() {
            continue;
        }
        let Some(path_key) = normalize_path_for_match(&entry.path) else {
            continue;
        };
        out.insert(path_key, id.to_string());
    }
    out
}

fn session_updated_at(value: &Value) -> f64 {
    value
        .get("time")
        .and_then(|v| v.get("updated"))
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite())
        .unwrap_or(0.0)
}

fn session_directory_path(value: &Value) -> Option<String> {
    value
        .get("directory")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn directory_wire_for_path(
    directory_path: &str,
    directory_id_by_path: &BTreeMap<String, String>,
    directories_by_id: &BTreeMap<String, DirectoryWire>,
) -> Option<DirectoryWire> {
    let normalized = normalize_path_for_match(directory_path)?;
    let directory_id = directory_id_by_path.get(&normalized)?;
    directories_by_id.get(directory_id).cloned()
}

struct SessionRowsCtx<'a> {
    session_by_id: &'a BTreeMap<String, Value>,
    children_by_parent: &'a BTreeMap<String, Vec<String>>,
    expanded_parent_ids: &'a HashSet<String>,
    directory: &'a Option<DirectoryWire>,
}

fn session_rows_from_page_sessions(
    sessions: &[Value],
    root_ids: &[String],
    expanded_parent_ids: &HashSet<String>,
    directory: Option<DirectoryWire>,
) -> Vec<SidebarSessionRowWire> {
    let mut session_by_id = BTreeMap::<String, Value>::new();
    for session in sessions {
        let Some(sid) = session_id(session) else {
            continue;
        };
        session_by_id.insert(sid, session.clone());
    }

    let mut children_by_parent = BTreeMap::<String, Vec<String>>::new();
    for (sid, session) in &session_by_id {
        let Some(parent_id) = session_parent_id(session) else {
            continue;
        };
        if !session_by_id.contains_key(&parent_id) {
            continue;
        }
        children_by_parent
            .entry(parent_id)
            .or_default()
            .push(sid.clone());
    }

    for children in children_by_parent.values_mut() {
        children.sort_by(|left, right| {
            let left_updated = session_by_id
                .get(left)
                .map(session_updated_at)
                .unwrap_or(0.0);
            let right_updated = session_by_id
                .get(right)
                .map(session_updated_at)
                .unwrap_or(0.0);
            right_updated
                .partial_cmp(&left_updated)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.cmp(right))
        });
        children.dedup();
    }

    let mut rows = Vec::<SidebarSessionRowWire>::new();

    fn append(
        rows: &mut Vec<SidebarSessionRowWire>,
        ctx: &SessionRowsCtx,
        sid: &str,
        depth: usize,
        key_prefix: &str,
        ancestry: &mut HashSet<String>,
    ) {
        let trimmed = sid.trim();
        if trimmed.is_empty() || ancestry.contains(trimmed) {
            return;
        }

        let Some(session) = ctx.session_by_id.get(trimmed).cloned() else {
            return;
        };

        let children = ctx
            .children_by_parent
            .get(trimmed)
            .cloned()
            .unwrap_or_default();
        let is_parent = !children.is_empty();
        let is_expanded = is_parent && ctx.expanded_parent_ids.contains(trimmed);
        let render_key = if key_prefix.is_empty() {
            trimmed.to_string()
        } else {
            format!("{key_prefix}>{trimmed}")
        };
        let parent_id = if depth == 0 {
            None
        } else {
            key_prefix
                .rsplit('>')
                .next()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        let root_id = if depth == 0 {
            trimmed.to_string()
        } else {
            key_prefix
                .split('>')
                .next()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| trimmed.to_string())
        };

        rows.push(SidebarSessionRowWire {
            id: trimmed.to_string(),
            session: Some(session),
            directory: ctx.directory.clone(),
            render_key: render_key.clone(),
            depth,
            parent_id,
            root_id,
            is_parent,
            is_expanded,
        });

        if !is_expanded {
            return;
        }

        ancestry.insert(trimmed.to_string());
        for child_id in children {
            append(rows, ctx, &child_id, depth + 1, &render_key, ancestry);
        }
        ancestry.remove(trimmed);
    }

    let mut seen_roots = HashSet::<String>::new();
    let ctx = SessionRowsCtx {
        session_by_id: &session_by_id,
        children_by_parent: &children_by_parent,
        expanded_parent_ids,
        directory: &directory,
    };
    for root_id in root_ids {
        let rid = root_id.trim();
        if rid.is_empty() || !seen_roots.insert(rid.to_string()) {
            continue;
        }
        append(&mut rows, &ctx, rid, 0, "", &mut HashSet::new());
    }

    rows
}

fn page_session_root_ids(
    sessions: &[Value],
    page_payload: &Value,
    excluded_session_ids: &HashSet<String>,
) -> Vec<String> {
    let mut session_by_id = BTreeMap::<String, Value>::new();
    for session in sessions {
        let Some(sid) = session_id(session) else {
            continue;
        };
        if excluded_session_ids.contains(&sid) {
            continue;
        }
        session_by_id.insert(sid, session.clone());
    }

    if session_by_id.is_empty() {
        return Vec::new();
    }

    let mut roots = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();

    if let Some(root_ids) = page_payload
        .get("treeHint")
        .and_then(|v| v.get("rootSessionIds"))
        .and_then(|v| v.as_array())
    {
        for root in root_ids {
            let rid = root.as_str().map(|v| v.trim()).unwrap_or("");
            if rid.is_empty() {
                continue;
            }
            if !session_by_id.contains_key(rid) {
                continue;
            }
            if seen.insert(rid.to_string()) {
                roots.push(rid.to_string());
            }
        }
    }

    if roots.is_empty() {
        for (sid, session) in &session_by_id {
            let parent = session_parent_id(session);
            let is_root = parent
                .as_deref()
                .map(|pid| !session_by_id.contains_key(pid))
                .unwrap_or(true);
            if !is_root {
                continue;
            }
            if seen.insert(sid.clone()) {
                roots.push(sid.clone());
            }
        }
    }

    roots.sort_by(|left, right| {
        let left_updated = session_by_id
            .get(left)
            .map(session_updated_at)
            .unwrap_or(0.0);
        let right_updated = session_by_id
            .get(right)
            .map(session_updated_at)
            .unwrap_or(0.0);
        right_updated
            .partial_cmp(&left_updated)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.cmp(right))
    });
    roots
}

#[derive(Debug, Default, Clone)]
struct DirectoryActivityIds {
    running: HashSet<String>,
    blocked: HashSet<String>,
}

fn collect_directory_activity_ids(
    state: &Arc<crate::AppState>,
    runtime_by_session_id: &Value,
    directory_id_by_path: &BTreeMap<String, String>,
) -> DirectoryActivityIds {
    let mut out = DirectoryActivityIds::default();
    let Some(runtime_map) = runtime_by_session_id.as_object() else {
        return out;
    };

    for (session_id, runtime) in runtime_map {
        let effective = runtime
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("idle")
            .trim()
            .to_ascii_lowercase();
        let status_type = runtime
            .get("statusType")
            .or_else(|| runtime.get("status_type"))
            .and_then(|v| v.as_str())
            .unwrap_or("idle")
            .trim()
            .to_ascii_lowercase();
        let phase = runtime
            .get("phase")
            .and_then(|v| v.as_str())
            .unwrap_or("idle")
            .trim()
            .to_ascii_lowercase();
        let attention = runtime
            .get("attention")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let display_state = runtime
            .get("displayState")
            .or_else(|| runtime.get("display_state"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();

        let is_blocked = matches!(attention.as_str(), "permission" | "question")
            || matches!(display_state.as_str(), "needspermission" | "needsreply");
        let mut is_running = !is_blocked
            && (matches!(
                display_state.as_str(),
                "running" | "retrying" | "coolingdown"
            ) || matches!(status_type.as_str(), "busy" | "retry")
                || matches!(phase.as_str(), "busy" | "cooldown")
                || matches!(effective.as_str(), "busy" | "cooldown"));

        if !is_blocked
            && !is_running
            && !effective.is_empty()
            && effective != "idle"
            && effective != "attention"
        {
            is_running = true;
        }

        if !is_running && !is_blocked {
            continue;
        }

        let Some(path) = state
            .directory_session_index
            .directory_for_session(session_id)
        else {
            continue;
        };
        let Some(path_key) = normalize_path_for_match(&path) else {
            continue;
        };
        let Some(directory_id) = directory_id_by_path.get(&path_key) else {
            continue;
        };
        if is_running {
            out.running.insert(directory_id.clone());
        }
        if is_blocked {
            out.blocked.insert(directory_id.clone());
        }
    }

    out
}

fn build_index_rows_from_roots(
    state: &Arc<crate::AppState>,
    root_ids: &[String],
    expanded_parent_ids: &HashSet<String>,
    directories_by_id: &BTreeMap<String, DirectoryWire>,
    directory_id_by_path: &BTreeMap<String, String>,
    root_directory_hint: &BTreeMap<String, DirectoryWire>,
) -> Vec<SidebarSessionRowWire> {
    let mut rows = Vec::<SidebarSessionRowWire>::new();

    struct IndexRowsCtx<'a> {
        state: &'a Arc<crate::AppState>,
        expanded_parent_ids: &'a HashSet<String>,
        directories_by_id: &'a BTreeMap<String, DirectoryWire>,
        directory_id_by_path: &'a BTreeMap<String, String>,
    }

    fn append(
        rows: &mut Vec<SidebarSessionRowWire>,
        ctx: &IndexRowsCtx,
        sid: &str,
        depth: usize,
        key_prefix: &str,
        ancestry: &mut HashSet<String>,
        fallback_directory: Option<DirectoryWire>,
    ) {
        let trimmed = sid.trim();
        if trimmed.is_empty() || ancestry.contains(trimmed) {
            return;
        }

        let summary = ctx.state.directory_session_index.summary(trimmed);
        let session = summary.as_ref().map(|record| record.raw.clone());
        let directory = session
            .as_ref()
            .and_then(session_directory_path)
            .and_then(|path| {
                directory_wire_for_path(&path, ctx.directory_id_by_path, ctx.directories_by_id)
            })
            .or(fallback_directory.clone());

        let mut children = ctx
            .state
            .directory_session_index
            .child_summaries(trimmed)
            .into_iter()
            .map(|summary| summary.session_id)
            .filter(|id| !id.trim().is_empty())
            .collect::<Vec<_>>();
        children.sort_by(|left, right| {
            let left_updated = ctx
                .state
                .directory_session_index
                .summary(left)
                .map(|value| value.updated_at)
                .unwrap_or(0.0);
            let right_updated = ctx
                .state
                .directory_session_index
                .summary(right)
                .map(|value| value.updated_at)
                .unwrap_or(0.0);
            right_updated
                .partial_cmp(&left_updated)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.cmp(right))
        });
        children.dedup();

        let is_parent = !children.is_empty();
        let is_expanded = is_parent && ctx.expanded_parent_ids.contains(trimmed);
        let render_key = if key_prefix.is_empty() {
            trimmed.to_string()
        } else {
            format!("{key_prefix}>{trimmed}")
        };
        let parent_id = if depth == 0 {
            None
        } else {
            key_prefix
                .rsplit('>')
                .next()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        let root_id = if depth == 0 {
            trimmed.to_string()
        } else {
            key_prefix
                .split('>')
                .next()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| trimmed.to_string())
        };

        rows.push(SidebarSessionRowWire {
            id: trimmed.to_string(),
            session,
            directory: directory.clone(),
            render_key: render_key.clone(),
            depth,
            parent_id,
            root_id,
            is_parent,
            is_expanded,
        });

        if !is_expanded {
            return;
        }

        ancestry.insert(trimmed.to_string());
        for child_id in children {
            append(
                rows,
                ctx,
                &child_id,
                depth + 1,
                &render_key,
                ancestry,
                directory.clone(),
            );
        }
        ancestry.remove(trimmed);
    }

    let mut seen = HashSet::<String>::new();
    let ctx = IndexRowsCtx {
        state,
        expanded_parent_ids,
        directories_by_id,
        directory_id_by_path,
    };
    for root_id in root_ids {
        let rid = root_id.trim();
        if rid.is_empty() || !seen.insert(rid.to_string()) {
            continue;
        }
        let hint_directory = root_directory_hint.get(rid).cloned();
        append(
            &mut rows,
            &ctx,
            rid,
            0,
            "",
            &mut HashSet::new(),
            hint_directory,
        );
    }

    rows
}

fn parse_directory_sidebar_session_count(page_payload: &Value, fallback: usize) -> usize {
    page_payload
        .get("total")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(fallback)
}

fn parse_directory_sidebar_page(page_payload: &Value, fallback_page: usize) -> usize {
    let offset = page_payload
        .get("offset")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(fallback_page);
    let limit = page_payload
        .get("limit")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .filter(|value| *value > 0)
        .unwrap_or(1);
    offset / limit
}

struct DirectorySidebarBuildCtx<'a> {
    state: &'a Arc<crate::AppState>,
    preferences: &'a SessionsSidebarPreferences,
    expanded_parent_ids: &'a HashSet<String>,
    directories_by_id: &'a BTreeMap<String, DirectoryWire>,
    directory_id_by_path: &'a BTreeMap<String, String>,
    running_directory_ids: &'a HashSet<String>,
    blocked_directory_ids: &'a HashSet<String>,
    directory_sessions_page_size: usize,
}

fn build_directory_sidebar_view(
    ctx: &DirectorySidebarBuildCtx,
    directory: &DirectoryWire,
    page_payload: Option<&Value>,
) -> DirectorySidebarViewWire {
    let directory_id = directory.id.trim().to_string();
    let pinned_ids = ctx
        .preferences
        .pinned_session_ids
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    let mut pinned_root_ids = Vec::<String>::new();
    for pinned_id in pinned_ids {
        let Some(summary) = ctx.state.directory_session_index.summary(pinned_id) else {
            continue;
        };
        let Some(path_key) = normalize_path_for_match(&summary.directory_path) else {
            continue;
        };
        let Some(mapped_directory_id) = ctx.directory_id_by_path.get(&path_key) else {
            continue;
        };
        if mapped_directory_id != &directory_id {
            continue;
        }
        pinned_root_ids.push(summary.session_id);
    }

    let mut pinned_hints = BTreeMap::<String, DirectoryWire>::new();
    for root_id in &pinned_root_ids {
        pinned_hints.insert(root_id.clone(), directory.clone());
    }

    let pinned_rows = build_index_rows_from_roots(
        ctx.state,
        &pinned_root_ids,
        ctx.expanded_parent_ids,
        ctx.directories_by_id,
        ctx.directory_id_by_path,
        &pinned_hints,
    );

    let fallback_count = ctx
        .state
        .directory_session_index
        .session_ids_for_directory(&directory.path)
        .len();

    let mut session_count = fallback_count;
    let mut root_page = ctx
        .preferences
        .session_root_page_by_directory_id
        .get(&directory_id)
        .copied()
        .unwrap_or(0);
    let mut root_page_count = 1usize;
    let mut recent_rows = Vec::<SidebarSessionRowWire>::new();
    let mut recent_parent_by_id = BTreeMap::<String, Option<String>>::new();
    let mut recent_root_ids = Vec::<String>::new();

    if let Some(page_payload) = page_payload {
        let sessions = extract_sessions(page_payload);
        session_count = parse_directory_sidebar_session_count(page_payload, sessions.len());
        root_page = parse_directory_sidebar_page(page_payload, root_page);
        root_page_count = std::cmp::max(
            1,
            ((std::cmp::max(session_count, 1) as f64) / (ctx.directory_sessions_page_size as f64))
                .ceil() as usize,
        );

        let excluded = ctx
            .preferences
            .pinned_session_ids
            .iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect::<HashSet<_>>();
        let filtered_sessions = sessions
            .into_iter()
            .filter(|session| {
                session_id(session)
                    .map(|sid| !excluded.contains(&sid))
                    .unwrap_or(true)
            })
            .collect::<Vec<_>>();
        let roots = page_session_root_ids(&filtered_sessions, page_payload, &excluded);
        recent_rows = session_rows_from_page_sessions(
            &filtered_sessions,
            &roots,
            ctx.expanded_parent_ids,
            Some(directory.clone()),
        );

        for row in &recent_rows {
            let sid = row.id.trim();
            if sid.is_empty() {
                continue;
            }
            recent_parent_by_id.insert(sid.to_string(), row.parent_id.clone());
        }

        let mut seen_recent_roots = HashSet::<String>::new();
        for row in &recent_rows {
            let rid = row.root_id.trim();
            if rid.is_empty() {
                continue;
            }
            if seen_recent_roots.insert(rid.to_string()) {
                recent_root_ids.push(rid.to_string());
            }
        }
    }

    let has_running_sessions = ctx.running_directory_ids.contains(&directory_id);
    let has_blocked_sessions = ctx.blocked_directory_ids.contains(&directory_id);

    DirectorySidebarViewWire {
        session_count,
        root_page,
        root_page_count,
        has_active_or_blocked: has_running_sessions || has_blocked_sessions,
        has_running_sessions,
        has_blocked_sessions,
        pinned_rows,
        recent_rows,
        recent_parent_by_id,
        recent_root_ids,
    }
}

struct SidebarFooterBuildCtx<'a> {
    state: &'a Arc<crate::AppState>,
    expanded_parent_ids: &'a HashSet<String>,
    directories_by_id: &'a BTreeMap<String, DirectoryWire>,
    directory_id_by_path: &'a BTreeMap<String, String>,
    root_directory_hint: &'a BTreeMap<String, DirectoryWire>,
}

fn build_sidebar_footer_view(
    ctx: &SidebarFooterBuildCtx,
    all_root_ids: &[String],
    page: usize,
    page_size: usize,
) -> SidebarFooterViewWire {
    let deduped = all_root_ids
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .fold(Vec::<String>::new(), |mut out, value| {
            if !out.iter().any(|existing| existing == value) {
                out.push(value.to_string());
            }
            out
        });

    let total = deduped.len();
    let page_count = std::cmp::max(
        1,
        ((std::cmp::max(total, 1) as f64) / (page_size as f64)).ceil() as usize,
    );
    let clamped_page = page.min(page_count.saturating_sub(1));
    let start = clamped_page.saturating_mul(page_size);
    let end = std::cmp::min(total, start.saturating_add(page_size));
    let paged_roots = if start < end {
        deduped[start..end].to_vec()
    } else {
        Vec::new()
    };

    let rows = build_index_rows_from_roots(
        ctx.state,
        &paged_roots,
        ctx.expanded_parent_ids,
        ctx.directories_by_id,
        ctx.directory_id_by_path,
        ctx.root_directory_hint,
    );

    SidebarFooterViewWire {
        total,
        page: clamped_page,
        page_count,
        rows,
    }
}

fn cache_entry_is_fresh(entry_delta_seq: u64, now_delta_seq: u64, built_at: Instant) -> bool {
    entry_delta_seq == now_delta_seq && built_at.elapsed() <= SIDEBAR_INDEX_CACHE_TTL
}

fn bounded_variant_len(kind: &str) -> usize {
    if kind == "recent" {
        SIDEBAR_INDEX_CACHE_MAX_RECENT_VARIANTS
    } else {
        0
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

fn build_running_index_items_from_runtime(
    state: &Arc<crate::AppState>,
    runtime_by_session_id: &Value,
    directory_id_by_normalized_path: &BTreeMap<String, String>,
) -> Vec<RunningIndexItem> {
    let mut items = Vec::<RunningIndexItem>::new();

    if let Some(map) = runtime_by_session_id.as_object() {
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

fn parse_paged_meta(page_payload: &Value, fallback_page_size: usize) -> (usize, usize, usize) {
    let total = page_payload
        .get("total")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(0);
    let offset = page_payload
        .get("offset")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(0);
    let limit = page_payload
        .get("limit")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .filter(|value| *value > 0)
        .unwrap_or(fallback_page_size.max(1));
    (total, offset / limit, limit)
}

fn visible_directory_wires_from_page_payload(directories_page: &Value) -> Vec<DirectoryWire> {
    let mut visible_directories = Vec::<DirectoryWire>::new();
    if let Some(items) = directories_page
        .get("items")
        .and_then(|value| value.as_array())
    {
        for item in items {
            let Some(obj) = item.as_object() else {
                continue;
            };
            let id = obj
                .get("id")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let path = obj
                .get("path")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let (Some(id), Some(path)) = (id, path) else {
                continue;
            };
            let added_at = obj
                .get("addedAt")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            let last_opened_at = obj
                .get("lastOpenedAt")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            visible_directories.push(DirectoryWire {
                id,
                path,
                added_at,
                last_opened_at,
            });
        }
    }
    visible_directories
}

fn build_directory_rows_by_id_for_visible_directories(
    state: &Arc<crate::AppState>,
    preferences: &SessionsSidebarPreferences,
    configured: &[DirectoryWire],
    visible_directories: &[DirectoryWire],
    session_pages_by_directory_id: &BTreeMap<String, Value>,
    runtime_by_session_id: &Value,
    directory_sessions_page_size: usize,
) -> BTreeMap<String, DirectorySidebarViewWire> {
    let all_directories = all_known_sidebar_directories(state, configured);
    let directories_by_id = normalize_directory_wires_by_id(&all_directories);
    let directory_id_by_path = normalize_directory_id_by_path(&all_directories);
    let expanded_parent_ids = preferences
        .expanded_parent_session_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    let activity_directory_ids =
        collect_directory_activity_ids(state, runtime_by_session_id, &directory_id_by_path);

    let directory_ctx = DirectorySidebarBuildCtx {
        state,
        preferences,
        expanded_parent_ids: &expanded_parent_ids,
        directories_by_id: &directories_by_id,
        directory_id_by_path: &directory_id_by_path,
        running_directory_ids: &activity_directory_ids.running,
        blocked_directory_ids: &activity_directory_ids.blocked,
        directory_sessions_page_size,
    };

    let mut directory_rows_by_id = BTreeMap::<String, DirectorySidebarViewWire>::new();
    for directory in visible_directories {
        let page_payload = session_pages_by_directory_id.get(&directory.id);
        let section = build_directory_sidebar_view(&directory_ctx, directory, page_payload);
        directory_rows_by_id.insert(directory.id.clone(), section);
    }
    directory_rows_by_id
}

struct ChatSidebarViewBuildInput<'a> {
    state: &'a Arc<crate::AppState>,
    directories_page: &'a Value,
    session_pages_by_directory_id: &'a BTreeMap<String, Value>,
    runtime_by_session_id: &'a Value,
    recent_page: &'a Value,
    running_page: &'a Value,
    preferences: &'a SessionsSidebarPreferences,
    directory_sessions_page_size: usize,
    pinned_page_size: usize,
    recent_page_size: usize,
    running_page_size: usize,
    pinned_page: usize,
}

fn build_chat_sidebar_view(input: ChatSidebarViewBuildInput<'_>) -> ChatSidebarViewWire {
    let state = input.state;
    let visible_directories = visible_directory_wires_from_page_payload(input.directories_page);
    let all_directories = all_known_sidebar_directories(state, &visible_directories);

    let directories_by_id = normalize_directory_wires_by_id(&all_directories);
    let directory_id_by_path = normalize_directory_id_by_path(&all_directories);
    let expanded_parent_ids = input
        .preferences
        .expanded_parent_session_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();

    let directory_rows_by_id = build_directory_rows_by_id_for_visible_directories(
        state,
        input.preferences,
        &visible_directories,
        &visible_directories,
        input.session_pages_by_directory_id,
        input.runtime_by_session_id,
        input.directory_sessions_page_size,
    );

    let pinned_all_root_ids = input
        .preferences
        .pinned_session_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let mut pinned_hints = BTreeMap::<String, DirectoryWire>::new();
    for root_id in &pinned_all_root_ids {
        let Some(summary) = state.directory_session_index.summary(root_id) else {
            continue;
        };
        if let Some(directory) = directory_wire_for_path(
            &summary.directory_path,
            &directory_id_by_path,
            &directories_by_id,
        ) {
            pinned_hints.insert(root_id.clone(), directory);
        }
    }
    let pinned_footer_ctx = SidebarFooterBuildCtx {
        state,
        expanded_parent_ids: &expanded_parent_ids,
        directories_by_id: &directories_by_id,
        directory_id_by_path: &directory_id_by_path,
        root_directory_hint: &pinned_hints,
    };
    let pinned_footer = build_sidebar_footer_view(
        &pinned_footer_ctx,
        &pinned_all_root_ids,
        input.pinned_page,
        input.pinned_page_size,
    );

    let mut recent_root_ids = Vec::<String>::new();
    let mut recent_hints = BTreeMap::<String, DirectoryWire>::new();
    if let Some(items) = input
        .recent_page
        .get("items")
        .and_then(|value| value.as_array())
    {
        for item in items {
            let Some(obj) = item.as_object() else {
                continue;
            };
            let sid = obj
                .get("sessionId")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let Some(sid) = sid else {
                continue;
            };
            recent_root_ids.push(sid.clone());
            let directory = obj
                .get("directoryId")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .and_then(|did| directories_by_id.get(&did).cloned())
                .or_else(|| {
                    obj.get("directoryPath")
                        .and_then(|value| value.as_str())
                        .and_then(|path| {
                            directory_wire_for_path(path, &directory_id_by_path, &directories_by_id)
                        })
                });
            if let Some(directory) = directory {
                recent_hints.insert(sid, directory);
            }
        }
    }
    let (recent_total, recent_page_no, recent_limit) =
        parse_paged_meta(input.recent_page, input.recent_page_size);
    let recent_footer = SidebarFooterViewWire {
        total: recent_total,
        page: recent_page_no,
        page_count: std::cmp::max(
            1,
            ((std::cmp::max(recent_total, 1) as f64) / (recent_limit as f64)).ceil() as usize,
        ),
        rows: build_index_rows_from_roots(
            state,
            &recent_root_ids,
            &expanded_parent_ids,
            &directories_by_id,
            &directory_id_by_path,
            &recent_hints,
        ),
    };

    let mut running_root_ids = Vec::<String>::new();
    let mut running_hints = BTreeMap::<String, DirectoryWire>::new();
    if let Some(items) = input
        .running_page
        .get("items")
        .and_then(|value| value.as_array())
    {
        for item in items {
            let Some(obj) = item.as_object() else {
                continue;
            };
            let sid = obj
                .get("sessionId")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let Some(sid) = sid else {
                continue;
            };
            running_root_ids.push(sid.clone());
            let directory = obj
                .get("directoryId")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .and_then(|did| directories_by_id.get(&did).cloned())
                .or_else(|| {
                    obj.get("directoryPath")
                        .and_then(|value| value.as_str())
                        .and_then(|path| {
                            directory_wire_for_path(path, &directory_id_by_path, &directories_by_id)
                        })
                });
            if let Some(directory) = directory {
                running_hints.insert(sid, directory);
            }
        }
    }
    let (running_total, running_page_no, running_limit) =
        parse_paged_meta(input.running_page, input.running_page_size);
    let running_footer = SidebarFooterViewWire {
        total: running_total,
        page: running_page_no,
        page_count: std::cmp::max(
            1,
            ((std::cmp::max(running_total, 1) as f64) / (running_limit as f64)).ceil() as usize,
        ),
        rows: build_index_rows_from_roots(
            state,
            &running_root_ids,
            &expanded_parent_ids,
            &directories_by_id,
            &directory_id_by_path,
            &running_hints,
        ),
    };

    ChatSidebarViewWire {
        directory_rows_by_id,
        pinned_footer,
        recent_footer,
        running_footer,
    }
}

fn all_known_sidebar_directories(
    state: &Arc<crate::AppState>,
    configured: &[DirectoryWire],
) -> Vec<DirectoryWire> {
    let mut all_directories = configured.to_vec();
    let mut known_ids = all_directories
        .iter()
        .map(|entry| entry.id.clone())
        .collect::<HashSet<_>>();
    for recent in state.directory_session_index.recent_sessions_snapshot() {
        if known_ids.contains(&recent.directory_id) {
            continue;
        }
        known_ids.insert(recent.directory_id.clone());
        all_directories.push(DirectoryWire {
            id: recent.directory_id,
            path: recent.directory_path,
            added_at: 0,
            last_opened_at: 0,
        });
    }
    all_directories
}

pub(crate) async fn directories_get(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<DirectoriesQuery>,
) -> Response {
    let limit = parse_limit(query.limit, 50, 400);
    let offset = parse_offset(query.offset);
    let query_norm = query.query.unwrap_or_default().trim().to_lowercase();

    let settings = state.settings.read().await;
    let configured = configured_directories(&settings);
    let mut items = all_known_sidebar_directories(&state, &configured);
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

    let (resolved_directory, configured) = {
        let settings = state.settings.read().await;
        (
            directory_path_by_id(&settings, &directory_id),
            configured_directories(&settings),
        )
    };

    let Some(directory_path) = resolved_directory else {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "directory not found"})),
        )
            .into_response());
    };

    query.directory = Some(directory_path.clone());
    let limit_per_directory = query
        .limit
        .as_deref()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(SIDEBAR_STATE_DIRECTORY_SESSIONS_PAGE_SIZE_DEFAULT);
    let preferences = chat_sidebar_preferences_snapshot().await;

    let cacheable = is_cacheable_directory_sessions_query(&query);
    let delta_seq = chat_sidebar_delta_latest_seq();
    let cache_key = directory_sessions_page_cache_key(&directory_id, &query, &preferences);

    if cacheable
        && let Ok(mut cache) = DIRECTORY_SESSIONS_PAGE_CACHE.lock()
        && let Some(payload) = cache.get_fresh(&cache_key, delta_seq)
    {
        return Ok(Json(payload).into_response());
    }

    let response =
        crate::opencode_session::session_list(State(state.clone()), headers, Query(query)).await?;
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

    if payload.is_array() {
        payload = json!({
            "sessions": payload,
        });
    }

    attach_directory_tree_hint(&mut payload);

    let directories_by_id = normalize_directory_wires_by_id(&configured);
    let directory_id_by_path = normalize_directory_id_by_path(&configured);
    let runtime_by_session_id = state.directory_session_index.runtime_snapshot_json();
    let activity_directory_ids =
        collect_directory_activity_ids(&state, &runtime_by_session_id, &directory_id_by_path);
    let expanded_parent_ids = preferences
        .expanded_parent_session_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    let directory_wire = directories_by_id
        .get(&directory_id)
        .cloned()
        .unwrap_or(DirectoryWire {
            id: directory_id.clone(),
            path: directory_path,
            added_at: 0,
            last_opened_at: 0,
        });
    let directory_ctx = DirectorySidebarBuildCtx {
        state: &state,
        preferences: &preferences,
        expanded_parent_ids: &expanded_parent_ids,
        directories_by_id: &directories_by_id,
        directory_id_by_path: &directory_id_by_path,
        running_directory_ids: &activity_directory_ids.running,
        blocked_directory_ids: &activity_directory_ids.blocked,
        directory_sessions_page_size: limit_per_directory,
    };
    let section = build_directory_sidebar_view(&directory_ctx, &directory_wire, Some(&payload));
    if let Some(obj) = payload.as_object_mut() {
        obj.insert(
            "sidebarView".to_string(),
            serde_json::to_value(section).unwrap_or(Value::Null),
        );
    }

    if let Ok(mut cache) = DIRECTORY_SESSIONS_PAGE_CACHE.lock() {
        cache.insert(DirectorySessionsPageCacheEntry {
            key: cache_key,
            built_at: Instant::now(),
            delta_seq,
            payload: payload.clone(),
        });
    }

    Ok(Json(payload).into_response())
}

async fn chat_sidebar_recent_index_page(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<ChatSidebarIndexQuery>,
) -> Response {
    let limit = parse_limit(query.limit, 40, 40);
    let offset = parse_offset(query.offset);

    let delta_seq = chat_sidebar_delta_latest_seq();
    let mut items = if let Ok(cache) = SIDEBAR_INDEX_CACHE.lock() {
        if let Some(entry) = cache.recent.as_ref() {
            if cache_entry_is_fresh(entry.delta_seq, delta_seq, entry.built_at) {
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
                delta_seq,
                items: items.clone(),
            });
        }
    }

    Json(page(items, offset, limit)).into_response()
}

pub(crate) async fn chat_sidebar_session_search(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<ChatSidebarSessionSearchQuery>,
) -> Response {
    let query_norm = query
        .query
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(query_norm) = query_norm else {
        return Json(ChatSidebarSessionSearchResponse { items: Vec::new() }).into_response();
    };

    let limit = parse_limit(query.limit, 60, 200);

    let configured = {
        let settings = state.settings.read().await;
        configured_directories(&settings)
    };
    let directories_by_id = normalize_directory_wires_by_id(&configured);
    let directory_id_by_path = normalize_directory_id_by_path(&configured);

    let response = match crate::opencode_session::session_list(
        State(state.clone()),
        HeaderMap::new(),
        Query(crate::opencode_session::SessionListQuery {
            directory: None,
            scope: Some("directory".to_string()),
            roots: Some("false".to_string()),
            start: None,
            search: Some(query_norm),
            offset: Some("0".to_string()),
            limit: Some(limit.to_string()),
            include_total: Some("false".to_string()),
            include_children: Some("false".to_string()),
            ids: None,
            focus_session_id: None,
        }),
    )
    .await
    {
        Ok(response) => response,
        Err(_) => {
            return Json(ChatSidebarSessionSearchResponse { items: Vec::new() }).into_response();
        }
    };

    let Some(payload) = decode_json_response(response).await else {
        return Json(ChatSidebarSessionSearchResponse { items: Vec::new() }).into_response();
    };

    let mut items = Vec::<ChatSidebarSessionSearchHitWire>::new();
    let mut seen_session_ids = HashSet::<String>::new();

    for session in extract_sessions(&payload) {
        let Some(session_id) = session_id(&session) else {
            continue;
        };
        if !seen_session_ids.insert(session_id.clone()) {
            continue;
        }

        let directory = session_directory_path(&session)
            .and_then(|path| {
                directory_wire_for_path(&path, &directory_id_by_path, &directories_by_id)
            })
            .or_else(|| {
                state
                    .directory_session_index
                    .directory_for_session(&session_id)
                    .and_then(|path| {
                        directory_wire_for_path(&path, &directory_id_by_path, &directories_by_id)
                    })
            });
        let Some(directory) = directory else {
            continue;
        };

        items.push(ChatSidebarSessionSearchHitWire { directory, session });
        if items.len() >= limit {
            break;
        }
    }

    Json(ChatSidebarSessionSearchResponse { items }).into_response()
}

pub(crate) async fn chat_sidebar_state(
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<ChatSidebarStateQuery>,
) -> crate::ApiResult<Response> {
    crate::directory_sessions::ensure_directory_sessions_poller_started(state.clone());

    let response_cache_key = sidebar_state_cache_key(&query);
    let delta_seq_at_start = chat_sidebar_delta_latest_seq();
    if let Ok(mut cache) = SIDEBAR_STATE_RESPONSE_CACHE.lock()
        && let Some(payload) = cache.get_fresh(&response_cache_key, delta_seq_at_start)
    {
        return Ok(Json(payload).into_response());
    }

    let preferences = chat_sidebar_preferences_snapshot().await;
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
    let pinned_page = query
        .pinned_page
        .unwrap_or(preferences.pinned_sessions_page);
    let recent_page = query
        .recent_page
        .unwrap_or(preferences.recent_sessions_page);
    let running_page_no = query
        .running_page
        .unwrap_or(preferences.running_sessions_page);
    let running_page_size = parse_limit(
        query.running_page_size,
        SIDEBAR_STATE_FOOTER_PAGE_SIZE_DEFAULT,
        400,
    );
    let directories_page = query
        .directories_page
        .unwrap_or(preferences.directories_page);
    let directory_query = query
        .directory_query
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let focus_session_id = query
        .focus_session_id
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

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

    let configured_directory_id_by_path = normalize_directory_id_by_path(&configured);
    let focus_directory_id = focus_session_id.as_ref().and_then(|session_id| {
        let from_summary = state
            .directory_session_index
            .summary(session_id)
            .map(|summary| summary.directory_path);
        let from_runtime = state
            .directory_session_index
            .directory_for_session(session_id);
        from_summary
            .or(from_runtime)
            .and_then(|path| normalize_path_for_match(&path))
            .and_then(|path_key| configured_directory_id_by_path.get(&path_key).cloned())
    });
    let focus_directory_path = focus_directory_id.as_ref().and_then(|directory_id| {
        configured
            .iter()
            .find(|directory| directory.id == *directory_id)
            .map(|directory| directory.path.clone())
    });
    let focus = match (
        focus_session_id.as_ref(),
        focus_directory_id.as_ref(),
        focus_directory_path,
    ) {
        (Some(session_id), Some(directory_id), Some(directory_path)) => {
            Some(ChatSidebarFocusWire {
                session_id: session_id.clone(),
                directory_id: directory_id.clone(),
                directory_path,
            })
        }
        _ => None,
    };

    let directories_page = if query.directories_page.is_none() && directory_query.is_none() {
        if let Some(focus_directory_id) = focus_directory_id.as_ref() {
            configured
                .iter()
                .position(|directory| directory.id == *focus_directory_id)
                .map(|index| index / directories_page_size)
                .unwrap_or(directories_page)
        } else {
            directories_page
        }
    } else {
        directories_page
    };

    let directories_offset = page_to_offset(directories_page, directories_page_size);
    let directories_page_response = directories_get(
        State(state.clone()),
        Query(DirectoriesQuery {
            offset: Some(directories_offset),
            limit: Some(directories_page_size),
            query: directory_query.clone(),
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

    let should_seed_recent_index = state
        .directory_session_index
        .recent_sessions_snapshot()
        .is_empty();
    let mut expanded_ids =
        expanded_directory_ids(&configured, &preferences.collapsed_directory_ids);
    if let Some(focus_directory_id) = focus_directory_id.as_ref()
        && !expanded_ids
            .iter()
            .any(|directory_id| directory_id == focus_directory_id)
    {
        expanded_ids.push(focus_directory_id.clone());
    }
    let expanded_id_set = expanded_ids.iter().cloned().collect::<HashSet<String>>();

    let directory_page_requests = expanded_ids
        .iter()
        .map(|directory_id| {
            let root_page = preferences
                .session_root_page_by_directory_id
                .get(directory_id)
                .copied()
                .unwrap_or(0);
            let focus_for_directory =
                if focus_directory_id.as_deref() == Some(directory_id.as_str()) {
                    focus_session_id.clone()
                } else {
                    None
                };

            SidebarDirectoryPageRequest {
                directory_id: directory_id.clone(),
                root_page,
                focus_session_id: focus_for_directory,
            }
        })
        .collect::<Vec<_>>();
    let session_pages_by_directory_id = match fetch_sidebar_directory_session_pages(
        state.clone(),
        directory_page_requests,
        directory_sessions_page_size,
    )
    .await
    {
        Ok(session_pages_by_directory_id) => session_pages_by_directory_id,
        Err(response) => return Ok(response),
    };

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

    let recent_page_response = chat_sidebar_recent_index_page(
        State(state.clone()),
        Query(ChatSidebarIndexQuery {
            offset: Some(page_to_offset(recent_page, recent_page_size)),
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

    let running_items = build_running_index_items_from_runtime(
        &state,
        &runtime_by_session_id,
        &configured_directory_id_by_path,
    );
    let running_page = serde_json::to_value(page(
        running_items,
        page_to_offset(running_page_no, running_page_size),
        running_page_size,
    ))
    .unwrap_or_else(|_| {
        json!({
            "items": [],
            "total": 0,
            "offset": 0,
            "limit": running_page_size,
            "hasMore": false,
            "nextOffset": Value::Null,
        })
    });

    let view = build_chat_sidebar_view(ChatSidebarViewBuildInput {
        state: &state,
        directories_page: &directories_page,
        session_pages_by_directory_id: &session_pages_by_directory_id,
        runtime_by_session_id: &runtime_by_session_id,
        recent_page: &recent_page,
        running_page: &running_page,
        preferences: &preferences,
        directory_sessions_page_size,
        pinned_page_size: SIDEBAR_STATE_FOOTER_PAGE_SIZE_DEFAULT,
        recent_page_size,
        running_page_size,
        pinned_page,
    });

    let delta_seq = chat_sidebar_delta_latest_seq();
    let payload = serde_json::to_value(ChatSidebarStateResponse {
        preferences,
        seq,
        directories_page,
        session_pages_by_directory_id,
        runtime_by_session_id,
        recent_page,
        running_page,
        focus,
        view,
    })
    .unwrap_or(Value::Null);

    if let Ok(mut cache) = SIDEBAR_STATE_RESPONSE_CACHE.lock() {
        cache.insert(SidebarResponseCacheEntry {
            key: response_cache_key,
            built_at: Instant::now(),
            delta_seq,
            payload: payload.clone(),
        });
    }

    Ok(Json(payload).into_response())
}

async fn mutate_sidebar_preferences(
    mutator: impl FnOnce(&mut SessionsSidebarPreferences),
) -> Result<SessionsSidebarPreferences, Response> {
    let _put_guard = SIDEBAR_PREFS_PUT_LOCK.lock().await;
    let mut next = read_sidebar_preferences_cached().await;
    mutator(&mut next);

    let mut preferences = sanitize_sidebar_preferences(next);
    preferences.version = preferences.version.saturating_add(1);
    preferences.updated_at = now_millis();
    write_sidebar_preferences_cached(preferences.clone()).await;
    queue_sidebar_preferences_flush(preferences.clone());
    Ok(preferences)
}

fn trim_non_empty(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn normalize_footer_kind(raw: &str) -> Option<&'static str> {
    ChatSidebarFooterKind::parse(raw).map(|kind| kind.as_str())
}

fn list_insert_unique_front(list: &mut Vec<String>, value: &str) {
    let target = value.trim();
    if target.is_empty() {
        return;
    }
    list.retain(|entry| !entry.eq_ignore_ascii_case(target));
    list.insert(0, target.to_string());
}

fn list_remove_exact(list: &mut Vec<String>, value: &str) {
    let target = value.trim();
    if target.is_empty() {
        return;
    }
    list.retain(|entry| !entry.eq_ignore_ascii_case(target));
}

fn set_toggle_membership(list: &mut Vec<String>, value: &str, enabled: bool) {
    if enabled {
        list_insert_unique_front(list, value);
    } else {
        list_remove_exact(list, value);
    }
}

fn sidebar_patch_ops_for_command(command: &ChatSidebarCommandRequest) -> Vec<ChatSidebarPatchOp> {
    match command {
        ChatSidebarCommandRequest::DirectoriesPage { .. } => vec![
            ChatSidebarPatchOp::Preferences,
            ChatSidebarPatchOp::DirectoriesPage,
        ],
        ChatSidebarCommandRequest::DirectoryCollapsed { directory_id, .. } => vec![
            ChatSidebarPatchOp::Preferences,
            ChatSidebarPatchOp::Directory {
                directory_id: directory_id.trim().to_string(),
            },
        ],
        ChatSidebarCommandRequest::DirectoryRootPage { directory_id, .. } => vec![
            ChatSidebarPatchOp::Preferences,
            ChatSidebarPatchOp::Directory {
                directory_id: directory_id.trim().to_string(),
            },
        ],
        ChatSidebarCommandRequest::SessionPinned { .. } => vec![
            ChatSidebarPatchOp::Preferences,
            ChatSidebarPatchOp::DirectoriesPage,
            ChatSidebarPatchOp::Footer {
                kind: "pinned".to_string(),
            },
        ],
        ChatSidebarCommandRequest::SessionExpanded { .. } => vec![
            ChatSidebarPatchOp::Preferences,
            ChatSidebarPatchOp::DirectoriesPage,
            ChatSidebarPatchOp::Footer {
                kind: "pinned".to_string(),
            },
            ChatSidebarPatchOp::Footer {
                kind: "recent".to_string(),
            },
            ChatSidebarPatchOp::Footer {
                kind: "running".to_string(),
            },
        ],
        ChatSidebarCommandRequest::FooterOpen { kind, .. }
        | ChatSidebarCommandRequest::FooterPage { kind, .. } => {
            let mut ops = vec![ChatSidebarPatchOp::Preferences];
            if let Some(kind) = normalize_footer_kind(kind) {
                ops.push(ChatSidebarPatchOp::Footer {
                    kind: kind.to_string(),
                });
            }
            ops
        }
    }
}

fn build_patch_directory_view_op_from_cache(
    directory_id: &str,
    root_page: usize,
    preferences: &SessionsSidebarPreferences,
) -> Option<ChatSidebarPatchOp> {
    let did = directory_id.trim();
    if did.is_empty() {
        return None;
    }

    let query = crate::opencode_session::SessionListQuery {
        directory: None,
        scope: Some("directory".to_string()),
        roots: Some("true".to_string()),
        start: None,
        search: None,
        offset: Some(
            page_to_offset(
                root_page,
                SIDEBAR_STATE_DIRECTORY_SESSIONS_PAGE_SIZE_DEFAULT,
            )
            .to_string(),
        ),
        limit: Some(SIDEBAR_STATE_DIRECTORY_SESSIONS_PAGE_SIZE_DEFAULT.to_string()),
        include_total: Some("true".to_string()),
        include_children: Some("true".to_string()),
        ids: None,
        focus_session_id: None,
    };
    let cache_key = directory_sessions_page_cache_key(did, &query, preferences);
    let delta_seq = chat_sidebar_delta_latest_seq();
    let payload = if let Ok(mut cache) = DIRECTORY_SESSIONS_PAGE_CACHE.lock() {
        cache.get_fresh(&cache_key, delta_seq)
    } else {
        None
    }?;

    let view_raw = payload
        .get("sidebarView")
        .or_else(|| payload.get("sidebar_view"))?
        .clone();
    let view = serde_json::from_value::<DirectorySidebarViewWire>(view_raw).ok()?;
    Some(ChatSidebarPatchOp::DirectoryView {
        directory_id: did.to_string(),
        view,
    })
}

fn sidebar_patch_data_ops_for_command(
    command: &ChatSidebarCommandRequest,
    preferences: &SessionsSidebarPreferences,
) -> Vec<ChatSidebarPatchOp> {
    match command {
        ChatSidebarCommandRequest::DirectoryRootPage { directory_id, .. } => {
            let root_page = preferences
                .session_root_page_by_directory_id
                .get(directory_id.trim())
                .copied()
                .unwrap_or(0);
            build_patch_directory_view_op_from_cache(directory_id, root_page, preferences)
                .into_iter()
                .collect()
        }
        ChatSidebarCommandRequest::DirectoryCollapsed {
            directory_id,
            collapsed,
        } => {
            if *collapsed {
                Vec::new()
            } else {
                let root_page = preferences
                    .session_root_page_by_directory_id
                    .get(directory_id.trim())
                    .copied()
                    .unwrap_or(0);
                build_patch_directory_view_op_from_cache(directory_id, root_page, preferences)
                    .into_iter()
                    .collect()
            }
        }
        _ => Vec::new(),
    }
}

pub(crate) fn publish_chat_sidebar_delta_event(ops: Vec<ChatSidebarPatchOp>) -> bool {
    if ops.is_empty() {
        return false;
    }

    let seq = chat_sidebar_delta_next_seq();

    if crate::global_sse_hub::downstream_client_count() == 0 {
        return false;
    }

    let payload = serde_json::to_string(&json!({
        "type": "chat-sidebar.delta",
        "properties": {
            "seq": seq,
            "delta": {
                "ops": ops,
            }
        }
    }))
    .unwrap_or_else(|_| "{}".to_string());

    crate::global_sse_hub::publish_downstream_json(&payload);
    true
}

pub(crate) async fn chat_sidebar_commands_post(
    Json(request): Json<ChatSidebarCommandsRequest>,
) -> crate::ApiResult<Response> {
    let commands = request.into_commands();
    if commands.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "commands must not be empty" })),
        )
            .into_response());
    }

    let mut normalized_kinds = Vec::<Option<String>>::with_capacity(commands.len());
    for command in &commands {
        let normalized = match command {
            ChatSidebarCommandRequest::DirectoryCollapsed { directory_id, .. }
            | ChatSidebarCommandRequest::DirectoryRootPage { directory_id, .. } => {
                if trim_non_empty(directory_id).is_none() {
                    return Ok((
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": "directory_id is required" })),
                    )
                        .into_response());
                }
                None
            }
            ChatSidebarCommandRequest::SessionPinned { session_id, .. }
            | ChatSidebarCommandRequest::SessionExpanded { session_id, .. } => {
                if trim_non_empty(session_id).is_none() {
                    return Ok((
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": "session_id is required" })),
                    )
                        .into_response());
                }
                None
            }
            ChatSidebarCommandRequest::FooterOpen { kind, .. }
            | ChatSidebarCommandRequest::FooterPage { kind, .. } => {
                match normalize_footer_kind(kind) {
                    Some(kind) => Some(kind.to_string()),
                    None => {
                        return Ok((
                            StatusCode::BAD_REQUEST,
                            Json(json!({
                                "error": "invalid footer kind",
                                "expected": ["pinned", "recent", "running"],
                            })),
                        )
                            .into_response());
                    }
                }
            }
            _ => None,
        };
        normalized_kinds.push(normalized);
    }

    let preferences = match mutate_sidebar_preferences(|preferences| {
        for (idx, command) in commands.iter().enumerate() {
            let normalized = normalized_kinds.get(idx).and_then(|value| value.as_deref());
            match command {
                ChatSidebarCommandRequest::DirectoriesPage { page } => {
                    preferences.directories_page = *page;
                }
                ChatSidebarCommandRequest::DirectoryCollapsed {
                    directory_id,
                    collapsed,
                } => {
                    let Some(directory_id) = trim_non_empty(directory_id) else {
                        continue;
                    };
                    set_toggle_membership(
                        &mut preferences.collapsed_directory_ids,
                        &directory_id,
                        *collapsed,
                    );
                }
                ChatSidebarCommandRequest::DirectoryRootPage { directory_id, page } => {
                    let Some(directory_id) = trim_non_empty(directory_id) else {
                        continue;
                    };
                    preferences
                        .session_root_page_by_directory_id
                        .insert(directory_id, *page);
                }
                ChatSidebarCommandRequest::SessionPinned { session_id, pinned } => {
                    let Some(session_id) = trim_non_empty(session_id) else {
                        continue;
                    };
                    set_toggle_membership(
                        &mut preferences.pinned_session_ids,
                        &session_id,
                        *pinned,
                    );
                }
                ChatSidebarCommandRequest::SessionExpanded {
                    session_id,
                    expanded,
                } => {
                    let Some(session_id) = trim_non_empty(session_id) else {
                        continue;
                    };
                    set_toggle_membership(
                        &mut preferences.expanded_parent_session_ids,
                        &session_id,
                        *expanded,
                    );
                }
                ChatSidebarCommandRequest::FooterOpen { kind, open } => {
                    let kind = normalized
                        .or_else(|| normalize_footer_kind(kind))
                        .unwrap_or("pinned");
                    match kind {
                        "pinned" => preferences.pinned_sessions_open = *open,
                        "recent" => preferences.recent_sessions_open = *open,
                        "running" => preferences.running_sessions_open = *open,
                        _ => {}
                    }
                }
                ChatSidebarCommandRequest::FooterPage { kind, page } => {
                    let kind = normalized
                        .or_else(|| normalize_footer_kind(kind))
                        .unwrap_or("pinned");
                    match kind {
                        "pinned" => preferences.pinned_sessions_page = *page,
                        "recent" => preferences.recent_sessions_page = *page,
                        "running" => preferences.running_sessions_page = *page,
                        _ => {}
                    }
                }
            }
        }
    })
    .await
    {
        Ok(preferences) => preferences,
        Err(response) => return Ok(response),
    };

    let mut ops = Vec::<ChatSidebarPatchOp>::new();
    for command in &commands {
        ops.extend(sidebar_patch_ops_for_command(command));
        ops.extend(sidebar_patch_data_ops_for_command(command, &preferences));
    }
    let _ = publish_chat_sidebar_delta_event(ops.clone());

    let seq = crate::directory_sessions::directory_sessions_latest_seq();
    Ok(Json(ChatSidebarCommandsResponse {
        preferences,
        seq,
        delta: ChatSidebarDeltaWire { ops },
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
    fn cache_entry_is_fresh_requires_matching_delta_seq_and_ttl() {
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
        assert_eq!(bounded_variant_len("unknown"), 0);
        assert_eq!(SIDEBAR_INDEX_CACHE_MAX_RECENT_VARIANTS, 1);
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
        let preferences = SessionsSidebarPreferences {
            version: 7,
            updated_at: 42,
            ..Default::default()
        };

        let key = directory_sessions_page_cache_key("dir_1", &query, &preferences);
        assert!(key.contains("directoryId=dir_1"));
        assert!(key.contains("scope=directory"));
        assert!(key.contains("roots=true"));
        assert!(key.contains("includeChildren=true"));
        assert!(key.contains("includeTotal=true"));
        assert!(key.contains("offset=20"));
        assert!(key.contains("limit=10"));
        assert!(key.contains("focusSessionId=ses_focus"));
        assert!(key.contains("prefsVersion=7"));
        assert!(key.contains("prefsUpdatedAt=42"));
    }

    #[test]
    fn directory_sessions_page_cache_is_bounded_and_seq_aware() {
        let mut cache = DirectorySessionsPageCache::default();
        for i in 0..(DIRECTORY_SESSIONS_PAGE_CACHE_MAX_ENTRIES + 4) {
            cache.insert(DirectorySessionsPageCacheEntry {
                key: format!("k_{i}"),
                built_at: Instant::now(),
                delta_seq: 10,
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
            delta_seq: 7,
            payload: json!({"ok": true}),
        });
        cache.insert(DirectorySessionsPageCacheEntry {
            key: "stale".to_string(),
            built_at: Instant::now() - DIRECTORY_SESSIONS_PAGE_CACHE_TTL - Duration::from_millis(5),
            delta_seq: 7,
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

    #[test]
    fn chat_sidebar_command_request_accepts_camel_case_and_snake_case_ids() {
        let camel_directory: ChatSidebarCommandRequest = serde_json::from_value(json!({
            "type": "setDirectoryCollapsed",
            "directoryId": "dir_1",
            "collapsed": true
        }))
        .expect("camelCase directory command should deserialize");
        match camel_directory {
            ChatSidebarCommandRequest::DirectoryCollapsed {
                directory_id,
                collapsed,
            } => {
                assert_eq!(directory_id, "dir_1");
                assert!(collapsed);
            }
            _ => panic!("unexpected command variant"),
        }

        let snake_directory: ChatSidebarCommandRequest = serde_json::from_value(json!({
            "type": "setDirectoryRootPage",
            "directory_id": "dir_2",
            "page": 3
        }))
        .expect("snake_case directory command should deserialize");
        match snake_directory {
            ChatSidebarCommandRequest::DirectoryRootPage { directory_id, page } => {
                assert_eq!(directory_id, "dir_2");
                assert_eq!(page, 3);
            }
            _ => panic!("unexpected command variant"),
        }

        let camel_session: ChatSidebarCommandRequest = serde_json::from_value(json!({
            "type": "setSessionPinned",
            "sessionId": "ses_1",
            "pinned": false
        }))
        .expect("camelCase session command should deserialize");
        match camel_session {
            ChatSidebarCommandRequest::SessionPinned { session_id, pinned } => {
                assert_eq!(session_id, "ses_1");
                assert!(!pinned);
            }
            _ => panic!("unexpected command variant"),
        }

        let snake_session: ChatSidebarCommandRequest = serde_json::from_value(json!({
            "type": "setSessionExpanded",
            "session_id": "ses_2",
            "expanded": true
        }))
        .expect("snake_case session command should deserialize");
        match snake_session {
            ChatSidebarCommandRequest::SessionExpanded {
                session_id,
                expanded,
            } => {
                assert_eq!(session_id, "ses_2");
                assert!(expanded);
            }
            _ => panic!("unexpected command variant"),
        }
    }

    #[test]
    fn chat_sidebar_patch_directory_op_serializes_directory_id_as_camel_case() {
        let value = serde_json::to_value(ChatSidebarPatchOp::Directory {
            directory_id: "dir_1".to_string(),
        })
        .expect("patch op should serialize");
        assert_eq!(
            value
                .get("type")
                .and_then(|raw| raw.as_str())
                .expect("type string"),
            "invalidateDirectory"
        );
        assert_eq!(
            value
                .get("directoryId")
                .and_then(|raw| raw.as_str())
                .expect("directoryId string"),
            "dir_1"
        );
        assert!(value.get("directory_id").is_none());
    }

    #[test]
    fn chat_sidebar_patch_state_op_serializes_type() {
        let value =
            serde_json::to_value(ChatSidebarPatchOp::State).expect("patch op should serialize");
        assert_eq!(
            value
                .get("type")
                .and_then(|raw| raw.as_str())
                .expect("type string"),
            "invalidateState"
        );
    }
}
