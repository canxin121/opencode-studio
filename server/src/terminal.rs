use std::{
    collections::{BTreeMap, VecDeque},
    fs::OpenOptions,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use std::sync::atomic::{AtomicU64, Ordering};

use axum::{
    Json,
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use bytes::Bytes;
use dashmap::DashMap;
use portable_pty::ChildKiller;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::{broadcast, watch};

use crate::{ApiResult, AppError};

const MAX_TERMINAL_SESSIONS: usize = 20;
const TERMINAL_IDLE_TIMEOUT_ENV: &str = "OPENCODE_STUDIO_TERMINAL_IDLE_TIMEOUT_SECS";
const TERMINAL_CLEANUP_INTERVAL: Duration = Duration::from_secs(5 * 60);
const TERMINAL_HEARTBEAT: Duration = Duration::from_secs(15);
const TERMINAL_SESSION_REGISTRY_FILE: &str = "terminal/sessions.json";
const TERMINAL_SESSION_FILE_VERSION: u64 = 1;
const TMUX_SESSION_PREFIX: &str = "opencode-studio-";

// Replay a small scrollback on connect so the client doesn't show a blank
// (black) terminal until the next keystroke.
const TERMINAL_HISTORY_MAX_BYTES: usize = 512 * 1024;

#[derive(Debug, Error)]
pub enum TerminalError {
    #[error("Maximum terminal sessions reached")]
    LimitReached,
    #[error("Invalid working directory")]
    InvalidWorkingDirectory,
    #[error("Terminal session not found")]
    NotFound,
    #[error("Failed to create terminal session")]
    Spawn(#[source] anyhow::Error),
    #[error("Failed to stop terminal session")]
    Kill(#[source] anyhow::Error),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum PersistedTerminalBackend {
    Shell,
    Tmux,
}

impl Default for PersistedTerminalBackend {
    fn default() -> Self {
        Self::Shell
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedTerminalSession {
    cwd: String,
    cols: u16,
    rows: u16,
    backend: PersistedTerminalBackend,
    updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedTerminalRegistry {
    #[serde(default)]
    version: u64,
    #[serde(default)]
    sessions: BTreeMap<String, PersistedTerminalSession>,
}

impl Default for PersistedTerminalRegistry {
    fn default() -> Self {
        Self {
            version: TERMINAL_SESSION_FILE_VERSION,
            sessions: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum TerminalBackend {
    Shell,
    Tmux,
}

impl TerminalBackend {
    fn to_persisted(self) -> PersistedTerminalBackend {
        match self {
            Self::Shell => PersistedTerminalBackend::Shell,
            Self::Tmux => PersistedTerminalBackend::Tmux,
        }
    }
}

impl From<PersistedTerminalBackend> for TerminalBackend {
    fn from(value: PersistedTerminalBackend) -> Self {
        match value {
            PersistedTerminalBackend::Shell => Self::Shell,
            PersistedTerminalBackend::Tmux => Self::Tmux,
        }
    }
}

static TMUX_AVAILABLE: LazyLock<bool> = LazyLock::new(|| {
    std::process::Command::new("tmux")
        .arg("-V")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
});

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn terminal_idle_timeout() -> Option<Duration> {
    let Ok(raw) = std::env::var(TERMINAL_IDLE_TIMEOUT_ENV) else {
        return None;
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let Ok(secs) = trimmed.parse::<u64>() else {
        tracing::warn!(
            terminal_idle_timeout_secs = trimmed,
            "invalid terminal idle timeout value; disabling timeout"
        );
        return None;
    };

    if secs == 0 {
        return None;
    }

    Some(Duration::from_secs(secs))
}

fn terminal_session_registry_path() -> PathBuf {
    crate::settings::opencode_studio_data_dir().join(TERMINAL_SESSION_REGISTRY_FILE)
}

fn tmux_session_name(session_id: &str) -> String {
    format!("{TMUX_SESSION_PREFIX}{session_id}")
}

fn tmux_has_session(session_name: &str) -> bool {
    std::process::Command::new("tmux")
        .arg("has-session")
        .arg("-t")
        .arg(session_name)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn tmux_kill_session(session_name: &str) -> bool {
    std::process::Command::new("tmux")
        .arg("kill-session")
        .arg("-t")
        .arg(session_name)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn load_session_registry(path: &Path) -> PersistedTerminalRegistry {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return PersistedTerminalRegistry::default(),
    };

    let mut parsed = serde_json::from_str::<PersistedTerminalRegistry>(&raw).unwrap_or_default();
    if parsed.version == 0 {
        parsed.version = TERMINAL_SESSION_FILE_VERSION;
    }
    parsed
}

fn persist_session_registry(
    path: &Path,
    registry: &PersistedTerminalRegistry,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(registry).map_err(|error| error.to_string())?;
    let lock_path = path.with_extension("json.lock");
    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| error.to_string())?;
    fs2::FileExt::lock_exclusive(&lock_file).map_err(|error| error.to_string())?;

    let tmp_name = format!(
        "{}.tmp.{}.{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("terminal-sessions"),
        std::process::id(),
        now_millis(),
    );
    let tmp = path.with_file_name(tmp_name);

    let write_result = (|| {
        std::fs::write(&tmp, payload).map_err(|error| error.to_string())?;
        std::fs::rename(&tmp, path).map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    })();

    let unlock_result = fs2::FileExt::unlock(&lock_file).map_err(|error| error.to_string());

    if let Err(error) = unlock_result {
        tracing::warn!(
            registry_path = %path.display(),
            error,
            "failed to release terminal session registry lock"
        );
    }

    write_result
}

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<DashMap<String, Arc<TerminalSession>>>,
    session_registry: Arc<Mutex<PersistedTerminalRegistry>>,
    session_registry_path: Arc<PathBuf>,
    restore_lock: Arc<Mutex<()>>,
    idle_timeout: Option<Duration>,
    prefer_tmux: bool,
}

impl TerminalManager {
    pub fn new() -> Self {
        let session_registry_path = terminal_session_registry_path();
        let session_registry = load_session_registry(&session_registry_path);
        let prefer_tmux = *TMUX_AVAILABLE;
        let idle_timeout = terminal_idle_timeout();

        if prefer_tmux {
            tracing::info!("terminal persistence backend: tmux");
        } else {
            tracing::warn!("tmux not found; terminal persistence is limited to server runtime");
        }

        Self {
            sessions: Arc::new(DashMap::new()),
            session_registry: Arc::new(Mutex::new(session_registry)),
            session_registry_path: Arc::new(session_registry_path),
            restore_lock: Arc::new(Mutex::new(())),
            idle_timeout,
            prefer_tmux,
        }
    }

    fn persist_registry_with<F>(&self, mutator: F) -> bool
    where
        F: FnOnce(&mut PersistedTerminalRegistry) -> bool,
    {
        let snapshot = {
            let mut guard = self.session_registry.lock().unwrap();
            if !mutator(&mut guard) {
                return false;
            }
            if guard.version == 0 {
                guard.version = TERMINAL_SESSION_FILE_VERSION;
            }
            guard.clone()
        };

        if let Err(error) =
            persist_session_registry(self.session_registry_path.as_path(), &snapshot)
        {
            tracing::warn!(
                registry_path = %self.session_registry_path.display(),
                error,
                "failed to persist terminal session registry"
            );
        }

        true
    }

    fn persisted_session(&self, session_id: &str) -> Option<PersistedTerminalSession> {
        let sid = session_id.trim();
        if sid.is_empty() {
            return None;
        }
        let guard = self.session_registry.lock().unwrap();
        guard.sessions.get(sid).cloned()
    }

    fn upsert_persisted_session(
        &self,
        session_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        backend: PersistedTerminalBackend,
    ) {
        let sid = session_id.trim();
        if sid.is_empty() {
            return;
        }

        let sid = sid.to_string();
        let cwd = cwd.to_string();
        self.persist_registry_with(move |registry| {
            let next = PersistedTerminalSession {
                cwd,
                cols,
                rows,
                backend,
                updated_at: now_millis(),
            };

            match registry.sessions.get(&sid) {
                Some(current)
                    if current.cwd == next.cwd
                        && current.cols == next.cols
                        && current.rows == next.rows
                        && current.backend == next.backend =>
                {
                    false
                }
                _ => {
                    registry.sessions.insert(sid.clone(), next);
                    true
                }
            }
        });
    }

    fn remove_persisted_session(&self, session_id: &str) -> bool {
        let sid = session_id.trim();
        if sid.is_empty() {
            return false;
        }

        let sid = sid.to_string();
        self.persist_registry_with(move |registry| registry.sessions.remove(&sid).is_some())
    }

    fn handle_session_exit(&self, session_id: &str, session: &TerminalSession) {
        self.sessions.remove(session_id);
        if session.keep_persisted_entry_after_exit() {
            return;
        }
        self.remove_persisted_session(session_id);
    }

    fn track_session_lifecycle(&self, session_id: String, session: Arc<TerminalSession>) {
        let manager = self.clone();
        let mut exit_rx = session.subscribe_exit();
        tokio::spawn(async move {
            if *exit_rx.borrow() {
                manager.handle_session_exit(&session_id, session.as_ref());
                return;
            }

            while exit_rx.changed().await.is_ok() {
                if *exit_rx.borrow() {
                    manager.handle_session_exit(&session_id, session.as_ref());
                    break;
                }
            }
        });
    }

    fn try_restore_session(&self, session_id: &str) -> Option<Arc<TerminalSession>> {
        let sid = session_id.trim();
        if sid.is_empty() {
            return None;
        }

        if self.sessions.len() >= MAX_TERMINAL_SESSIONS {
            return None;
        }

        let _restore_guard = self.restore_lock.lock().unwrap();

        if let Some(existing) = self.sessions.get(sid) {
            return Some(existing.value().clone());
        }

        let persisted = self.persisted_session(sid)?;
        let backend = TerminalBackend::from(persisted.backend);
        if backend == TerminalBackend::Shell {
            self.remove_persisted_session(sid);
            return None;
        }

        let Ok(cwd_meta) = std::fs::metadata(&persisted.cwd) else {
            self.remove_persisted_session(sid);
            return None;
        };
        if !cwd_meta.is_dir() {
            self.remove_persisted_session(sid);
            return None;
        }

        let tmux_name = tmux_session_name(sid);
        if !tmux_has_session(&tmux_name) {
            self.remove_persisted_session(sid);
            return None;
        }

        let session = match TerminalSession::spawn(
            sid.to_string(),
            persisted.cwd,
            persisted.cols,
            persisted.rows,
            true,
        ) {
            Ok(session) => session,
            Err(error) => {
                tracing::warn!(session_id = sid, error = %error, "failed to restore terminal session");
                return None;
            }
        };

        self.sessions.insert(sid.to_string(), session.clone());
        self.track_session_lifecycle(sid.to_string(), session.clone());
        Some(session)
    }

    pub fn spawn_cleanup_task(self: Arc<Self>) {
        let Some(idle_timeout) = self.idle_timeout else {
            tracing::info!("terminal idle timeout disabled");
            return;
        };

        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(TERMINAL_CLEANUP_INTERVAL);
            loop {
                ticker.tick().await;
                let now = Instant::now();
                let mut to_remove = Vec::new();
                for entry in self.sessions.iter() {
                    let idle = {
                        let last = entry.value().last_activity.lock().unwrap();
                        now.duration_since(*last)
                    };
                    if idle > idle_timeout {
                        to_remove.push(entry.key().clone());
                    }
                }

                for id in to_remove {
                    if let Some((_, session)) = self.sessions.remove(&id) {
                        tracing::info!("Cleaning up idle terminal session: {}", id);
                        let _ = session.kill();
                        self.remove_persisted_session(&id);
                    }
                }
            }
        });
    }

    pub fn get(&self, session_id: &str) -> Option<Arc<TerminalSession>> {
        let sid = session_id.trim();
        if sid.is_empty() {
            return None;
        }

        if let Some(existing) = self.sessions.get(sid) {
            return Some(existing.value().clone());
        }

        self.try_restore_session(sid)
    }

    pub async fn create(
        &self,
        cwd: String,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalCreateResponse, TerminalError> {
        if self.sessions.len() >= MAX_TERMINAL_SESSIONS {
            return Err(TerminalError::LimitReached);
        }

        let meta = tokio::fs::metadata(&cwd)
            .await
            .map_err(|_| TerminalError::InvalidWorkingDirectory)?;
        if !meta.is_dir() {
            return Err(TerminalError::InvalidWorkingDirectory);
        }

        let session_id = crate::issue_token();

        let session = TerminalSession::spawn(
            session_id.clone(),
            cwd.clone(),
            cols,
            rows,
            self.prefer_tmux,
        )
        .map_err(TerminalError::Spawn)?;

        let backend = session.backend().to_persisted();

        self.sessions.insert(session_id.clone(), session.clone());
        self.track_session_lifecycle(session_id.clone(), session);
        self.upsert_persisted_session(&session_id, &cwd, cols, rows, backend);

        Ok(TerminalCreateResponse {
            session_id,
            cols,
            rows,
        })
    }

    pub fn remember_dimensions(&self, session_id: &str, cols: u16, rows: u16) {
        let sid = session_id.trim();
        if sid.is_empty() {
            return;
        }

        let sid = sid.to_string();
        self.persist_registry_with(move |registry| {
            let Some(entry) = registry.sessions.get_mut(&sid) else {
                return false;
            };

            if entry.cols == cols && entry.rows == rows {
                return false;
            }

            entry.cols = cols;
            entry.rows = rows;
            entry.updated_at = now_millis();
            true
        });
    }

    pub fn kill_session(&self, session_id: &str) -> Result<(), TerminalError> {
        let sid = session_id.trim();
        if sid.is_empty() {
            return Err(TerminalError::NotFound);
        }

        if let Some((_, session)) = self.sessions.remove(sid) {
            session.kill().map_err(TerminalError::Kill)?;
            self.remove_persisted_session(sid);
            return Ok(());
        }

        let Some(persisted) = self.persisted_session(sid) else {
            return Err(TerminalError::NotFound);
        };

        if persisted.backend == PersistedTerminalBackend::Tmux {
            let _ = tmux_kill_session(&tmux_session_name(sid));
        }

        self.remove_persisted_session(sid);
        Ok(())
    }
}

pub struct TerminalSession {
    pub cwd: String,
    pub last_activity: Mutex<Instant>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    tx: broadcast::Sender<TerminalEvent>,
    exit_state: watch::Sender<bool>,
    backend: TerminalBackend,
    tmux_session_name: Option<String>,

    // Keep a bounded history of recent output for new subscribers.
    seq: AtomicU64,
    history: Mutex<TerminalHistory>,
}

#[derive(Debug, Clone)]
enum TerminalEvent {
    Data {
        seq: u64,
        data: String,
    },
    Exit {
        exit_code: Option<i32>,
        signal: Option<i32>,
    },
}

#[derive(Debug, Default)]
struct TerminalHistory {
    chunks: VecDeque<(u64, String)>,
    bytes: usize,
}

impl TerminalSession {
    fn spawn(
        session_id: String,
        cwd: String,
        cols: u16,
        rows: u16,
        prefer_tmux: bool,
    ) -> Result<Arc<Self>, anyhow::Error> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut backend = TerminalBackend::Shell;
        let mut tmux_session_name_value = None;

        let child = if prefer_tmux {
            let tmux_name = tmux_session_name(&session_id);
            let mut tmux_cmd = CommandBuilder::new("tmux");
            tmux_cmd.arg("new-session");
            tmux_cmd.arg("-A");
            tmux_cmd.arg("-s");
            tmux_cmd.arg(&tmux_name);
            tmux_cmd.arg("-c");
            tmux_cmd.arg(&cwd);
            tmux_cmd.cwd(&cwd);
            tmux_cmd.env("TERM", "xterm-256color");
            tmux_cmd.env("COLORTERM", "truecolor");

            match pair.slave.spawn_command(tmux_cmd) {
                Ok(child) => {
                    backend = TerminalBackend::Tmux;
                    tmux_session_name_value = Some(tmux_name);
                    child
                }
                Err(error) => {
                    tracing::warn!(
                        session_id,
                        error = %error,
                        "failed to spawn tmux-backed terminal; falling back to shell"
                    );

                    let shell = default_shell();
                    let mut cmd = CommandBuilder::new(shell);
                    cmd.cwd(&cwd);
                    cmd.env("TERM", "xterm-256color");
                    cmd.env("COLORTERM", "truecolor");
                    pair.slave.spawn_command(cmd)?
                }
            }
        } else {
            let shell = default_shell();
            let mut cmd = CommandBuilder::new(shell);
            cmd.cwd(&cwd);

            // Parity-ish environment.
            cmd.env("TERM", "xterm-256color");
            cmd.env("COLORTERM", "truecolor");
            pair.slave.spawn_command(cmd)?
        };

        let killer = child.clone_killer();
        drop(pair.slave);

        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let master = pair.master;

        let (tx, _rx) = broadcast::channel::<TerminalEvent>(1024);
        let (exit_state, _exit_state_rx) = watch::channel(false);

        let session = Arc::new(Self {
            cwd,
            last_activity: Mutex::new(Instant::now()),
            master: Mutex::new(master),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
            tx,
            exit_state,
            backend,
            tmux_session_name: tmux_session_name_value,

            seq: AtomicU64::new(0),
            history: Mutex::new(TerminalHistory::default()),
        });

        Self::spawn_reader_task(session.clone(), reader);
        Self::spawn_wait_task(session.clone(), child);

        Ok(session)
    }

    fn backend(&self) -> TerminalBackend {
        self.backend
    }

    fn keep_persisted_entry_after_exit(&self) -> bool {
        if self.backend != TerminalBackend::Tmux {
            return false;
        }

        let Some(name) = self.tmux_session_name.as_deref() else {
            return false;
        };

        tmux_has_session(name)
    }

    fn spawn_reader_task(session: Arc<Self>, mut reader: Box<dyn Read + Send>) {
        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                        *session.last_activity.lock().unwrap() = Instant::now();

                        let seq = session.seq.fetch_add(1, Ordering::Relaxed) + 1;
                        {
                            let mut hist = session.history.lock().unwrap();
                            hist.bytes += chunk.len();
                            hist.chunks.push_back((seq, chunk.clone()));
                            while hist.bytes > TERMINAL_HISTORY_MAX_BYTES {
                                if let Some((_s, old)) = hist.chunks.pop_front() {
                                    hist.bytes = hist.bytes.saturating_sub(old.len());
                                } else {
                                    break;
                                }
                            }
                        }

                        let _ = session.tx.send(TerminalEvent::Data { seq, data: chunk });
                    }
                    Err(_) => break,
                }
            }
        });
    }

    fn snapshot_history_chunks(&self) -> Vec<(u64, String)> {
        let hist = self.history.lock().unwrap();
        hist.chunks.iter().cloned().collect()
    }

    fn spawn_wait_task(session: Arc<Self>, mut child: Box<dyn portable_pty::Child + Send + Sync>) {
        tokio::task::spawn_blocking(move || {
            // Wait for the child process to exit.
            let status = child.wait();
            let (exit_code, signal) = match status {
                Ok(status) => {
                    // portable-pty exposes a numeric exit code but doesn't reliably expose
                    // signal details across platforms; keep it null.
                    (Some(status.exit_code() as i32), None)
                }
                Err(_) => (None, None),
            };
            let _ = session.exit_state.send(true);
            let _ = session.tx.send(TerminalEvent::Exit { exit_code, signal });
        });
    }

    pub fn write(&self, data: Bytes) -> Result<(), anyhow::Error> {
        *self.last_activity.lock().unwrap() = Instant::now();
        let mut writer = self.writer.lock().unwrap();
        writer.write_all(&data)?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), anyhow::Error> {
        *self.last_activity.lock().unwrap() = Instant::now();
        let master = self.master.lock().unwrap();
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn kill(&self) -> Result<(), anyhow::Error> {
        if let Some(name) = self.tmux_session_name.as_deref() {
            let _ = tmux_kill_session(name);
        }

        // portable-pty kill is best-effort.
        let _ = self.killer.lock().unwrap().kill();
        Ok(())
    }

    fn subscribe(&self) -> broadcast::Receiver<TerminalEvent> {
        self.tx.subscribe()
    }

    fn subscribe_exit(&self) -> watch::Receiver<bool> {
        self.exit_state.subscribe()
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct TerminalStreamQuery {
    pub since: Option<String>,
}

fn parse_seq(raw: &str) -> Option<u64> {
    raw.trim().parse::<u64>().ok()
}

fn parse_last_event_id(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(parse_seq)
}

fn sse_json(payload: serde_json::Value, id: Option<u64>) -> Bytes {
    let mut out = String::new();
    if let Some(id) = id {
        out.push_str("id: ");
        out.push_str(&id.to_string());
        out.push('\n');
    }
    out.push_str("data: ");
    out.push_str(&payload.to_string());
    out.push_str("\n\n");
    Bytes::from(out)
}

fn default_shell() -> String {
    if cfg!(windows) {
        return "powershell.exe".to_string();
    }

    // Prefer $SHELL when it exists.
    if let Ok(shell) = std::env::var("SHELL")
        && !shell.trim().is_empty()
    {
        return shell;
    }

    // Fallbacks that exist on most Linux distros.
    for candidate in ["/bin/bash", "/usr/bin/bash", "/bin/sh"] {
        if Path::new(candidate).is_file() {
            return candidate.to_string();
        }
    }

    "/bin/sh".to_string()
}

#[derive(Debug, Deserialize)]
pub struct TerminalCreateBody {
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateResponse {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
pub struct TerminalResizeBody {
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Serialize)]
pub(crate) struct TerminalSuccessResponse {
    success: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalResizeResponse {
    success: bool,
    cols: u16,
    rows: u16,
}

pub async fn terminal_create(
    State(state): State<Arc<crate::AppState>>,
    Json(body): Json<TerminalCreateBody>,
) -> ApiResult<Json<TerminalCreateResponse>> {
    let cwd = body
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::bad_request("cwd is required"))?
        .to_string();

    let cols = body.cols.unwrap_or(80);
    let rows = body.rows.unwrap_or(24);

    match state.terminal.create(cwd, cols, rows).await {
        Ok(resp) => Ok(Json(resp)),
        Err(TerminalError::LimitReached) => Err(AppError::too_many_requests(
            TerminalError::LimitReached.to_string(),
        )),
        Err(TerminalError::InvalidWorkingDirectory) => Err(AppError::bad_request(
            TerminalError::InvalidWorkingDirectory.to_string(),
        )),
        Err(err) => Err(AppError::internal(err.to_string())),
    }
}

pub async fn terminal_stream(
    State(state): State<Arc<crate::AppState>>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<TerminalStreamQuery>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let session = state
        .terminal
        .get(&session_id)
        .ok_or_else(|| AppError::not_found("Terminal session not found"))?;

    *session.last_activity.lock().unwrap() = Instant::now();
    let mut rx = session.subscribe();
    let snapshot_chunks = session.snapshot_history_chunks();
    let snapshot_last_seq = snapshot_chunks.last().map(|(seq, _)| *seq).unwrap_or(0);
    let snapshot_first_seq = snapshot_chunks.first().map(|(seq, _)| *seq);

    let resume_since = query
        .since
        .as_deref()
        .and_then(parse_seq)
        .or_else(|| parse_last_event_id(&headers));
    let replay_from_seq = match (resume_since, snapshot_first_seq) {
        (Some(since), Some(first_seq)) => {
            let wanted = since.saturating_add(1);
            if wanted <= first_seq {
                first_seq
            } else if wanted > snapshot_last_seq {
                snapshot_last_seq.saturating_add(1)
            } else {
                wanted
            }
        }
        (Some(_), None) => snapshot_last_seq.saturating_add(1),
        (None, Some(first_seq)) => first_seq,
        (None, None) => snapshot_last_seq.saturating_add(1),
    };
    let needs_resync_notice = match (resume_since, snapshot_first_seq) {
        (Some(since), Some(first_seq)) => {
            let wanted = since.saturating_add(1);
            wanted < first_seq && since < snapshot_last_seq
        }
        _ => false,
    };

    let connected = {
        let payload = serde_json::json!({
            "type": "connected",
            "runtime": "rust",
            "ptyBackend": "portable-pty",
        });
        sse_json(payload, None)
    };

    let start = tokio::time::Instant::now() + TERMINAL_HEARTBEAT;
    let mut ticker = tokio::time::interval_at(start, TERMINAL_HEARTBEAT);

    let stream = async_stream::stream! {
        yield Ok::<Bytes, std::convert::Infallible>(connected);

        if needs_resync_notice {
            let payload = serde_json::json!({
                "type": "resync",
                "reason": "history_miss",
                "since": resume_since,
                "firstAvailableSeq": snapshot_first_seq,
                "lastSeq": snapshot_last_seq,
            });
            yield Ok(sse_json(payload, None));
        }

        // Replay recent output so the client immediately shows the prompt/screen.
        for (seq, chunk) in snapshot_chunks.iter() {
            if *seq < replay_from_seq {
                continue;
            }
            let payload = serde_json::json!({"type": "data", "seq": seq, "data": chunk});
            yield Ok(sse_json(payload, Some(*seq)));
        }

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    // Use SSE comments for heartbeats.
                    yield Ok(Bytes::from(": heartbeat\n\n"));
                }
                evt = rx.recv() => {
                    match evt {
                        Ok(TerminalEvent::Data { seq, data }) => {
                            // Skip any chunks that were included in the history snapshot.
                            if seq <= snapshot_last_seq {
                                continue;
                            }
                            let payload = serde_json::json!({"type": "data", "seq": seq, "data": data});
                            yield Ok(sse_json(payload, Some(seq)));
                        }
                        Ok(TerminalEvent::Exit { exit_code, signal }) => {
                            let payload = serde_json::json!({
                                "type": "exit",
                                "exitCode": exit_code,
                                "signal": signal,
                            });
                            yield Ok(sse_json(payload, None));
                            break;
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    }
                }
            }
        }
    };

    let mut resp = Response::new(Body::from_stream(stream));
    *resp.status_mut() = StatusCode::OK;
    let headers = resp.headers_mut();
    headers.insert(
        axum::http::header::CONTENT_TYPE,
        "text/event-stream".parse().unwrap(),
    );
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        "no-cache".parse().unwrap(),
    );
    headers.insert(
        axum::http::header::CONNECTION,
        "keep-alive".parse().unwrap(),
    );
    headers.insert("X-Accel-Buffering", "no".parse().unwrap());
    Ok(resp)
}

pub async fn terminal_input(
    State(state): State<Arc<crate::AppState>>,
    AxumPath(session_id): AxumPath<String>,
    body: Body,
) -> ApiResult<Json<TerminalSuccessResponse>> {
    let session = state
        .terminal
        .get(&session_id)
        .ok_or_else(|| AppError::not_found("Terminal session not found"))?;

    let bytes = match axum::body::to_bytes(body, 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return Err(AppError::payload_too_large("Input too large")),
    };

    session
        .write(bytes)
        .map_err(|err| AppError::internal(err.to_string()))?;

    Ok(Json(TerminalSuccessResponse { success: true }))
}

pub async fn terminal_resize(
    State(state): State<Arc<crate::AppState>>,
    AxumPath(session_id): AxumPath<String>,
    Json(body): Json<TerminalResizeBody>,
) -> ApiResult<Json<TerminalResizeResponse>> {
    let session = state
        .terminal
        .get(&session_id)
        .ok_or_else(|| AppError::not_found("Terminal session not found"))?;

    let (Some(cols), Some(rows)) = (body.cols, body.rows) else {
        return Err(AppError::bad_request("cols and rows are required"));
    };

    session
        .resize(cols, rows)
        .map_err(|err| AppError::internal(err.to_string()))?;
    state.terminal.remember_dimensions(&session_id, cols, rows);

    Ok(Json(TerminalResizeResponse {
        success: true,
        cols,
        rows,
    }))
}

pub async fn terminal_delete(
    State(state): State<Arc<crate::AppState>>,
    AxumPath(session_id): AxumPath<String>,
) -> ApiResult<Json<TerminalSuccessResponse>> {
    match state.terminal.kill_session(&session_id) {
        Ok(()) => Ok(Json(TerminalSuccessResponse { success: true })),
        Err(TerminalError::NotFound) => Err(AppError::not_found("Terminal session not found")),
        Err(err) => Err(AppError::internal(err.to_string())),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfoResponse {
    pub session_id: String,
    pub cwd: String,
}

pub async fn terminal_get(
    State(state): State<Arc<crate::AppState>>,
    AxumPath(session_id): AxumPath<String>,
) -> ApiResult<Json<TerminalInfoResponse>> {
    let session = state
        .terminal
        .get(&session_id)
        .ok_or_else(|| AppError::not_found("Terminal session not found"))?;
    Ok(Json(TerminalInfoResponse {
        session_id,
        cwd: session.cwd.clone(),
    }))
}

pub async fn terminal_restart(
    State(state): State<Arc<crate::AppState>>,
    AxumPath(old_session_id): AxumPath<String>,
    Json(body): Json<TerminalCreateBody>,
) -> ApiResult<Json<TerminalCreateResponse>> {
    let cwd = body
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::bad_request("cwd is required"))?
        .to_string();
    let cols = body.cols.unwrap_or(80);
    let rows = body.rows.unwrap_or(24);

    // Kill old session if it exists.
    let _ = state.terminal.kill_session(&old_session_id);

    match state.terminal.create(cwd, cols, rows).await {
        Ok(resp) => Ok(Json(resp)),
        Err(TerminalError::LimitReached) => Err(AppError::too_many_requests(
            TerminalError::LimitReached.to_string(),
        )),
        Err(TerminalError::InvalidWorkingDirectory) => Err(AppError::bad_request(
            TerminalError::InvalidWorkingDirectory.to_string(),
        )),
        Err(err) => Err(AppError::internal(err.to_string())),
    }
}
