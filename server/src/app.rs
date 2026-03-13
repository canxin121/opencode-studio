use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    Json, Router,
    body::to_bytes,
    extract::Query,
    http::{HeaderValue, Method, header},
    middleware,
    response::{Html, IntoResponse},
    routing::{any, get, post},
};
use axum_extra::extract::cookie::SameSite;
use futures_util::stream::{self as futures_stream, StreamExt as _};
use serde::Deserialize;
use serde::Serialize;
use tokio::sync::RwLock;
use tokio::time::{Duration, timeout};
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use url::Url;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) ui_auth: crate::ui_auth::UiAuth,
    pub(crate) ui_cookie_same_site: SameSite,
    pub(crate) cors_allowed_origins: Vec<String>,
    pub(crate) cors_allow_all: bool,
    pub(crate) opencode: Arc<crate::opencode::OpenCodeManager>,
    pub(crate) plugin_runtime: Arc<crate::plugin_runtime::PluginRuntime>,
    pub(crate) terminal: Arc<crate::terminal::TerminalManager>,
    pub(crate) attachment_cache: Arc<crate::attachment_cache::AttachmentCacheManager>,
    pub(crate) session_activity: crate::session_activity::SessionActivityManager,
    pub(crate) directory_session_index:
        crate::directory_session_index::DirectorySessionIndexManager,
    pub(crate) workspace_preview_registry:
        Arc<crate::workspace_preview_registry::WorkspacePreviewRegistry>,
    pub(crate) settings_path: PathBuf,
    pub(crate) settings: Arc<RwLock<crate::settings::Settings>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    timestamp: String,
    open_code_port: Option<u16>,
    open_code_running: bool,
    is_open_code_ready: bool,
    last_open_code_error: Option<String>,
}

