use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use url::{Host, Url};
use uuid::Uuid;

use crate::{ApiResult, AppError};

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) opencode_session_id: Option<String>,
    pub(crate) state: String,
    pub(crate) proxy_base_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) target_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) logs_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) started_at: Option<i64>,
    pub(crate) updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) framework_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewSessionsResponse {
    pub(crate) version: u32,
    pub(crate) updated_at: i64,
    pub(crate) sessions: Vec<PreviewSessionRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
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
    plugin_state_path: PathBuf,
    studio_state_path: PathBuf,
    snapshot: PreviewSessionsResponse,
}

#[derive(Debug)]
pub(crate) struct WorkspacePreviewRegistry {
    ttl: Duration,
    cache: RwLock<Option<RegistryCache>>,
}

impl WorkspacePreviewRegistry {
    pub(crate) fn new() -> Self {
        Self::with_ttl(CACHE_TTL)
    }

    fn with_ttl(ttl: Duration) -> Self {
        Self {
            ttl,
            cache: RwLock::new(None),
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

    pub(crate) async fn create_studio_session(
        &self,
        id: String,
        directory: Option<String>,
        opencode_session_id: Option<String>,
        target_url: Url,
    ) -> ApiResult<PreviewSessionRecord> {
        let trimmed_id = id.trim();
        if trimmed_id.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }
        if !is_valid_preview_session_id(trimmed_id) {
            return Err(AppError::bad_request(
                "invalid preview session id (use ASCII letters, numbers, '_' or '-')",
            ));
        }

        let plugin_path = preview_state_path();
        let state_path = studio_preview_state_path();

        let snapshot = load_snapshot_from_paths(&plugin_path, &state_path);
        if snapshot
            .sessions
            .iter()
            .any(|session| session.id == trimmed_id)
        {
            return Err(AppError::bad_request(format!(
                "preview session already exists: {trimmed_id}"
            )));
        }

        let mut file = load_state_file_from_path(&state_path)?;
        let updated_at = now_millis();

        let opencode_session_id = opencode_session_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let record = PreviewSessionRecord {
            id: trimmed_id.to_string(),
            directory: directory.unwrap_or_default(),
            opencode_session_id,
            state: "ready".to_string(),
            proxy_base_path: preview_proxy_base_path(trimmed_id),
            target_url: Some(target_url.to_string()),
            pid: None,
            port: target_url.port_or_known_default(),
            command: None,
            args: Vec::new(),
            logs_path: None,
            started_at: None,
            updated_at,
            framework_hint: None,
            error: None,
        };

        file.version = STATE_VERSION;
        file.updated_at = updated_at;
        file.sessions.push(record.clone());
        write_state_file_atomically(&state_path, &file)?;
        self.invalidate().await;
        Ok(record)
    }

    pub(crate) async fn delete_by_id(&self, id: &str) -> ApiResult<()> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }

        let plugin_path = preview_state_path();
        let studio_path = studio_preview_state_path();
        let updated_at = now_millis();

        let mut removed_any = false;
        removed_any |= remove_session_from_path(&plugin_path, trimmed, updated_at)?;
        removed_any |= remove_session_from_path(&studio_path, trimmed, updated_at)?;

        if !removed_any {
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
        directory: Option<String>,
        opencode_session_id: Option<String>,
        target_url: Option<String>,
    ) -> ApiResult<PreviewSessionRecord> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }

        let updated_at = now_millis();
        let plugin_path = preview_state_path();
        let studio_path = studio_preview_state_path();

        if let Some(updated) = update_session_in_path(
            &studio_path,
            trimmed,
            directory.clone(),
            opencode_session_id.clone(),
            target_url.clone(),
            updated_at,
        )? {
            self.invalidate().await;
            return Ok(updated);
        }

        if let Some(updated) = update_session_in_path(
            &plugin_path,
            trimmed,
            directory,
            opencode_session_id,
            target_url,
            updated_at,
        )? {
            self.invalidate().await;
            return Ok(updated);
        }

        Err(AppError::not_found(format!(
            "preview session not found: {trimmed}"
        )))
    }

    async fn snapshot(&self) -> PreviewSessionsResponse {
        let plugin_state_path = preview_state_path();
        let studio_state_path = studio_preview_state_path();
        {
            let cache = self.cache.read().await;
            if let Some(cache) = cache.as_ref()
                && cache.plugin_state_path == plugin_state_path
                && cache.studio_state_path == studio_state_path
                && cache.loaded_at.elapsed() < self.ttl
            {
                return cache.snapshot.clone();
            }
        }

        let snapshot = load_snapshot_from_paths(&plugin_state_path, &studio_state_path);
        let cache_entry = RegistryCache {
            loaded_at: Instant::now(),
            plugin_state_path,
            studio_state_path,
            snapshot: snapshot.clone(),
        };

        let mut cache = self.cache.write().await;
        *cache = Some(cache_entry);
        snapshot
    }
}

