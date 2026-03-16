#[cfg(test)]
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock};
use url::{Host, Url};

use crate::{ApiResult, AppError};

use crate::studio_db;

const STATE_VERSION: u32 = 1;
const CACHE_TTL: Duration = Duration::from_millis(750);
const PREVIEW_STATE_ENV: &str = "OPENCODE_WEB_PREVIEW_STATE_PATH";
const STUDIO_PREVIEW_STATE_ENV: &str = "OPENCODE_STUDIO_PREVIEW_STATE_PATH";
const XDG_DATA_HOME_ENV: &str = "XDG_DATA_HOME";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewSessionRecord {
    pub(crate) id: String,
    pub(crate) directory: String,
    pub(crate) run_directory: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) opencode_session_id: Option<String>,
    pub(crate) state: String,
    pub(crate) proxy_base_path: String,
    pub(crate) target_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) port: Option<u16>,
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) logs_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) started_at: Option<i64>,
    pub(crate) updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) framework_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct PreviewSessionCreateRequest {
    pub(crate) id: String,
    pub(crate) directory: String,
    pub(crate) run_directory: String,
    pub(crate) opencode_session_id: Option<String>,
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) logs_path: String,
    pub(crate) target_url: Url,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PreviewSessionUpdatePatch {
    pub(crate) directory: Option<String>,
    pub(crate) run_directory: Option<String>,
    pub(crate) opencode_session_id: Option<String>,
    pub(crate) command: Option<String>,
    pub(crate) args: Option<Vec<String>>,
    pub(crate) logs_path: Option<String>,
    pub(crate) target_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewSessionsResponse {
    pub(crate) version: u32,
    pub(crate) updated_at: i64,
    pub(crate) sessions: Vec<PreviewSessionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewSessionsFile {
    #[serde(default = "default_state_version")]
    version: u32,
    #[serde(default)]
    updated_at: i64,
    #[serde(default)]
    sessions: Vec<PreviewSessionRecord>,
}

#[derive(Debug, Clone)]
struct RegistryCache {
    loaded_at: Instant,
    studio_db_path: PathBuf,
    snapshot: PreviewSessionsResponse,
}

#[derive(Debug)]
pub(crate) struct WorkspacePreviewRegistry {
    db: Arc<studio_db::StudioDb>,
    ttl: Duration,
    cache: RwLock<Option<RegistryCache>>,
    legacy_import_done: Mutex<bool>,
}

impl WorkspacePreviewRegistry {
    pub(crate) fn new(db: Arc<studio_db::StudioDb>) -> Self {
        Self::with_ttl(db, CACHE_TTL)
    }

    fn with_ttl(db: Arc<studio_db::StudioDb>, ttl: Duration) -> Self {
        Self {
            db,
            ttl,
            cache: RwLock::new(None),
            legacy_import_done: Mutex::new(false),
        }
    }

    pub(crate) async fn list_all(&self) -> PreviewSessionsResponse {
        self.snapshot().await
    }

    pub(crate) async fn get_by_id(&self, id: &str) -> Option<PreviewSessionRecord> {
        self.snapshot()
            .await
            .sessions
            .into_iter()
            .find(|session| session.id == id)
    }

    pub(crate) async fn invalidate(&self) {
        let mut cache = self.cache.write().await;
        *cache = None;
    }

    async fn ensure_legacy_plugin_state_imported(&self) {
        let mut guard = self.legacy_import_done.lock().await;
        if *guard {
            return;
        }
        *guard = true;
        drop(guard);

        let legacy_path = legacy_plugin_preview_state_path();
        let legacy_file = match load_state_file_from_path(&legacy_path) {
            Ok(file) => file,
            Err(error) => {
                tracing::warn!(
                    target: "opencode_studio.preview_registry",
                    path = %legacy_path.to_string_lossy(),
                    error = %error,
                    "Failed to load legacy plugin preview sessions"
                );
                return;
            }
        };

        let legacy_snapshot = parse_preview_sessions(legacy_file);
        if legacy_snapshot.sessions.is_empty() {
            return;
        }

        let mut studio_file = match self.load_studio_state_file().await {
            Ok(file) => file,
            Err(error) => {
                tracing::warn!(
                    target: "opencode_studio.preview_registry",
                    error = %error,
                    "Failed to load studio preview sessions for legacy import"
                );
                return;
            }
        };

        let mut changed = false;
        for session in legacy_snapshot.sessions {
            if let Some(idx) = studio_file
                .sessions
                .iter()
                .position(|existing| existing.id == session.id)
            {
                if session.updated_at > studio_file.sessions[idx].updated_at {
                    studio_file.sessions[idx] = session;
                    changed = true;
                }
                continue;
            }

            studio_file.sessions.push(session);
            changed = true;
        }

        if !changed {
            return;
        }

        studio_file.version = STATE_VERSION;
        studio_file.updated_at = now_millis();
        if let Err(error) = self.write_studio_state_file(&studio_file).await {
            tracing::warn!(
                target: "opencode_studio.preview_registry",
                error = %error,
                "Failed to persist legacy plugin preview sessions"
            );
            return;
        }

        self.invalidate().await;
    }

    async fn load_studio_state_file(&self) -> ApiResult<PreviewSessionsFile> {
        match self
            .db
            .get_json::<PreviewSessionsFile>(studio_db::KV_KEY_WORKSPACE_PREVIEW_STUDIO_STATE)
            .await
        {
            Ok(Some(file)) => Ok(file),
            Ok(None) => {
                let legacy_path = legacy_studio_preview_state_path();
                let file = load_state_file_from_path(&legacy_path)?;
                self.db
                    .set_json(studio_db::KV_KEY_WORKSPACE_PREVIEW_STUDIO_STATE, &file)
                    .await
                    .map_err(|err| {
                        AppError::internal(format!(
                            "failed to persist studio preview registry: {err}"
                        ))
                    })?;
                Ok(file)
            }
            Err(err) => Err(AppError::internal(format!(
                "failed to read studio preview registry from db: {err}"
            ))),
        }
    }

    async fn write_studio_state_file(&self, file: &PreviewSessionsFile) -> ApiResult<()> {
        self.db
            .set_json(studio_db::KV_KEY_WORKSPACE_PREVIEW_STUDIO_STATE, file)
            .await
            .map_err(|err| {
                AppError::internal(format!("failed to persist studio preview registry: {err}"))
            })?;
        Ok(())
    }

    async fn remove_session_from_studio_store(&self, id: &str, updated_at: i64) -> ApiResult<bool> {
        let mut file = self.load_studio_state_file().await?;
        let removed = remove_session_from_file(&mut file, id, updated_at);
        if !removed {
            return Ok(false);
        }
        self.write_studio_state_file(&file).await?;
        Ok(true)
    }

    async fn update_session_in_studio_store(
        &self,
        id: &str,
        patch: PreviewSessionUpdatePatch,
        updated_at: i64,
    ) -> ApiResult<Option<PreviewSessionRecord>> {
        let mut file = self.load_studio_state_file().await?;
        let updated = update_session_in_file(&mut file, id, patch, updated_at)?;
        if updated.is_some() {
            self.write_studio_state_file(&file).await?;
        }
        Ok(updated)
    }

    async fn rename_session_in_studio_store(
        &self,
        id: &str,
        new_id: &str,
        updated_at: i64,
    ) -> ApiResult<Option<PreviewSessionRecord>> {
        let mut file = self.load_studio_state_file().await?;
        let updated = rename_session_in_file(&mut file, id, new_id, updated_at)?;
        if updated.is_some() {
            self.write_studio_state_file(&file).await?;
        }
        Ok(updated)
    }

    async fn mark_running_in_studio_store(
        &self,
        id: &str,
        pid: u32,
        updated_at: i64,
    ) -> ApiResult<Option<PreviewSessionRecord>> {
        let mut file = self.load_studio_state_file().await?;
        let updated = mark_running_in_file(&mut file, id, pid, updated_at)?;
        if updated.is_some() {
            self.write_studio_state_file(&file).await?;
        }
        Ok(updated)
    }

    async fn mark_stopped_in_studio_store(
        &self,
        id: &str,
        error: Option<String>,
        updated_at: i64,
    ) -> ApiResult<Option<PreviewSessionRecord>> {
        let mut file = self.load_studio_state_file().await?;
        let updated = mark_stopped_in_file(&mut file, id, error, updated_at)?;
        if updated.is_some() {
            self.write_studio_state_file(&file).await?;
        }
        Ok(updated)
    }

    pub(crate) async fn create_studio_session(
        &self,
        request: PreviewSessionCreateRequest,
    ) -> ApiResult<PreviewSessionRecord> {
        let PreviewSessionCreateRequest {
            id,
            directory,
            run_directory,
            opencode_session_id,
            command,
            args,
            logs_path,
            target_url,
        } = request;
        let trimmed_id = id.trim();
        if trimmed_id.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }
        if !is_valid_preview_session_id(trimmed_id) {
            return Err(AppError::bad_request(
                "invalid preview session id (use ASCII letters, numbers, '_' or '-')",
            ));
        }

        self.ensure_legacy_plugin_state_imported().await;

        let mut file = self.load_studio_state_file().await?;
        if file.sessions.iter().any(|session| session.id == trimmed_id) {
            return Err(AppError::bad_request(format!(
                "preview session already exists: {trimmed_id}"
            )));
        }

        let updated_at = now_millis();

        let trimmed_directory = directory.trim();
        if trimmed_directory.is_empty() {
            return Err(AppError::bad_request("directory is required"));
        }
        let trimmed_run_directory = run_directory.trim();
        let resolved_run_directory = if trimmed_run_directory.is_empty() {
            trimmed_directory
        } else {
            trimmed_run_directory
        };
        let trimmed_command = command.trim();
        if trimmed_command.is_empty() {
            return Err(AppError::bad_request("command is required"));
        }
        let trimmed_logs_path = logs_path.trim();
        let resolved_logs_path = if trimmed_logs_path.is_empty() {
            default_preview_logs_path(self.db.path(), trimmed_id)
        } else {
            trimmed_logs_path.to_string()
        };

        let args = args
            .into_iter()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .collect::<Vec<_>>();
        if args.is_empty() {
            return Err(AppError::bad_request("args is required"));
        }

        let opencode_session_id = opencode_session_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let record = PreviewSessionRecord {
            id: trimmed_id.to_string(),
            directory: trimmed_directory.to_string(),
            run_directory: resolved_run_directory.to_string(),
            opencode_session_id,
            state: "stopped".to_string(),
            proxy_base_path: preview_proxy_base_path(trimmed_id),
            target_url: target_url.to_string(),
            pid: None,
            port: target_url.port_or_known_default(),
            command: trimmed_command.to_string(),
            args,
            logs_path: resolved_logs_path,
            started_at: None,
            updated_at,
            framework_hint: None,
            error: None,
        };

        file.version = STATE_VERSION;
        file.updated_at = updated_at;
        file.sessions.push(record.clone());
        self.write_studio_state_file(&file).await?;
        self.invalidate().await;
        Ok(record)
    }

    pub(crate) async fn delete_by_id(&self, id: &str) -> ApiResult<()> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }

        self.ensure_legacy_plugin_state_imported().await;
        let updated_at = now_millis();

        if !self
            .remove_session_from_studio_store(trimmed, updated_at)
            .await?
        {
            return Err(AppError::not_found(format!(
                "preview session not found: {trimmed}"
            )));
        }

        self.invalidate().await;
        Ok(())
    }

    pub(crate) async fn update_by_id(
        &self,
        id: &str,
        patch: PreviewSessionUpdatePatch,
    ) -> ApiResult<PreviewSessionRecord> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }

        self.ensure_legacy_plugin_state_imported().await;
        let updated_at = now_millis();

        if let Some(updated) = self
            .update_session_in_studio_store(trimmed, patch.clone(), updated_at)
            .await?
        {
            self.invalidate().await;
            return Ok(updated);
        }

        Err(AppError::not_found(format!(
            "preview session not found: {trimmed}"
        )))
    }

    pub(crate) async fn rename_by_id(
        &self,
        id: &str,
        new_id: &str,
    ) -> ApiResult<PreviewSessionRecord> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }

        let trimmed_new = new_id.trim();
        if trimmed_new.is_empty() {
            return Err(AppError::bad_request("new id is required"));
        }
        if !is_valid_preview_session_id(trimmed_new) {
            return Err(AppError::bad_request(
                "invalid preview session id (use ASCII letters, numbers, '_' or '-')",
            ));
        }

        if trimmed == trimmed_new {
            return self.get_by_id(trimmed).await.ok_or_else(|| {
                AppError::not_found(format!("preview session not found: {trimmed}"))
            });
        }

        self.ensure_legacy_plugin_state_imported().await;

        let studio_file = self.load_studio_state_file().await?;
        if studio_file
            .sessions
            .iter()
            .any(|session| session.id == trimmed_new)
        {
            return Err(AppError::bad_request(format!(
                "preview session already exists: {trimmed_new}"
            )));
        }

        let updated_at = now_millis();

        let updated = self
            .rename_session_in_studio_store(trimmed, trimmed_new, updated_at)
            .await?
            .ok_or_else(|| AppError::not_found(format!("preview session not found: {trimmed}")))?;

        self.invalidate().await;
        Ok(updated)
    }

    pub(crate) async fn mark_running_by_id(
        &self,
        id: &str,
        pid: u32,
    ) -> ApiResult<PreviewSessionRecord> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }

        self.ensure_legacy_plugin_state_imported().await;
        let updated_at = now_millis();

        if let Some(updated) = self
            .mark_running_in_studio_store(trimmed, pid, updated_at)
            .await?
        {
            self.invalidate().await;
            return Ok(updated);
        }

        Err(AppError::not_found(format!(
            "preview session not found: {trimmed}"
        )))
    }

    pub(crate) async fn mark_stopped_by_id(
        &self,
        id: &str,
        error: Option<String>,
    ) -> ApiResult<PreviewSessionRecord> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }

        self.ensure_legacy_plugin_state_imported().await;
        let updated_at = now_millis();

        if let Some(updated) = self
            .mark_stopped_in_studio_store(trimmed, error.clone(), updated_at)
            .await?
        {
            self.invalidate().await;
            return Ok(updated);
        }

        Err(AppError::not_found(format!(
            "preview session not found: {trimmed}"
        )))
    }

    async fn snapshot(&self) -> PreviewSessionsResponse {
        self.ensure_legacy_plugin_state_imported().await;
        let studio_db_path = self.db.path().to_path_buf();
        {
            let cache = self.cache.read().await;
            if let Some(cache) = cache.as_ref()
                && cache.studio_db_path == studio_db_path
                && cache.loaded_at.elapsed() < self.ttl
            {
                return cache.snapshot.clone();
            }
        }

        let studio_snapshot = match self.load_studio_state_file().await {
            Ok(file) => parse_preview_sessions(file),
            Err(error) => {
                tracing::warn!(
                    target: "opencode_studio.preview_registry",
                    error = %error,
                    "Failed to load studio preview registry from db"
                );
                empty_snapshot()
            }
        };
        let snapshot = studio_snapshot;
        let cache_entry = RegistryCache {
            loaded_at: Instant::now(),
            studio_db_path,
            snapshot: snapshot.clone(),
        };

        let mut cache = self.cache.write().await;
        *cache = Some(cache_entry);
        snapshot
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn remove_session_from_file(file: &mut PreviewSessionsFile, id: &str, updated_at: i64) -> bool {
    let before = file.sessions.len();
    file.sessions.retain(|session| session.id != id);
    if file.sessions.len() == before {
        return false;
    }
    file.version = STATE_VERSION;
    file.updated_at = updated_at;
    true
}

fn update_session_in_file(
    file: &mut PreviewSessionsFile,
    id: &str,
    patch: PreviewSessionUpdatePatch,
    updated_at: i64,
) -> ApiResult<Option<PreviewSessionRecord>> {
    let Some(index) = file.sessions.iter().position(|session| session.id == id) else {
        return Ok(None);
    };

    let mut record = file.sessions[index].clone();

    if let Some(dir) = patch.directory {
        let trimmed = dir.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("directory is required"));
        }
        record.directory = trimmed.to_string();
    }

    if let Some(dir) = patch.run_directory {
        let trimmed = dir.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("runDirectory is required"));
        }
        record.run_directory = trimmed.to_string();
    }

    if let Some(value) = patch.opencode_session_id {
        // Allow clearing by sending empty string.
        record.opencode_session_id = normalize_optional_string(Some(value));
    }

    if let Some(cmd) = patch.command {
        let trimmed = cmd.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("command is required"));
        }
        record.command = trimmed.to_string();
    }

    if let Some(next) = patch.args {
        let next = next
            .into_iter()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .collect::<Vec<_>>();
        if next.is_empty() {
            return Err(AppError::bad_request("args is required"));
        }
        record.args = next;
    }

    if let Some(path) = patch.logs_path {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("logsPath is required"));
        }
        record.logs_path = trimmed.to_string();
    }

    if let Some(raw_target) = patch.target_url {
        let target = validate_preview_target_url(&raw_target)?;
        record.target_url = target.to_string();
        record.port = target.port_or_known_default();
    }

    record.updated_at = updated_at;
    record.proxy_base_path = preview_proxy_base_path(&record.id);

    file.sessions[index] = record.clone();
    file.version = STATE_VERSION;
    file.updated_at = updated_at;
    Ok(Some(record))
}

