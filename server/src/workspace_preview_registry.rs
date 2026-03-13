use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use url::{Host, Url};

use crate::{ApiResult, AppError};

const STATE_VERSION: u32 = 1;
const CACHE_TTL: Duration = Duration::from_millis(750);
const PREVIEW_STATE_ENV: &str = "OPENCODE_WEB_PREVIEW_STATE_PATH";
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

#[derive(Debug, Deserialize)]
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
    state_path: PathBuf,
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

    pub(crate) async fn list_by_directory(&self, directory: &str) -> PreviewSessionsResponse {
        let normalized = crate::path_utils::normalize_directory_for_match(directory);
        let mut snapshot = self.snapshot().await;
        snapshot.sessions.retain(|session| {
            crate::path_utils::normalize_directory_for_match(&session.directory) == normalized
        });
        snapshot
    }

    pub(crate) async fn get_by_id(&self, id: &str) -> Option<PreviewSessionRecord> {
        self.snapshot()
            .await
            .sessions
            .into_iter()
            .find(|session| session.id == id)
    }

    async fn snapshot(&self) -> PreviewSessionsResponse {
        let state_path = preview_state_path();
        {
            let cache = self.cache.read().await;
            if let Some(cache) = cache.as_ref()
                && cache.state_path == state_path
                && cache.loaded_at.elapsed() < self.ttl
            {
                return cache.snapshot.clone();
            }
        }

        let snapshot = load_snapshot_from_path(&state_path);
        let cache_entry = RegistryCache {
            loaded_at: Instant::now(),
            state_path,
            snapshot: snapshot.clone(),
        };

        let mut cache = self.cache.write().await;
        *cache = Some(cache_entry);
        snapshot
    }
}

fn default_state_version() -> u32 {
    STATE_VERSION
}

pub(crate) fn preview_state_path() -> PathBuf {
    if let Ok(path) = std::env::var(PREVIEW_STATE_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    preview_state_root()
        .join("opencode")
        .join("web-preview")
        .join("preview-sessions.json")
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
    let Ok(contents) = std::fs::read_to_string(path) else {
        return empty_snapshot();
    };

    match parse_preview_sessions_file(&contents) {
        Ok(snapshot) => snapshot,
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

fn empty_snapshot() -> PreviewSessionsResponse {
    PreviewSessionsResponse {
        version: STATE_VERSION,
        updated_at: 0,
        sessions: Vec::new(),
    }
}

fn parse_preview_sessions_file(contents: &str) -> ApiResult<PreviewSessionsResponse> {
    let file: PreviewSessionsFile = serde_json::from_str(contents)
        .map_err(|err| AppError::bad_request(format!("invalid preview registry JSON: {err}")))?;

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

    Ok(PreviewSessionsResponse {
        version: file.version,
        updated_at: file.updated_at,
        sessions,
    })
}

fn is_valid_preview_session_id(id: &str) -> bool {
    id.strip_prefix("pv_")
        .filter(|suffix| !suffix.is_empty())
        .is_some_and(|suffix| {
            suffix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        })
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
                        "id": "bad",
                        "directory": "/repo/app",
                        "state": "ready",
                        "proxyBasePath": "/api/workspace/preview/s/bad/",
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