fn remove_session_from_path(path: &Path, id: &str, updated_at: i64) -> ApiResult<bool> {
    let mut file = load_state_file_from_path(path)?;
    let before = file.sessions.len();
    file.sessions.retain(|session| session.id != id);
    if file.sessions.len() == before {
        return Ok(false);
    }
    file.version = STATE_VERSION;
    file.updated_at = updated_at;
    write_state_file_atomically(path, &file)?;
    Ok(true)
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn update_session_in_path(
    path: &Path,
    id: &str,
    directory: Option<String>,
    opencode_session_id: Option<String>,
    target_url: Option<String>,
    updated_at: i64,
) -> ApiResult<Option<PreviewSessionRecord>> {
    let mut file = load_state_file_from_path(path)?;
    let Some(index) = file.sessions.iter().position(|session| session.id == id) else {
        return Ok(None);
    };

    let mut record = file.sessions[index].clone();

    if let Some(dir) = directory {
        record.directory = dir.trim().to_string();
    }

    if let Some(value) = opencode_session_id {
        // Allow clearing by sending empty string.
        record.opencode_session_id = normalize_optional_string(Some(value));
    }

    if let Some(raw_target) = target_url {
        let target = validate_preview_target_url(&raw_target)?;
        record.target_url = Some(target.to_string());
        record.port = target.port_or_known_default();
    }

    record.updated_at = updated_at;
    record.proxy_base_path = preview_proxy_base_path(&record.id);

    file.sessions[index] = record.clone();
    file.version = STATE_VERSION;
    file.updated_at = updated_at;
    write_state_file_atomically(path, &file)?;
    Ok(Some(record))
}

fn default_state_version() -> u32 {
    STATE_VERSION
}

pub(crate) fn preview_state_path() -> PathBuf {
    state_path_from_env_or_default(PREVIEW_STATE_ENV, "preview-sessions.json")
}

pub(crate) fn studio_preview_state_path() -> PathBuf {
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
        sessions.push(session);
    }
    PreviewSessionsResponse {
        version: file.version,
        updated_at: file.updated_at,
        sessions,
    }
}

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

fn write_state_file_atomically(path: &Path, file: &PreviewSessionsFile) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            AppError::internal(format!(
                "failed to create preview session state directory {}: {err}",
                parent.to_string_lossy()
            ))
        })?;
    }

    let json = serde_json::to_string_pretty(file).map_err(|err| {
        AppError::internal(format!("failed to serialize preview sessions: {err}"))
    })?;
    let tmp = temp_state_path(path);
    std::fs::write(&tmp, json).map_err(|err| {
        AppError::internal(format!(
            "failed to write preview session state {}: {err}",
            tmp.to_string_lossy()
        ))
    })?;
    std::fs::rename(&tmp, path).map_err(|err| {
        AppError::internal(format!(
            "failed to finalize preview session state {}: {err}",
            path.to_string_lossy()
        ))
    })?;
    Ok(())
}

fn temp_state_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("preview-sessions.json");
    path.with_file_name(format!(".{file_name}.{}.tmp", Uuid::new_v4().simple()))
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
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
    let target = record
        .target_url
        .as_deref()
        .ok_or_else(|| AppError::bad_gateway("preview session is missing targetUrl"))?;
    validate_preview_target_url(target)
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
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/pv_valid-1/",
                        "targetUrl": "http://127.0.0.1:5173/",
                        "updatedAt": 42
                    },
                    {
                        "id": "pv_bad_path",
                        "directory": "/repo/app",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/wrong/",
                        "updatedAt": 42
                    },
                    {
                        "id": "bad id",
                        "directory": "/repo/app",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/bad id/",
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
    fn preview_state_path_uses_env_override_before_xdg_default() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let _override = EnvVarGuard::set(PREVIEW_STATE_ENV, "/tmp/custom-preview.json");
        let _xdg = EnvVarGuard::set(XDG_DATA_HOME_ENV, "/tmp/xdg-data");

        assert_eq!(
            preview_state_path(),
            PathBuf::from("/tmp/custom-preview.json")
        );
    }

    #[test]
    fn preview_state_path_uses_xdg_data_home_by_default() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let _override = EnvVarGuard::set(PREVIEW_STATE_ENV, "");
        let _xdg = EnvVarGuard::set(XDG_DATA_HOME_ENV, "/tmp/xdg-data");

        assert_eq!(
            preview_state_path(),
            PathBuf::from("/tmp/xdg-data/opencode/web-preview/preview-sessions.json")
        );
    }

    #[test]
    fn studio_preview_state_path_uses_env_override_before_xdg_default() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let _override =
            EnvVarGuard::set(STUDIO_PREVIEW_STATE_ENV, "/tmp/custom-studio-preview.json");
        let _xdg = EnvVarGuard::set(XDG_DATA_HOME_ENV, "/tmp/xdg-data");

        assert_eq!(
            studio_preview_state_path(),
            PathBuf::from("/tmp/custom-studio-preview.json")
        );
    }

    #[test]
    fn studio_preview_state_path_uses_xdg_data_home_by_default() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let _override = EnvVarGuard::set(STUDIO_PREVIEW_STATE_ENV, "");
        let _xdg = EnvVarGuard::set(XDG_DATA_HOME_ENV, "/tmp/xdg-data");

        assert_eq!(
            studio_preview_state_path(),
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
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/pv_shared/",
                        "targetUrl": "http://127.0.0.1:5173/",
                        "updatedAt": 40
                    },
                    {
                        "id": "pv_plugin_only",
                        "directory": "/repo/plugin-only",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/pv_plugin_only/",
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
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/pv_shared/",
                        "targetUrl": "http://127.0.0.1:4321/",
                        "updatedAt": 90
                    },
                    {
                        "id": "pv_studio_only",
                        "directory": "/repo/studio-only",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/pv_studio_only/",
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
        assert_eq!(
            merged.sessions[0].target_url.as_deref(),
            Some("http://127.0.0.1:4321/")
        );
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