fn mark_running_in_file(
    file: &mut PreviewSessionsFile,
    id: &str,
    pid: u32,
    updated_at: i64,
) -> ApiResult<Option<PreviewSessionRecord>> {
    let Some(index) = file.sessions.iter().position(|session| session.id == id) else {
        return Ok(None);
    };

    let mut record = file.sessions[index].clone();
    record.state = "running".to_string();
    record.pid = Some(pid);
    record.started_at = Some(updated_at);
    record.updated_at = updated_at;
    record.error = None;

    file.sessions[index] = record.clone();
    file.version = STATE_VERSION;
    file.updated_at = updated_at;
    Ok(Some(record))
}

fn mark_stopped_in_file(
    file: &mut PreviewSessionsFile,
    id: &str,
    error: Option<String>,
    updated_at: i64,
) -> ApiResult<Option<PreviewSessionRecord>> {
    let Some(index) = file.sessions.iter().position(|session| session.id == id) else {
        return Ok(None);
    };

    let mut record = file.sessions[index].clone();
    record.state = "stopped".to_string();
    record.pid = None;
    record.updated_at = updated_at;
    record.error = error.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    file.sessions[index] = record.clone();
    file.version = STATE_VERSION;
    file.updated_at = updated_at;
    Ok(Some(record))
}