async fn health(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> impl IntoResponse {
    let oc = state.opencode.status().await;
    let resp = HealthResponse {
        status: "ok",
        timestamp: time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "".to_string()),
        open_code_port: oc.port,
        open_code_running: oc.port.is_some() && oc.ready && !oc.restarting,
        is_open_code_ready: oc.ready,
        last_open_code_error: oc.last_error,
    };
    Json(resp)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsQuery {
    directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticPathEntry {
    path: String,
    exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsResponse {
    timestamp: String,
    opencode: serde_json::Value,
    paths: serde_json::Value,
    environment: serde_json::Value,
}

fn diag_entry(path: PathBuf) -> DiagnosticPathEntry {
    let text = path.to_string_lossy().into_owned();
    let exists = std::fs::metadata(&path).is_ok();
    DiagnosticPathEntry { path: text, exists }
}

fn parse_opencode_cli_version(raw: &str) -> Option<String> {
    for token in raw.split_whitespace().rev() {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            continue;
        }
        let starts_with_digit = trimmed
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false);
        if starts_with_digit {
            return Some(trimmed.to_string());
        }
    }
    None
}

async fn detect_opencode_cli_version() -> Option<String> {
    let output = timeout(
        Duration::from_millis(1600),
        tokio::process::Command::new("opencode")
            .arg("--version")
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    parse_opencode_cli_version(&stdout)
        .or_else(|| parse_opencode_cli_version(&stderr))
        .or({
            if stdout.is_empty() {
                None
            } else {
                Some(stdout)
            }
        })
}

async fn opencode_studio_diagnostics(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Query(query): Query<DiagnosticsQuery>,
) -> impl IntoResponse {
    let oc = state.opencode.status().await;
    let bridge = state.opencode.bridge().await;
    let opencode_cli_version = detect_opencode_cli_version().await;

    let normalized_directory = query
        .directory
        .as_deref()
        .map(crate::path_utils::normalize_directory_path)
        .and_then(|text| {
            let trimmed = text.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(PathBuf::from(trimmed))
            }
        });

    let config_store = crate::opencode_config::OpenCodeConfigStore::from_env();
    let config_paths = config_store.get_config_paths(normalized_directory.as_deref());

    let response = DiagnosticsResponse {
        timestamp: time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        opencode: serde_json::json!({
            "status": {
                "port": oc.port,
                "ready": oc.ready,
                "restarting": oc.restarting,
                "lastError": oc.last_error,
                "baseUrl": bridge.as_ref().map(|b| b.base_url.clone()),
            },
            "version": {
                "cli": opencode_cli_version,
            }
        }),
        paths: serde_json::json!({
            "input": {
                "directory": query.directory,
                "normalizedDirectory": normalized_directory.as_ref().map(|p| p.to_string_lossy().into_owned())
            },
            "studio": {
                "settingsPath": diag_entry(crate::persistence_paths::studio_settings_path()),
                "settingsCandidates": crate::persistence_paths::studio_settings_path_candidates().into_iter().map(diag_entry).collect::<Vec<_>>(),
                "sidebarPreferencesPath": diag_entry(crate::persistence_paths::sidebar_preferences_path()),
                "sidebarPreferencesCandidates": crate::persistence_paths::sidebar_preferences_path_candidates().into_iter().map(diag_entry).collect::<Vec<_>>(),
                "terminalRegistryPath": diag_entry(crate::persistence_paths::terminal_session_registry_path()),
                "terminalRegistryCandidates": crate::persistence_paths::terminal_session_registry_path_candidates().into_iter().map(diag_entry).collect::<Vec<_>>()
            },
            "opencodeStorage": {
                "dataDir": diag_entry(crate::path_utils::opencode_data_dir()),
                "dataDirCandidates": crate::persistence_paths::opencode_data_dir_candidates().into_iter().map(diag_entry).collect::<Vec<_>>(),
                "dbPath": diag_entry(crate::persistence_paths::opencode_db_path()),
                "dbCandidates": crate::persistence_paths::opencode_db_path_candidates().into_iter().map(diag_entry).collect::<Vec<_>>(),
                "sessionsDir": diag_entry(crate::persistence_paths::opencode_sessions_dir()),
                "sessionsDirCandidates": crate::persistence_paths::opencode_sessions_dir_candidates().into_iter().map(diag_entry).collect::<Vec<_>>(),
                "messagesDir": diag_entry(crate::persistence_paths::opencode_messages_dir()),
                "messagesDirCandidates": crate::persistence_paths::opencode_messages_dir_candidates().into_iter().map(diag_entry).collect::<Vec<_>>(),
                "messagePartsDir": diag_entry(crate::persistence_paths::opencode_message_parts_dir()),
                "messagePartsDirCandidates": crate::persistence_paths::opencode_message_parts_dir_candidates().into_iter().map(diag_entry).collect::<Vec<_>>()
            },
            "opencodeConfig": {
                "userPath": diag_entry(config_paths.user_path.clone()),
                "projectPath": config_paths.project_path.as_ref().cloned().map(diag_entry),
                "customPath": config_paths.custom_path.as_ref().cloned().map(diag_entry)
            }
        }),
        environment: serde_json::json!({
            "HOME": std::env::var("HOME").ok(),
            "USERPROFILE": std::env::var("USERPROFILE").ok(),
            "APPDATA": std::env::var("APPDATA").ok(),
            "LOCALAPPDATA": std::env::var("LOCALAPPDATA").ok(),
            "OPENCODE_STUDIO_DATA_DIR": std::env::var("OPENCODE_STUDIO_DATA_DIR").ok(),
            "OPENCODE_CONFIG": std::env::var("OPENCODE_CONFIG").ok(),
        }),
    };

    Json(response)
}

fn tracked_status_directories(settings: &crate::settings::Settings) -> Vec<String> {
    let mut out = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();
    for project in settings.projects.iter() {
        let raw = project.path.trim();
        if raw.is_empty() {
            continue;
        }
        let Some(normalized) = crate::path_utils::normalize_directory_for_match(raw) else {
            continue;
        };
        let key = normalized.trim();
        if key.is_empty() {
            continue;
        }
        if seen.insert(key.to_string()) {
            out.push(key.to_string());
        }
    }
    out
}

const SESSION_ACTIVITY_IDLE_RETENTION: std::time::Duration =
    std::time::Duration::from_secs(30 * 60);
const SESSION_RUNTIME_IDLE_RETENTION: std::time::Duration = std::time::Duration::from_secs(30 * 60);
const STATUS_RECONCILE_FETCH_CONCURRENCY: usize = 6;
const STATUS_HYDRATE_LOOKUP_MAX_IDS: usize = 200;
const STATUS_HYDRATE_RESPONSE_BODY_LIMIT: usize = 4 * 1024 * 1024;
const OPENCODE_BOOTSTRAP_READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const OPENCODE_BOOTSTRAP_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(3);

async fn fetch_session_status_map(
    bridge: &crate::opencode::OpenCodeBridge,
    directory: Option<&str>,
) -> Option<serde_json::Value> {
    let mut target = format!("{}/session/status", bridge.base_url.trim_end_matches('/'));
    if let Some(directory) = directory {
        let normalized = crate::path_utils::normalize_directory_for_match(directory);
        let trimmed = normalized.as_deref().unwrap_or(directory).trim();
        if !trimmed.is_empty() {
            target.push_str("?directory=");
            target.push_str(&urlencoding::encode(trimmed));
        }
    }

    let resp = bridge.client.get(target).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<serde_json::Value>().await.ok()
}

fn read_session_id_from_value(value: &serde_json::Value) -> Option<String> {
    value
        .as_object()
        .and_then(|obj| {
            obj.get("sessionID")
                .or_else(|| obj.get("sessionId"))
                .or_else(|| obj.get("session_id"))
                .and_then(|v| v.as_str())
        })
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn collect_attention_session_ids_from_value(
    value: &serde_json::Value,
    depth: usize,
    out: &mut HashSet<String>,
) {
    if depth > 8 {
        return;
    }

    if let Some(session_id) = read_session_id_from_value(value) {
        out.insert(session_id);
    }

    match value {
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_attention_session_ids_from_value(item, depth + 1, out);
            }
        }
        serde_json::Value::Object(obj) => {
            for key in [
                "items",
                "data",
                "value",
                "payload",
                "permissions",
                "questions",
                "results",
            ] {
                if let Some(nested) = obj.get(key) {
                    collect_attention_session_ids_from_value(nested, depth + 1, out);
                }
            }
        }
        _ => {}
    }
}

fn parse_attention_session_ids(payload: &serde_json::Value) -> HashSet<String> {
    let mut out = HashSet::<String>::new();
    collect_attention_session_ids_from_value(payload, 0, &mut out);
    out
}

async fn fetch_attention_session_ids(
    bridge: &crate::opencode::OpenCodeBridge,
    endpoint: &str,
    directory: Option<&str>,
) -> Option<HashSet<String>> {
    let mut target = format!("{}{}", bridge.base_url.trim_end_matches('/'), endpoint);
    if let Some(directory) = directory {
        let normalized = crate::path_utils::normalize_directory_for_match(directory);
        let trimmed = normalized.as_deref().unwrap_or(directory).trim();
        if !trimmed.is_empty() {
            let separator = if target.contains('?') { '&' } else { '?' };
            target.push(separator);
            target.push_str("directory=");
            target.push_str(&urlencoding::encode(trimmed));
        }
    }
    let resp = bridge.client.get(target).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }

    let payload = resp.json::<serde_json::Value>().await.ok()?;
    Some(parse_attention_session_ids(&payload))
}

async fn decode_json_response_payload(
    response: axum::response::Response,
) -> Option<serde_json::Value> {
    if !response.status().is_success() {
        return None;
    }
    let body = to_bytes(response.into_body(), STATUS_HYDRATE_RESPONSE_BODY_LIMIT)
        .await
        .ok()?;
    serde_json::from_slice::<serde_json::Value>(&body).ok()
}

fn extract_sessions_from_payload(payload: &serde_json::Value) -> Vec<serde_json::Value> {
    if let Some(arr) = payload.as_array() {
        return arr.to_vec();
    }
    payload
        .get("sessions")
        .and_then(|value| value.as_array())
        .map(|arr| arr.to_vec())
        .unwrap_or_default()
}