fn rename_session_in_file(
    file: &mut PreviewSessionsFile,
    id: &str,
    new_id: &str,
    updated_at: i64,
) -> ApiResult<Option<PreviewSessionRecord>> {
    let mut updated: Option<PreviewSessionRecord> = None;
    let mut touched = false;
    for session in file.sessions.iter_mut() {
        if session.id != id {
            continue;
        }
        session.id = new_id.to_string();
        session.proxy_base_path = preview_proxy_base_path(&session.id);
        session.updated_at = updated_at;
        touched = true;
        if updated.is_none() {
            updated = Some(session.clone());
        }
    }

    if !touched {
        return Ok(None);
    }

    file.version = STATE_VERSION;
    file.updated_at = updated_at;
    Ok(updated)
}

fn default_state_version() -> u32 {
    STATE_VERSION
}

fn legacy_plugin_preview_state_path() -> PathBuf {
    state_path_from_env_or_default(PREVIEW_STATE_ENV, "preview-sessions.json")
}

fn legacy_studio_preview_state_path() -> PathBuf {
    state_path_from_env_or_default(STUDIO_PREVIEW_STATE_ENV, "studio-preview-sessions.json")
}

fn state_path_from_env_or_default(env_key: &str, file_name: &str) -> PathBuf {
    if let Ok(path) = std::env::var(env_key) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    preview_state_root()
        .join("opencode")
        .join("web-preview")
        .join(file_name)
}

fn preview_state_root() -> PathBuf {
    if let Ok(path) = std::env::var(XDG_DATA_HOME_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    crate::path_utils::data_home_dir()
}

#[cfg(test)]
fn load_snapshot_from_path(path: &Path) -> PreviewSessionsResponse {
    match load_state_file_from_path(path) {
        Ok(file) => parse_preview_sessions(file),
        Err(err) => {
            tracing::warn!(
                target: "opencode_studio.preview_registry",
                path = %path.to_string_lossy(),
                error = %err,
                "Failed to parse preview session registry"
            );
            empty_snapshot()
        }
    }
}

#[cfg(test)]
fn load_snapshot_from_paths(plugin_path: &Path, studio_path: &Path) -> PreviewSessionsResponse {
    merge_preview_snapshots(
        load_snapshot_from_path(plugin_path),
        load_snapshot_from_path(studio_path),
    )
}

fn load_state_file_from_path(path: &Path) -> ApiResult<PreviewSessionsFile> {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return Ok(PreviewSessionsFile {
            version: STATE_VERSION,
            updated_at: 0,
            sessions: Vec::new(),
        });
    };

    serde_json::from_str(&contents).map_err(|err| {
        AppError::internal(format!(
            "invalid preview registry JSON at {}: {err}",
            path.to_string_lossy()
        ))
    })
}