fn parse_session_id(value: &serde_json::Value) -> Option<String> {
    value
        .get("id")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

async fn hydrate_runtime_session_directory_mappings(
    state: &Arc<AppState>,
    session_ids: &HashSet<String>,
) {
    let mut missing = session_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| {
            state
                .directory_session_index
                .directory_for_session(value)
                .is_none()
        })
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return;
    }
    missing.sort();
    missing.dedup();
    if missing.len() > STATUS_HYDRATE_LOOKUP_MAX_IDS {
        missing.truncate(STATUS_HYDRATE_LOOKUP_MAX_IDS);
    }

    let directories = {
        let settings = state.settings.read().await;
        settings
            .projects
            .iter()
            .map(|project| project.path.trim().to_string())
            .filter(|path| !path.is_empty())
            .collect::<Vec<_>>()
    };
    if directories.is_empty() {
        return;
    }

    let mut unresolved = missing.into_iter().collect::<HashSet<_>>();
    for directory in directories {
        if unresolved.is_empty() {
            break;
        }

        let ids_csv = unresolved.iter().cloned().collect::<Vec<_>>().join(",");
        if ids_csv.is_empty() {
            break;
        }

        let response = match crate::opencode_session::session_list(
            axum::extract::State(state.clone()),
            axum::http::HeaderMap::new(),
            Query(crate::opencode_session::SessionListQuery {
                directory: Some(directory.clone()),
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
            }),
        )
        .await
        {
            Ok(response) => response,
            Err(_) => continue,
        };

        let Some(payload) = decode_json_response_payload(response).await else {
            continue;
        };

        for session in extract_sessions_from_payload(&payload) {
            state
                .directory_session_index
                .upsert_summary_from_value(&session);
            if let Some(session_id) = parse_session_id(&session) {
                unresolved.remove(&session_id);
            }
        }
    }
}

fn reconcile_runtime_attention_from_sets(
    index: &crate::directory_session_index::DirectorySessionIndexManager,
    permission_session_ids: &HashSet<String>,
    question_session_ids: &HashSet<String>,
) {
    let mut scope = HashSet::<String>::new();
    if let Some(runtime_map) = index.runtime_snapshot_json().as_object() {
        scope.extend(runtime_map.keys().cloned());
    }
    scope.extend(permission_session_ids.iter().cloned());
    scope.extend(question_session_ids.iter().cloned());

    reconcile_runtime_attention_from_sets_scoped(
        index,
        permission_session_ids,
        question_session_ids,
        &scope,
    );
}

fn reconcile_runtime_attention_from_sets_scoped(
    index: &crate::directory_session_index::DirectorySessionIndexManager,
    permission_session_ids: &HashSet<String>,
    question_session_ids: &HashSet<String>,
    scope_session_ids: &HashSet<String>,
) {
    for session_id in scope_session_ids {
        let sid = session_id.trim();
        if sid.is_empty() {
            continue;
        }

        if permission_session_ids.contains(sid) {
            index.upsert_runtime_attention(sid, Some("permission"));
        } else if question_session_ids.contains(sid) {
            index.upsert_runtime_attention(sid, Some("question"));
        } else {
            index.upsert_runtime_attention(sid, None);
        }
    }
}