fn empty_snapshot() -> PreviewSessionsResponse {
    PreviewSessionsResponse {
        version: STATE_VERSION,
        updated_at: 0,
        sessions: Vec::new(),
    }
}

#[cfg(test)]
fn parse_preview_sessions_file(contents: &str) -> ApiResult<PreviewSessionsResponse> {
    let file: PreviewSessionsFile = serde_json::from_str(contents)
        .map_err(|err| AppError::bad_request(format!("invalid preview registry JSON: {err}")))?;

    Ok(parse_preview_sessions(file))
}

fn parse_preview_sessions(file: PreviewSessionsFile) -> PreviewSessionsResponse {
    let mut sessions = Vec::with_capacity(file.sessions.len());
    for session in file.sessions {
        if !is_valid_preview_session_id(&session.id) {
            continue;
        }
        if !is_valid_proxy_base_path(&session.id, &session.proxy_base_path) {
            continue;
        }
        if session.directory.trim().is_empty() {
            continue;
        }
        if session.run_directory.trim().is_empty() {
            continue;
        }
        if session.command.trim().is_empty() {
            continue;
        }
        if session.args.is_empty() {
            continue;
        }
        if session.logs_path.trim().is_empty() {
            continue;
        }
        if session.target_url.trim().is_empty() {
            continue;
        }
        if validate_preview_target_url(&session.target_url).is_err() {
            continue;
        }
        sessions.push(session);
    }
    PreviewSessionsResponse {
        version: file.version,
        updated_at: file.updated_at,
        sessions,
    }
}

#[cfg(test)]
fn merge_preview_snapshots(
    plugin: PreviewSessionsResponse,
    studio: PreviewSessionsResponse,
) -> PreviewSessionsResponse {
    let updated_at = plugin.updated_at.max(studio.updated_at);
    let version = plugin.version.max(studio.version).max(STATE_VERSION);
    let mut merged = HashMap::with_capacity(plugin.sessions.len() + studio.sessions.len());

    for session in plugin.sessions {
        merged.insert(session.id.clone(), session);
    }
    for session in studio.sessions {
        merged.insert(session.id.clone(), session);
    }

    let mut sessions = merged.into_values().collect::<Vec<_>>();
    sessions.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    PreviewSessionsResponse {
        version,
        updated_at,
        sessions,
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn default_preview_logs_path(studio_db_path: &Path, id: &str) -> String {
    let root = studio_db_path.parent().unwrap_or_else(|| Path::new("."));
    root.join("workspace-preview")
        .join("logs")
        .join(format!("{id}.log"))
        .to_string_lossy()
        .into_owned()
}

fn is_valid_preview_session_id(id: &str) -> bool {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Keep IDs URL-safe: used in /api/workspace/preview/s/{id}/ proxy paths.
    trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn is_valid_proxy_base_path(id: &str, proxy_base_path: &str) -> bool {
    proxy_base_path == preview_proxy_base_path(id)
}

pub(crate) fn validate_preview_target_url(raw: &str) -> ApiResult<Url> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_request("target is required"));
    }

    let url = Url::parse(trimmed)
        .map_err(|err| AppError::bad_request(format!("invalid target URL: {err}")))?;
    validate_preview_target(&url)
}

pub(crate) fn validate_preview_target(url: &Url) -> ApiResult<Url> {
    match url.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(AppError::bad_request(
                "target URL must use http or https protocol",
            ));
        }
    }

    let host = url
        .host()
        .ok_or_else(|| AppError::bad_request("target URL host is required"))?;
    if !is_allowed_loopback_host(host) {
        return Err(AppError::bad_request(
            "target URL must use localhost, 127.0.0.1, or [::1]",
        ));
    }

    let mut normalized = url.clone();
    if normalized.path().is_empty() {
        normalized.set_path("/");
    }
    normalized.set_fragment(None);
    Ok(normalized)
}

fn is_allowed_loopback_host(host: Host<&str>) -> bool {
    match host {
        Host::Domain(domain) => domain.eq_ignore_ascii_case("localhost"),
        Host::Ipv4(ipv4) => ipv4.octets() == [127, 0, 0, 1],
        Host::Ipv6(ipv6) => ipv6.is_loopback(),
    }
}

pub(crate) fn preview_proxy_base_path(id: &str) -> String {
    format!("/api/workspace/preview/s/{id}/")
}

pub(crate) fn preview_target_from_record(record: &PreviewSessionRecord) -> ApiResult<Url> {
    let trimmed = record.target_url.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_gateway(
            "preview session is missing targetUrl",
        ));
    }
    validate_preview_target_url(trimmed)
}