async fn reconcile_runtime_attention_from_opencode(
    state: &Arc<AppState>,
    bridge: &crate::opencode::OpenCodeBridge,
    directories: &[String],
) -> HashSet<String> {
    if directories.is_empty() {
        let permissions = fetch_attention_session_ids(bridge, "/permission", None).await;
        let questions = fetch_attention_session_ids(bridge, "/question", None).await;
        let (Some(permission_session_ids), Some(question_session_ids)) = (permissions, questions)
        else {
            return HashSet::new();
        };

        reconcile_runtime_attention_from_sets(
            &state.directory_session_index,
            &permission_session_ids,
            &question_session_ids,
        );

        let mut all_attention = permission_session_ids;
        all_attention.extend(question_session_ids);
        return all_attention;
    }

    let mut all_attention = HashSet::<String>::new();
    let directory_list = directories.to_vec();
    let tasks = futures_stream::iter(directory_list.into_iter().map(|directory| {
        let bridge = bridge.clone();
        async move {
            let (permissions, questions) = tokio::join!(
                fetch_attention_session_ids(&bridge, "/permission", Some(&directory)),
                fetch_attention_session_ids(&bridge, "/question", Some(&directory)),
            );
            (directory, permissions, questions)
        }
    }))
    .buffer_unordered(STATUS_RECONCILE_FETCH_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;

    for (directory, permissions, questions) in tasks {
        let (Some(permission_session_ids), Some(question_session_ids)) = (permissions, questions)
        else {
            continue;
        };

        let mut scope = state
            .directory_session_index
            .session_ids_for_directory(&directory);
        scope.extend(permission_session_ids.iter().cloned());
        scope.extend(question_session_ids.iter().cloned());
        if !scope.is_empty() {
            reconcile_runtime_attention_from_sets_scoped(
                &state.directory_session_index,
                &permission_session_ids,
                &question_session_ids,
                &scope,
            );
        }

        all_attention.extend(permission_session_ids);
        all_attention.extend(question_session_ids);
    }

    all_attention
}

async fn reconcile_runtime_status_from_opencode(state: &Arc<AppState>) {
    let oc = state.opencode.status().await;
    if oc.restarting || !oc.ready {
        return;
    }

    let Some(bridge) = state.opencode.bridge().await else {
        return;
    };

    let directories = {
        let settings = state.settings.read().await;
        tracked_status_directories(&settings)
    };

    let mut status_reconciled = false;
    let mut sessions_requiring_directory_hydration = HashSet::<String>::new();

    if directories.is_empty() {
        if let Some(payload) = fetch_session_status_map(&bridge, None).await {
            let busy = state
                .directory_session_index
                .reconcile_runtime_status_map(&payload);
            state.session_activity.reconcile_busy_set(&busy);
            sessions_requiring_directory_hydration.extend(busy);
            status_reconciled = true;
        }
    } else {
        let mut busy = HashSet::<String>::new();
        let mut scope = HashSet::<String>::new();
        let mut failed_fetches = 0usize;

        let status_directories = directories.clone();
        let tasks = futures_stream::iter(status_directories.into_iter().map(|directory| {
            let bridge = bridge.clone();
            async move {
                let payload = fetch_session_status_map(&bridge, Some(&directory)).await;
                (directory, payload)
            }
        }))
        .buffer_unordered(STATUS_RECONCILE_FETCH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

        for (directory, payload) in tasks {
            let Some(payload) = payload else {
                failed_fetches += 1;
                continue;
            };
            let local_busy = state
                .directory_session_index
                .merge_runtime_status_map(&payload);
            scope.extend(
                state
                    .directory_session_index
                    .session_ids_for_directory(&directory),
            );
            scope.extend(local_busy.iter().cloned());
            busy.extend(local_busy);
        }

        if !scope.is_empty() {
            state
                .directory_session_index
                .reconcile_busy_set_scoped(&busy, &scope);
            state
                .session_activity
                .reconcile_busy_set_scoped(&busy, &scope);
            sessions_requiring_directory_hydration.extend(busy.iter().cloned());
            status_reconciled = true;
        }

        if (failed_fetches > 0 || scope.is_empty())
            && let Some(payload) = fetch_session_status_map(&bridge, None).await
        {
            let busy = state
                .directory_session_index
                .reconcile_runtime_status_map(&payload);
            state.session_activity.reconcile_busy_set(&busy);
            sessions_requiring_directory_hydration.extend(busy);
            status_reconciled = true;
        }
    }

    let attention_session_ids =
        reconcile_runtime_attention_from_opencode(state, &bridge, &directories).await;
    if !attention_session_ids.is_empty() {
        sessions_requiring_directory_hydration.extend(attention_session_ids);
    }

    if !sessions_requiring_directory_hydration.is_empty() {
        hydrate_runtime_session_directory_mappings(state, &sessions_requiring_directory_hydration)
            .await;
    }

    if !status_reconciled {
        tracing::debug!(
            target: "opencode_studio.runtime.reconcile",
            "skipped runtime status reconciliation (no usable status payload)"
        );
    }
}

fn spawn_opencode_bootstrap_task(state: Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            if let Err(err) = state.opencode.start_if_needed().await {
                tracing::warn!(
                    target: "opencode_studio.opencode",
                    error = %err,
                    "failed to start OpenCode during startup bootstrap"
                );
            }

            match state
                .opencode
                .ensure_ready(OPENCODE_BOOTSTRAP_READY_TIMEOUT)
                .await
            {
                Ok(()) => {
                    if let Err(err) = state
                        .plugin_runtime
                        .refresh_from_opencode_config_layers(None)
                        .await
                    {
                        tracing::warn!(
                            target: "opencode_studio.plugin_runtime",
                            error = %err,
                            "failed to refresh plugin runtime after OpenCode became ready"
                        );
                    }
                    break;
                }
                Err(err) => {
                    tracing::warn!(
                        target: "opencode_studio.opencode",
                        error = %err,
                        retry_after_secs = OPENCODE_BOOTSTRAP_RETRY_DELAY.as_secs(),
                        "OpenCode not ready yet; will retry"
                    );
                    tokio::time::sleep(OPENCODE_BOOTSTRAP_RETRY_DELAY).await;
                }
            }
        }
    });
}