pub(crate) fn build_proxy_target_url(
    target: &Url,
    request_path: Option<&str>,
    query: Option<&str>,
) -> Url {
    let mut upstream = target.clone();
    if let Some(path) = request_path {
        let trimmed = path.trim_start_matches('/');
        if !trimmed.is_empty() {
            let base = upstream.path().trim_end_matches('/');
            let next_path = if base.is_empty() || base == "/" {
                format!("/{trimmed}")
            } else {
                format!("{base}/{trimmed}")
            };
            upstream.set_path(&next_path);
        }
    }
    upstream.set_query(query);
    upstream
}

pub(crate) fn websocket_target_url(
    target: &Url,
    request_path: Option<&str>,
    query: Option<&str>,
) -> Url {
    let mut upstream = build_proxy_target_url(target, request_path, query);
    let scheme = match upstream.scheme() {
        "https" => "wss",
        _ => "ws",
    };
    let _ = upstream.set_scheme(scheme);
    upstream
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ENV_LOCK;

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let previous = std::env::var(key).ok();
            unsafe {
                std::env::set_var(key, value);
            }
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            unsafe {
                match self.previous.as_deref() {
                    Some(value) => std::env::set_var(self.key, value),
                    None => std::env::remove_var(self.key),
                }
            }
        }
    }

    #[test]
    fn parse_preview_sessions_filters_invalid_records_and_directory_matches() {
        let snapshot = parse_preview_sessions_file(
            r#"{
                "version": 1,
                "updatedAt": 42,
                "sessions": [
                    {
                        "id": "pv_valid-1",
                        "directory": "/repo/app/",
                        "runDirectory": "/repo/app/",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/pv_valid-1/",
                        "targetUrl": "http://127.0.0.1:5173/",
                        "command": "bun",
                        "args": ["run", "dev"],
                        "logsPath": ".opencode/preview/pv_valid-1.log",
                        "updatedAt": 42
                    },
                    {
                        "id": "pv_bad_path",
                        "directory": "/repo/app",
                        "runDirectory": "/repo/app",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/wrong/",
                        "targetUrl": "http://127.0.0.1:5173/",
                        "command": "bun",
                        "args": ["run", "dev"],
                        "logsPath": ".opencode/preview/pv_bad_path.log",
                        "updatedAt": 42
                    },
                    {
                        "id": "bad id",
                        "directory": "/repo/app",
                        "runDirectory": "/repo/app",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/bad id/",
                        "targetUrl": "http://127.0.0.1:5173/",
                        "command": "bun",
                        "args": ["run", "dev"],
                        "logsPath": ".opencode/preview/bad-id.log",
                        "updatedAt": 42
                    }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(snapshot.version, 1);
        assert_eq!(snapshot.updated_at, 42);
        assert_eq!(snapshot.sessions.len(), 1);
        assert_eq!(snapshot.sessions[0].id, "pv_valid-1");
        assert_eq!(
            crate::path_utils::normalize_directory_for_match(&snapshot.sessions[0].directory),
            crate::path_utils::normalize_directory_for_match("/repo/app")
        );
    }

    #[test]
    fn legacy_plugin_state_path_uses_env_override_before_xdg_default() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let _override = EnvVarGuard::set(PREVIEW_STATE_ENV, "/tmp/custom-preview.json");
        let _xdg = EnvVarGuard::set(XDG_DATA_HOME_ENV, "/tmp/xdg-data");

        assert_eq!(
            legacy_plugin_preview_state_path(),
            PathBuf::from("/tmp/custom-preview.json")
        );
    }

    #[test]
    fn legacy_plugin_state_path_uses_xdg_data_home_by_default() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let _override = EnvVarGuard::set(PREVIEW_STATE_ENV, "");
        let _xdg = EnvVarGuard::set(XDG_DATA_HOME_ENV, "/tmp/xdg-data");

        assert_eq!(
            legacy_plugin_preview_state_path(),
            PathBuf::from("/tmp/xdg-data/opencode/web-preview/preview-sessions.json")
        );
    }

    #[test]
    fn legacy_studio_state_path_uses_env_override_before_xdg_default() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let _override =
            EnvVarGuard::set(STUDIO_PREVIEW_STATE_ENV, "/tmp/custom-studio-preview.json");
        let _xdg = EnvVarGuard::set(XDG_DATA_HOME_ENV, "/tmp/xdg-data");

        assert_eq!(
            legacy_studio_preview_state_path(),
            PathBuf::from("/tmp/custom-studio-preview.json")
        );
    }

    #[test]
    fn legacy_studio_state_path_uses_xdg_data_home_by_default() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let _override = EnvVarGuard::set(STUDIO_PREVIEW_STATE_ENV, "");
        let _xdg = EnvVarGuard::set(XDG_DATA_HOME_ENV, "/tmp/xdg-data");

        assert_eq!(
            legacy_studio_preview_state_path(),
            PathBuf::from("/tmp/xdg-data/opencode/web-preview/studio-preview-sessions.json")
        );
    }

    #[test]
    fn load_snapshot_from_paths_merges_plugin_and_studio_records_with_studio_precedence() {
        let temp = tempfile::tempdir().expect("tempdir");
        let plugin_path = temp.path().join("preview-sessions.json");
        let studio_path = temp.path().join("studio-preview-sessions.json");

        std::fs::write(
            &plugin_path,
            r#"{
                "version": 1,
                "updatedAt": 40,
                "sessions": [
                    {
                        "id": "pv_shared",
                        "directory": "/repo/plugin",
                        "runDirectory": "/repo/plugin",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/pv_shared/",
                        "targetUrl": "http://127.0.0.1:5173/",
                        "command": "bun",
                        "args": ["run", "dev"],
                        "logsPath": ".opencode/preview/pv_shared.log",
                        "updatedAt": 40
                    },
                    {
                        "id": "pv_plugin_only",
                        "directory": "/repo/plugin-only",
                        "runDirectory": "/repo/plugin-only",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/pv_plugin_only/",
                        "targetUrl": "http://127.0.0.1:5173/",
                        "command": "bun",
                        "args": ["run", "dev"],
                        "logsPath": ".opencode/preview/pv_plugin_only.log",
                        "updatedAt": 20
                    }
                ]
            }"#,
        )
        .expect("write plugin state");
        std::fs::write(
            &studio_path,
            r#"{
                "version": 1,
                "updatedAt": 90,
                "sessions": [
                    {
                        "id": "pv_shared",
                        "directory": "/repo/studio",
                        "runDirectory": "/repo/studio",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/pv_shared/",
                        "targetUrl": "http://127.0.0.1:4321/",
                        "command": "bun",
                        "args": ["run", "dev"],
                        "logsPath": ".opencode/preview/pv_shared.log",
                        "updatedAt": 90
                    },
                    {
                        "id": "pv_studio_only",
                        "directory": "/repo/studio-only",
                        "runDirectory": "/repo/studio-only",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/pv_studio_only/",
                        "targetUrl": "http://127.0.0.1:5173/",
                        "command": "bun",
                        "args": ["run", "dev"],
                        "logsPath": ".opencode/preview/pv_studio_only.log",
                        "updatedAt": 60
                    }
                ]
            }"#,
        )
        .expect("write studio state");

        let merged = load_snapshot_from_paths(&plugin_path, &studio_path);

        assert_eq!(merged.updated_at, 90);
        assert_eq!(
            merged
                .sessions
                .iter()
                .map(|session| session.id.as_str())
                .collect::<Vec<_>>(),
            vec!["pv_shared", "pv_studio_only", "pv_plugin_only"]
        );
        assert_eq!(merged.sessions[0].directory, "/repo/studio");
        assert_eq!(merged.sessions[0].target_url, "http://127.0.0.1:4321/");
    }

    #[test]
    fn validate_preview_target_accepts_loopback_hosts() {
        assert!(validate_preview_target_url("http://localhost:5173").is_ok());
        assert!(validate_preview_target_url("https://127.0.0.1:8080/path").is_ok());
        assert!(validate_preview_target_url("http://[::1]:3000").is_ok());
    }

    #[test]
    fn validate_preview_target_rejects_non_loopback_hosts() {
        assert!(validate_preview_target_url("http://example.com:5173").is_err());
        assert!(validate_preview_target_url("http://127.0.0.2:5173").is_err());
        assert!(validate_preview_target_url("http://[::2]:5173").is_err());
    }

    #[test]
    fn validate_preview_target_rejects_invalid_urls() {
        assert!(validate_preview_target_url("").is_err());
        assert!(validate_preview_target_url("localhost:5173").is_err());
        assert!(validate_preview_target_url("ftp://localhost:21").is_err());
        assert!(validate_preview_target_url("http://localhost:99999").is_err());
    }
}