async fn session_activity(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> impl IntoResponse {
    // Best-effort reconcile the in-memory activity snapshot with OpenCode's
    // authoritative /session/status so hard-refresh doesn't show stale "running".
    //
    // The server-side activity snapshot is derived from proxied SSE events; if no
    // client was connected when a run ended we may miss the terminal idle signal.
    reconcile_runtime_status_from_opencode(&state).await;
    state
        .session_activity
        .prune_stale_idle_entries(SESSION_ACTIVITY_IDLE_RETENTION);
    state
        .directory_session_index
        .prune_stale_runtime_entries(SESSION_RUNTIME_IDLE_RETENTION);

    Json(state.session_activity.snapshot_json())
}

// Note: update/install is intentionally not exposed via the UI.

pub(crate) async fn run(args: crate::Args) {
    fn normalize_origin_str(raw: &str) -> Option<String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
        let Ok(url) = Url::parse(trimmed) else {
            return None;
        };
        let scheme = url.scheme();
        if scheme != "http" && scheme != "https" {
            return None;
        }
        Some(url.origin().ascii_serialization())
    }

    fn build_cors_layer(origins: &[String], allow_all: bool) -> Option<CorsLayer> {
        let allow_headers = [
            header::ACCEPT,
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::IF_MATCH,
            header::IF_NONE_MATCH,
            header::HeaderName::from_static("last-event-id"),
        ];
        let allow_methods = [
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
            Method::OPTIONS,
        ];

        if allow_all {
            return Some(
                CorsLayer::new()
                    .allow_origin(Any)
                    .allow_credentials(false)
                    .allow_headers(allow_headers)
                    .allow_methods(allow_methods)
                    .max_age(std::time::Duration::from_secs(60 * 60)),
            );
        }

        if origins.is_empty() {
            return None;
        }

        let mut values: Vec<HeaderValue> = Vec::new();
        for origin in origins {
            let Ok(v) = HeaderValue::from_str(origin) else {
                tracing::warn!(
                    target: "opencode_studio.cors",
                    origin = %origin,
                    "Ignoring invalid CORS origin header value"
                );
                continue;
            };
            values.push(v);
        }

        if values.is_empty() {
            return None;
        }

        Some(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(values))
                .allow_credentials(true)
                .allow_headers(allow_headers)
                .allow_methods(allow_methods)
                .max_age(std::time::Duration::from_secs(60 * 60)),
        )
    }

    let mut normalized_cors_origins: Vec<String> = Vec::new();
    for raw in args.cors_origin.iter() {
        let Some(origin) = normalize_origin_str(raw) else {
            tracing::warn!(
                target: "opencode_studio.cors",
                origin = %raw,
                "Ignoring invalid CORS origin"
            );
            continue;
        };
        normalized_cors_origins.push(origin);
    }
    normalized_cors_origins.sort();
    normalized_cors_origins.dedup();

    if args.cors_allow_all && !normalized_cors_origins.is_empty() {
        tracing::warn!(
            target: "opencode_studio.cors",
            origins = %normalized_cors_origins.len(),
            "CORS allow-all enabled; explicit origins are ignored"
        );
    }

    let ui_cookie_same_site = match args.ui_cookie_samesite {
        crate::UiCookieSameSite::Auto => {
            if normalized_cors_origins.is_empty() && !args.cors_allow_all {
                SameSite::Strict
            } else {
                SameSite::None
            }
        }
        crate::UiCookieSameSite::Strict => SameSite::Strict,
        crate::UiCookieSameSite::Lax => SameSite::Lax,
        crate::UiCookieSameSite::None => SameSite::None,
    };

    let ui_dir_path: Option<PathBuf> = args
        .ui_dir
        .as_deref()
        .map(|s| s.trim().to_string())
        .and_then(|configured| {
            if configured.is_empty() {
                return None;
            }
            let path = PathBuf::from(configured);
            Some(if path.is_absolute() {
                path
            } else {
                // Treat explicit relative paths as relative to the current working directory.
                let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                cwd.join(path)
            })
        });

    let ui_auth = crate::ui_auth::init_ui_auth(args.ui_password.clone());
    if crate::ui_auth::spawn_cleanup_sessions_task_if_enabled(&ui_auth) {
        tracing::info!("UI password protection enabled");
    }

    let (settings_path, settings_value) = crate::settings::init_settings().await;

    let configured_opencode_port = args.opencode_port;
    let should_bootstrap_opencode = configured_opencode_port.is_some() || !args.skip_opencode_start;
    let opencode = Arc::new(crate::opencode::OpenCodeManager::new(
        args.opencode_host.clone(),
        configured_opencode_port,
        args.skip_opencode_start,
        args.opencode_log_level,
    ));

    let terminal = Arc::new(crate::terminal::TerminalManager::new());
    terminal.clone().spawn_cleanup_task();

    let attachment_cache = Arc::new(crate::attachment_cache::AttachmentCacheManager::new());

    let plugin_runtime = Arc::new(crate::plugin_runtime::PluginRuntime::new());

    let activity = crate::session_activity::SessionActivityManager::new();
    let directory_session_index =
        crate::directory_session_index::DirectorySessionIndexManager::new();
    let workspace_preview_registry =
        Arc::new(crate::workspace_preview_registry::WorkspacePreviewRegistry::new());

    let state = Arc::new(AppState {
        ui_auth,
        ui_cookie_same_site,
        cors_allowed_origins: normalized_cors_origins.clone(),
        cors_allow_all: args.cors_allow_all,
        opencode,
        plugin_runtime,
        terminal,
        attachment_cache,
        session_activity: activity,
        directory_session_index,
        workspace_preview_registry,
        settings_path,
        settings: Arc::new(RwLock::new(settings_value)),
    });

    if should_bootstrap_opencode {
        spawn_opencode_bootstrap_task(state.clone());
    } else {
        tracing::info!(
            target: "opencode_studio.opencode",
            "OpenCode bootstrap disabled (--skip-opencode-start without --opencode-port)"
        );
    }

    {
        let state = state.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                reconcile_runtime_status_from_opencode(&state).await;
                state
                    .session_activity
                    .prune_stale_idle_entries(SESSION_ACTIVITY_IDLE_RETENTION);
                state
                    .directory_session_index
                    .prune_stale_runtime_entries(SESSION_RUNTIME_IDLE_RETENTION);
            }
        });
    }

    let api_router = Router::new()
        // Providers
        .route(
            "/provider/{provider_id}/source",
            get(crate::providers::provider_source_get),
        )
        .route(
            "/provider/env/check",
            post(crate::providers::env_check_post),
        )
        // Config / Skills
        .route(
            "/config/settings",
            get(crate::config::config_settings_get).put(crate::config::config_settings_put),
        )
        .route(
            "/config/settings/events",
            get(crate::settings_events::config_settings_events),
        )
        .route(
            "/config/opencode",
            get(crate::config::config_opencode_get).put(crate::config::config_opencode_put),
        )
        .route("/plugins", get(crate::plugin_runtime::plugins_list_get))
        .route(
            "/plugins/{plugin_id}/manifest",
            get(crate::plugin_runtime::plugin_manifest_get),
        )
        .route(
            "/plugins/{plugin_id}/action",
            post(crate::plugin_runtime::plugin_action_post),
        )
        .route(
            "/plugins/{plugin_id}/events",
            get(crate::plugin_runtime::plugin_events_get),
        )
        .route(
            "/plugins/{plugin_id}/assets/{*asset_path}",
            get(crate::plugin_runtime::plugin_asset_get),
        )
        .route("/config/reload", post(crate::config::config_reload_post))
        .route(
            "/ui/terminal/state",
            get(crate::terminal_ui_state::terminal_ui_state_get)
                .put(crate::terminal_ui_state::terminal_ui_state_put),
        )
        .route(
            "/ui/terminal/state/events",
            get(crate::terminal_ui_state::terminal_ui_state_events),
        )
        // SSE bridge
        .route(
            "/event",
            get(crate::opencode_proxy::proxy_opencode_sse_event),
        )
        .route(
            "/global/event",
            get(crate::global_sse_hub::global_event_sse),
        )
        .route("/global/ws", get(crate::global_sse_hub::global_event_ws))
        .route(
            "/chat-sidebar/state",
            get(crate::chat_sidebar::chat_sidebar_state),
        )
        .route(
            "/chat-sidebar/commands",
            post(crate::chat_sidebar::chat_sidebar_commands_post),
        )
        .route(
            "/chat-sidebar/search",
            get(crate::chat_sidebar::chat_sidebar_session_search),
        )
        .route(
            "/chat-sidebar/footer",
            get(crate::chat_sidebar::chat_sidebar_footer_get),
        )
        .route(
            "/sessions/summaries",
            get(crate::chat_sidebar::sessions_summaries_get),
        )
        .route("/directories", get(crate::chat_sidebar::directories_get))
        .route(
            "/directories/{directory_id}/sessions",
            get(crate::chat_sidebar::directory_sessions_by_id_get),
        )
        .route(
            "/workspace/preview",
            get(crate::workspace_preview::workspace_preview_get),
        )
        .route(
            "/workspace/preview-url",
            get(crate::workspace_preview::workspace_preview_url_get),
        )
        .route(
            "/workspace/preview/proxy",
            get(crate::workspace_preview::workspace_preview_proxy_get),
        )
        .route(
            "/workspace/preview/sessions",
            get(crate::workspace_preview::workspace_preview_sessions_get),
        )
        .route(
            "/workspace/preview/s/{id}",
            any(crate::workspace_preview::workspace_preview_session_proxy_root),
        )
        .route(
            "/workspace/preview/s/{id}/{*path}",
            any(crate::workspace_preview::workspace_preview_session_proxy_path),
        )
        // OpenCode Studio session list + filtered message history
        .route(
            "/session",
            get(crate::opencode_session::session_list).post(crate::opencode_session::session_post),
        )
        .route(
            "/session/status",
            get(crate::opencode_proxy::session_status_get),
        )
        .route(
            "/session/{session_id}/message",
            get(crate::opencode_session::session_message_get)
                .post(crate::opencode_proxy::session_message_post),
        )
        .route(
            "/session/{session_id}/message/{message_id}/part/{part_id}",
            get(crate::opencode_session::session_message_part_get),
        )
        .route("/lsp", get(crate::opencode_proxy::lsp_list))
        .route("/permission", get(crate::opencode_proxy::permission_list))
        .route("/question", get(crate::opencode_proxy::question_list))
        // OpenCode Studio activity tracking
        .route("/session-activity", get(session_activity))
        // OpenCode Studio meta endpoints
        .route(
            "/opencode-studio/update-check",
            get(crate::updates::update_check),
        )
        .route(
            "/opencode-studio/session-locate",
            get(crate::opencode_proxy::opencode_studio_session_locate),
        )
        .route(
            "/opencode-studio/diagnostics",
            get(opencode_studio_diagnostics),
        )
        // Filesystem
        .route("/fs/home", get(crate::fs::fs_home))
        .route("/fs/mkdir", post(crate::fs::fs_mkdir))
        .route("/fs/read", get(crate::fs::fs_read))
        .route("/fs/read-chunk", get(crate::fs::fs_read_chunk))
        .route("/fs/raw", get(crate::fs::fs_raw))
        .route("/fs/download", get(crate::fs::fs_download))
        .route("/fs/write", post(crate::fs::fs_write))
        .route(
            "/fs/upload",
            post(crate::fs::fs_upload)
                .layer(RequestBodyLimitLayer::new(crate::fs::MAX_UPLOAD_BYTES)),
        )
        .route("/fs/delete", post(crate::fs::fs_delete))
        .route("/fs/rename", post(crate::fs::fs_rename))
        .route("/fs/list", get(crate::fs::fs_list))
        .route("/fs/search", get(crate::fs::fs_search))
        .route("/fs/search-content", post(crate::fs::fs_content_search))
        .route("/fs/replace-content", post(crate::fs::fs_content_replace))
        // Terminal
        .route("/terminal/create", post(crate::terminal::terminal_create))
        .route(
            "/terminal/{session_id}/stream",
            get(crate::terminal::terminal_stream),
        )
        .route(
            "/terminal/{session_id}/input",
            post(crate::terminal::terminal_input),
        )
        .route(
            "/terminal/{session_id}/resize",
            post(crate::terminal::terminal_resize),
        )
        .route(
            "/terminal/{session_id}",
            get(crate::terminal::terminal_get).delete(crate::terminal::terminal_delete),
        )
        .route(
            "/terminal/{session_id}/restart",
            post(crate::terminal::terminal_restart),
        )
        // Git
        .route("/git/check", get(crate::git::git_check))
        .route("/git/repos", get(crate::git::git_repos))
        .route("/git/safe-directory", post(crate::git::git_safe_directory))
        .route("/git/init", post(crate::git::git_init))
        .route("/git/clone", post(crate::git::git_clone))
        .route(
            "/git/gpg/enable-preset-passphrase",
            post(crate::git::git_gpg_enable_preset_passphrase),
        )
        .route(
            "/git/gpg/disable-signing",
            post(crate::git::git_gpg_disable_signing),
        )
        .route(
            "/git/gpg/set-signing-key",
            post(crate::git::git_gpg_set_signing_key),
        )
        .route("/git/remote-info", get(crate::git::git_remote_info))
        .route(
            "/git/remotes",
            post(crate::git::git_remote_add)
                .put(crate::git::git_remote_rename)
                .delete(crate::git::git_remote_remove),
        )
        .route("/git/remotes/set-url", post(crate::git::git_remote_set_url))
        .route("/git/signing-info", get(crate::git::git_signing_info))
        .route("/git/state", get(crate::git::git_state))
        .route("/git/merge/abort", post(crate::git::git_merge_abort))
        .route("/git/rebase/abort", post(crate::git::git_rebase_abort))
        .route("/git/stash", get(crate::git::git_stash_list))
        .route("/git/stash/show", get(crate::git::git_stash_show))
        .route("/git/stash/push", post(crate::git::git_stash_push))
        .route("/git/stash/apply", post(crate::git::git_stash_apply))
        .route("/git/stash/pop", post(crate::git::git_stash_pop))
        .route("/git/stash/drop", post(crate::git::git_stash_drop))
        .route("/git/stash/drop-all", post(crate::git::git_stash_drop_all))
        .route("/git/stash/branch", post(crate::git::git_stash_branch))
        .route(
            "/git/rebase/continue",
            post(crate::git::git_rebase_continue),
        )
        .route("/git/rebase/skip", post(crate::git::git_rebase_skip))
        .route(
            "/git/cherry-pick/abort",
            post(crate::git::git_cherry_pick_abort),
        )
        .route(
            "/git/cherry-pick/continue",
            post(crate::git::git_cherry_pick_continue),
        )
        .route(
            "/git/cherry-pick/skip",
            post(crate::git::git_cherry_pick_skip),
        )
        .route("/git/cherry-pick", post(crate::git::git_cherry_pick))
        .route("/git/revert/abort", post(crate::git::git_revert_abort))
        .route(
            "/git/revert/continue",
            post(crate::git::git_revert_continue),
        )
        .route("/git/revert/skip", post(crate::git::git_revert_skip))
        .route("/git/revert-commit", post(crate::git::git_revert_commit))
        .route("/git/merge", post(crate::git::git_merge))
        .route("/git/rebase", post(crate::git::git_rebase))
        .route(
            "/git/remote-branches",
            get(crate::git::git_remote_branches_list),
        )
        // Git data
        .route("/git/status", get(crate::git::git_status))
        .route("/git/watch", get(crate::git::git_watch))
        .route("/git/diff", get(crate::git::git_diff))
        .route("/git/file-diff", get(crate::git::git_file_diff))
        .route("/git/compare", get(crate::git::git_compare))
        .route("/git/patch", post(crate::git::git_apply_patch))
        .route("/git/lfs", get(crate::git::git_lfs_status))
        .route("/git/lfs/install", post(crate::git::git_lfs_install))
        .route("/git/lfs/track", post(crate::git::git_lfs_track))
        .route("/git/lfs/locks", get(crate::git::git_lfs_locks))
        .route("/git/lfs/lock", post(crate::git::git_lfs_lock))
        .route("/git/lfs/unlock", post(crate::git::git_lfs_unlock))
        .route("/git/submodules", get(crate::git::git_submodules))
        .route("/git/submodules/add", post(crate::git::git_submodule_add))
        .route("/git/submodules/init", post(crate::git::git_submodule_init))
        .route(
            "/git/submodules/update",
            post(crate::git::git_submodule_update),
        )
        .route("/git/log", get(crate::git::git_log))
        .route("/git/commit-diff", get(crate::git::git_commit_diff))
        .route("/git/commit-files", get(crate::git::git_commit_files))
        .route(
            "/git/commit-file-diff",
            get(crate::git::git_commit_file_diff),
        )
        .route(
            "/git/commit-file-content",
            get(crate::git::git_commit_file_content),
        )
        .route("/git/blame", get(crate::git::git_blame))
        .route("/git/stage", post(crate::git::git_stage))
        .route("/git/clean", post(crate::git::git_clean))
        .route("/git/ignore", post(crate::git::git_ignore))
        .route("/git/rename", post(crate::git::git_rename))
        .route("/git/delete", post(crate::git::git_delete))
        .route("/git/unstage", post(crate::git::git_unstage))
        .route("/git/revert", post(crate::git::git_revert))
        .route("/git/pull", post(crate::git::git_pull))
        .route("/git/push", post(crate::git::git_push))
        .route(
            "/git/create-github-repo-and-push",
            post(crate::git::git_create_github_repo_and_push),
        )
        .route("/git/fetch", post(crate::git::git_fetch))
        .route("/git/commit", post(crate::git::git_commit))
        .route("/git/undo-commit", post(crate::git::git_undo_commit))
        .route("/git/reset", post(crate::git::git_reset_commit))
        .route("/git/commit-template", get(crate::git::git_commit_template))
        .route("/git/conflicts", get(crate::git::git_conflicts_list))
        .route("/git/conflicts/file", get(crate::git::git_conflict_file))
        .route(
            "/git/conflicts/resolve",
            post(crate::git::git_conflict_resolve),
        )
        .route(
            "/git/branches",
            get(crate::git::git_branches)
                .post(crate::git::git_create_branch)
                .delete(crate::git::git_delete_branch),
        )
        .route("/git/branches/rename", post(crate::git::git_rename_branch))
        .route(
            "/git/branches/delete-remote",
            post(crate::git::git_delete_remote_branch),
        )
        .route("/git/tags", get(crate::git::git_tags_list))
        .route("/git/tags", post(crate::git::git_tags_create))
        .route(
            "/git/tags",
            axum::routing::delete(crate::git::git_tags_delete),
        )
        .route(
            "/git/tags/delete-remote",
            post(crate::git::git_tags_delete_remote),
        )
        .route("/git/checkout", post(crate::git::git_checkout))
        .route(
            "/git/checkout-detached",
            post(crate::git::git_checkout_detached),
        )
        .route(
            "/git/branches/create-from",
            post(crate::git::git_create_branch_from),
        )
        .route(
            "/git/worktrees",
            get(crate::git::git_worktrees)
                .post(crate::git::git_worktree_add)
                .delete(crate::git::git_worktree_remove),
        )
        .route("/git/worktrees/prune", post(crate::git::git_worktree_prune))
        .route(
            "/git/worktrees/migrate",
            post(crate::git::git_worktree_migrate),
        )
        // OpenCode REST reverse proxy fallback
        .route("/{*path}", any(crate::opencode_proxy::proxy_opencode_rest))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::ui_auth::require_ui_auth,
        ));

    let (has_ui, asset_files, static_files) = match &ui_dir_path {
        None => {
            tracing::info!("UI disabled (API-only mode)");
            (false, None, None)
        }
        Some(dir) => {
            let index_file = dir.join("index.html");
            let has_ui = index_file.is_file();
            tracing::info!(
                "UI dir resolved to {} (index.html exists: {})",
                dir.to_string_lossy(),
                has_ui
            );

            // Serve Vite hashed assets with a real 404 when missing. The SPA fallback
            // (index.html) is only appropriate for client routes, not JS/CSS chunks.
            let asset_files = ServeDir::new(dir.join("assets"));
            let static_files = ServeDir::new(dir).fallback(ServeFile::new(index_file));
            (has_ui, Some(asset_files), Some(static_files))
        }
    };

    let mut app = Router::new()
        .route("/health", get(health))
        .route(
            "/auth/session",
            get(crate::ui_auth::auth_session_status).post(crate::ui_auth::auth_session_create),
        )
        .nest("/api", api_router)
        .with_state(state)
        .layer(TraceLayer::new_for_http());

    if let Some(cors) = build_cors_layer(&normalized_cors_origins, args.cors_allow_all) {
        if args.cors_allow_all {
            tracing::info!(target: "opencode_studio.cors", "CORS enabled (allow all)");
        } else {
            tracing::info!(
                target: "opencode_studio.cors",
                origins = %normalized_cors_origins.len(),
                "CORS enabled"
            );
        }
        app = app.layer(cors);
    }

    app = if has_ui {
        app.nest_service("/assets", asset_files.expect("assets service"))
            .fallback_service(static_files.expect("static service"))
    } else {
        app.fallback(|| async {
            Html(
                "<html><body><h1>OpenCode Studio server running</h1><p>UI is not served by this instance (API-only mode). Configure a frontend separately and connect to this server via <code>/api/*</code>. To serve the built UI from this server, pass <code>--ui-dir &lt;dist&gt;</code> (or set <code>OPENCODE_STUDIO_UI_DIR</code>).</p></body></html>",
            )
        })
    };

    let addr: SocketAddr = format!("{}:{}", args.host, args.port)
        .parse()
        .expect("valid bind address");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind listener");

    tracing::info!("OpenCode Studio listening on http://{}", addr);
    axum::serve(listener, app).await.expect("server run");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_attention_session_ids_accepts_nested_aliases() {
        let payload = json!({
            "items": [
                {"id": "perm_1", "sessionID": "ses_upper"},
                {"id": "perm_2", "sessionId": "ses_camel"},
                {
                    "payload": {
                        "questions": [
                            {"id": "q_1", "session_id": "ses_snake"}
                        ]
                    }
                }
            ]
        });

        let parsed = parse_attention_session_ids(&payload);
        assert_eq!(parsed.len(), 3);
        assert!(parsed.contains("ses_upper"));
        assert!(parsed.contains("ses_camel"));
        assert!(parsed.contains("ses_snake"));
    }

    #[test]
    fn parse_opencode_cli_version_extracts_semver_token() {
        assert_eq!(
            parse_opencode_cli_version("opencode 0.4.7\n").as_deref(),
            Some("0.4.7")
        );
        assert_eq!(
            parse_opencode_cli_version("opencode version 1.2.3-beta.1").as_deref(),
            Some("1.2.3-beta.1")
        );
        assert!(parse_opencode_cli_version("opencode").is_none());
    }

    #[test]
    fn reconcile_runtime_attention_from_sets_clears_stale_attention() {
        let index = crate::directory_session_index::DirectorySessionIndexManager::new();

        index.upsert_runtime_status("ses_stale", "busy");
        index.upsert_runtime_attention("ses_stale", Some("question"));

        let permission_session_ids = HashSet::from(["ses_perm".to_string()]);
        let question_session_ids = HashSet::from(["ses_question".to_string()]);

        reconcile_runtime_attention_from_sets(
            &index,
            &permission_session_ids,
            &question_session_ids,
        );

        let snapshot = index.runtime_snapshot_json();
        let snapshot = snapshot.as_object().expect("runtime snapshot object");

        assert_eq!(
            snapshot
                .get("ses_perm")
                .and_then(|v| v.get("attention"))
                .and_then(|v| v.as_str()),
            Some("permission")
        );

        assert_eq!(
            snapshot
                .get("ses_question")
                .and_then(|v| v.get("attention"))
                .and_then(|v| v.as_str()),
            Some("question")
        );

        assert!(
            snapshot
                .get("ses_stale")
                .and_then(|v| v.get("attention"))
                .is_some_and(|v| v.is_null())
        );
    }

    #[test]
    fn reconcile_runtime_attention_from_sets_scoped_preserves_outside_scope() {
        let index = crate::directory_session_index::DirectorySessionIndexManager::new();

        index.upsert_runtime_status("ses_outside", "busy");
        index.upsert_runtime_attention("ses_outside", Some("permission"));
        index.upsert_runtime_status("ses_in_scope", "busy");
        index.upsert_runtime_attention("ses_in_scope", Some("question"));

        let permission_session_ids = HashSet::<String>::new();
        let question_session_ids = HashSet::<String>::new();
        let scope_session_ids = HashSet::from(["ses_in_scope".to_string()]);

        reconcile_runtime_attention_from_sets_scoped(
            &index,
            &permission_session_ids,
            &question_session_ids,
            &scope_session_ids,
        );

        let snapshot = index.runtime_snapshot_json();
        let snapshot = snapshot.as_object().expect("runtime snapshot object");

        assert_eq!(
            snapshot
                .get("ses_outside")
                .and_then(|v| v.get("attention"))
                .and_then(|v| v.as_str()),
            Some("permission")
        );

        assert!(
            snapshot
                .get("ses_in_scope")
                .and_then(|v| v.get("attention"))
                .is_some_and(|v| v.is_null())
        );
    }

    #[test]
    fn tracked_status_directories_normalizes_windows_paths_for_opencode_queries() {
        let settings = crate::settings::Settings {
            projects: vec![
                crate::settings::Project {
                    id: "p1".to_string(),
                    path: "C:\\Users\\Alice\\Repo\\".to_string(),
                    added_at: 0,
                    last_opened_at: 0,
                },
                crate::settings::Project {
                    id: "p2".to_string(),
                    path: "c:/users/alice/repo".to_string(),
                    added_at: 0,
                    last_opened_at: 0,
                },
            ],
            ..Default::default()
        };

        let dirs = tracked_status_directories(&settings);
        assert_eq!(dirs, vec!["c:/users/alice/repo".to_string()]);
    }
}
