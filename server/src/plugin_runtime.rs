use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_stream::stream;
use axum::{
    Json,
    extract::{Path as AxumPath, Query, State},
    http::{
        StatusCode,
        header::{CONTENT_TYPE, HeaderValue},
    },
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::RwLock;

use crate::{ApiResult, AppError};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PluginStatus {
    Ready,
    ManifestMissing,
    ManifestInvalid,
    ResolveError,
}

#[derive(Debug, Clone)]
struct RegisteredPlugin {
    id: String,
    spec: String,
    status: PluginStatus,
    root_path: Option<PathBuf>,
    manifest_path: Option<PathBuf>,
    manifest: Option<Value>,
    display_name: Option<String>,
    version: Option<String>,
    capabilities: Vec<String>,
    error: Option<String>,
}

#[derive(Debug, Default)]
struct PluginRegistrySnapshot {
    updated_at: u64,
    plugins: Vec<RegisteredPlugin>,
    by_id: HashMap<String, usize>,
    source_specs: Vec<String>,
}

#[derive(Debug, Default)]
pub(crate) struct PluginRuntime {
    inner: RwLock<PluginRegistrySnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginListItem {
    pub id: String,
    pub spec: String,
    pub status: PluginStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub has_manifest: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginListResponse {
    pub updated_at: u64,
    pub source_specs: Vec<String>,
    pub plugins: Vec<PluginListItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginManifestResponse {
    pub id: String,
    pub spec: String,
    pub root_path: Option<String>,
    pub manifest_path: String,
    pub manifest: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginActionRequest {
    pub action: String,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub context: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginEventsQuery {
    pub cursor: Option<String>,
    pub interval_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginActionEnvelope {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<PluginActionErrorBody>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginActionErrorBody {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Value>,
}

#[derive(Debug)]
struct PluginActionFailure {
    status: StatusCode,
    code: &'static str,
    message: String,
    details: Option<Value>,
}

#[derive(Debug, Clone)]
struct BridgeInvocation {
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
    env: HashMap<String, String>,
    timeout: Duration,
}

const DEFAULT_BRIDGE_TIMEOUT_MS: u64 = 12_000;
const MAX_BRIDGE_TIMEOUT_MS: u64 = 120_000;
const BRIDGE_OUTPUT_SNIPPET_MAX_CHARS: usize = 2000;

impl PluginRuntime {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) async fn refresh_from_opencode_config_layers(
        &self,
        working_directory: Option<&Path>,
    ) -> Result<(), String> {
        let store = crate::opencode_config::OpenCodeConfigStore::from_env();
        let (user, project, custom, _paths) = store
            .read_config_layers(working_directory)
            .map_err(|err| err.to_string())?;

        let specs = merge_plugin_specs(user.plugin, project.plugin, custom.plugin);
        self.refresh_from_specs(specs).await;
        Ok(())
    }

    pub(crate) async fn refresh_from_specs(&self, specs: Vec<String>) {
        let normalized_specs = normalize_specs(specs);
        let discovered = discover_plugins(&normalized_specs);

        let mut by_id = HashMap::<String, usize>::new();
        for (idx, plugin) in discovered.iter().enumerate() {
            by_id.insert(plugin.id.clone(), idx);
        }

        let mut guard = self.inner.write().await;
        guard.updated_at = now_millis();
        guard.source_specs = normalized_specs;
        guard.plugins = discovered;
        guard.by_id = by_id;
    }

    pub(crate) async fn list_response(&self) -> PluginListResponse {
        let guard = self.inner.read().await;
        PluginListResponse {
            updated_at: guard.updated_at,
            source_specs: guard.source_specs.clone(),
            plugins: guard
                .plugins
                .iter()
                .map(|plugin| PluginListItem {
                    id: plugin.id.clone(),
                    spec: plugin.spec.clone(),
                    status: plugin.status.clone(),
                    root_path: plugin
                        .root_path
                        .as_ref()
                        .map(|path| path.to_string_lossy().into_owned()),
                    manifest_path: plugin
                        .manifest_path
                        .as_ref()
                        .map(|path| path.to_string_lossy().into_owned()),
                    display_name: plugin.display_name.clone(),
                    version: plugin.version.clone(),
                    capabilities: plugin.capabilities.clone(),
                    error: plugin.error.clone(),
                    has_manifest: plugin.manifest.is_some(),
                })
                .collect(),
        }
    }

    pub(crate) async fn manifest_response(
        &self,
        plugin_id: &str,
    ) -> Option<PluginManifestResponse> {
        let guard = self.inner.read().await;
        let idx = guard.by_id.get(plugin_id)?;
        let plugin = guard.plugins.get(*idx)?;

        let manifest = plugin.manifest.clone()?;
        let manifest_path = plugin
            .manifest_path
            .as_ref()?
            .to_string_lossy()
            .into_owned();

        Some(PluginManifestResponse {
            id: plugin.id.clone(),
            spec: plugin.spec.clone(),
            root_path: plugin
                .root_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            manifest_path,
            manifest,
        })
    }

    async fn registered_plugin(&self, plugin_id: &str) -> Option<RegisteredPlugin> {
        let guard = self.inner.read().await;
        let idx = guard.by_id.get(plugin_id)?;
        guard.plugins.get(*idx).cloned()
    }
}

pub(crate) async fn plugins_list_get(
    State(state): State<Arc<crate::AppState>>,
) -> ApiResult<Json<PluginListResponse>> {
    Ok(Json(state.plugin_runtime.list_response().await))
}

pub(crate) async fn plugin_manifest_get(
    AxumPath(plugin_id): AxumPath<String>,
    State(state): State<Arc<crate::AppState>>,
) -> ApiResult<Json<PluginManifestResponse>> {
    let Some(manifest) = state
        .plugin_runtime
        .manifest_response(plugin_id.trim())
        .await
    else {
        return Err(AppError::not_found(format!(
            "plugin manifest not found for id '{}'",
            plugin_id
        )));
    };
    Ok(Json(manifest))
}

pub(crate) async fn plugin_action_post(
    AxumPath(plugin_id): AxumPath<String>,
    State(state): State<Arc<crate::AppState>>,
    Json(body): Json<PluginActionRequest>,
) -> Response {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return action_failure_response(action_failure(
            StatusCode::BAD_REQUEST,
            "invalid_plugin_id",
            "Plugin id is required",
            None,
        ));
    }

    let action = body.action.trim();
    if action.is_empty() {
        return action_failure_response(action_failure(
            StatusCode::BAD_REQUEST,
            "invalid_action_request",
            "Action name is required",
            None,
        ));
    }

    let Some(plugin) = state.plugin_runtime.registered_plugin(plugin_id).await else {
        return action_failure_response(action_failure(
            StatusCode::NOT_FOUND,
            "plugin_not_found",
            format!("Plugin '{plugin_id}' is not registered"),
            None,
        ));
    };

    let bridge = match resolve_bridge_invocation(&plugin) {
        Ok(bridge) => bridge,
        Err(err) => return action_failure_response(err),
    };

    let bridge_payload = json!({
        "action": action,
        "payload": body.payload,
        "context": body.context,
        "plugin": {
            "id": plugin.id,
            "spec": plugin.spec,
            "rootPath": plugin.root_path.as_ref().map(|p| p.to_string_lossy().into_owned()),
            "manifestPath": plugin.manifest_path.as_ref().map(|p| p.to_string_lossy().into_owned()),
        }
    });

    let output = match invoke_bridge_action(&bridge, &bridge_payload).await {
        Ok(output) => output,
        Err(err) => return action_failure_response(err),
    };

    action_success_response(output)
}

pub(crate) async fn plugin_asset_get(
    AxumPath((plugin_id, asset_path)): AxumPath<(String, String)>,
    State(state): State<Arc<crate::AppState>>,
) -> Response {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return action_failure_response(action_failure(
            StatusCode::BAD_REQUEST,
            "invalid_plugin_id",
            "Plugin id is required",
            None,
        ));
    }

    let relative_asset_path = asset_path.trim().trim_start_matches('/');
    if relative_asset_path.is_empty() {
        return action_failure_response(action_failure(
            StatusCode::BAD_REQUEST,
            "invalid_asset_path",
            "Asset path is required",
            None,
        ));
    }

    let Some(plugin) = state.plugin_runtime.registered_plugin(plugin_id).await else {
        return action_failure_response(action_failure(
            StatusCode::NOT_FOUND,
            "plugin_not_found",
            format!("Plugin '{plugin_id}' is not registered"),
            None,
        ));
    };

    let assets_root = match resolve_plugin_assets_root(&plugin) {
        Ok(path) => path,
        Err(err) => return action_failure_response(err),
    };

    let target = assets_root.join(relative_asset_path);
    if !target.is_file() {
        return action_failure_response(action_failure(
            StatusCode::NOT_FOUND,
            "asset_not_found",
            format!("Plugin asset not found: {relative_asset_path}"),
            None,
        ));
    }

    let bytes = match tokio::fs::read(&target).await {
        Ok(bytes) => bytes,
        Err(err) => {
            return action_failure_response(action_failure(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_read_failed",
                format!("Failed to read plugin asset: {err}"),
                None,
            ));
        }
    };

    let content_type = plugin_asset_content_type(&target);
    let mut response = Response::new(axum::body::Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    response
}

pub(crate) async fn plugin_events_get(
    AxumPath(plugin_id): AxumPath<String>,
    State(state): State<Arc<crate::AppState>>,
    Query(query): Query<PluginEventsQuery>,
) -> Response {
    let plugin_id = plugin_id.trim();
    if plugin_id.is_empty() {
        return action_failure_response(action_failure(
            StatusCode::BAD_REQUEST,
            "invalid_plugin_id",
            "Plugin id is required",
            None,
        ));
    }

    let Some(plugin) = state.plugin_runtime.registered_plugin(plugin_id).await else {
        return action_failure_response(action_failure(
            StatusCode::NOT_FOUND,
            "plugin_not_found",
            format!("Plugin '{plugin_id}' is not registered"),
            None,
        ));
    };

    if !plugin_supports_events(&plugin) {
        return action_failure_response(action_failure(
            StatusCode::NOT_FOUND,
            "plugin_events_unsupported",
            format!("Plugin '{}' does not declare events capability", plugin.id),
            None,
        ));
    }

    let bridge = match resolve_bridge_invocation(&plugin) {
        Ok(bridge) => bridge,
        Err(err) => return action_failure_response(err),
    };

    let poll_interval_ms = resolve_events_poll_interval_ms(&plugin, query.interval_ms);
    let plugin_context = json!({
        "id": plugin.id,
        "spec": plugin.spec,
        "rootPath": plugin.root_path.as_ref().map(|p| p.to_string_lossy().into_owned()),
        "manifestPath": plugin.manifest_path.as_ref().map(|p| p.to_string_lossy().into_owned()),
    });
    let initial_cursor = query.cursor.unwrap_or_default();

    let sse_stream = stream! {
        let mut cursor = initial_cursor;

        loop {
            let payload = json!({
                "action": "events.poll",
                "payload": {
                    "cursor": cursor,
                },
                "context": {
                    "transport": "sse",
                    "pollIntervalMs": poll_interval_ms,
                },
                "plugin": plugin_context,
            });

            match invoke_bridge_action(&bridge, &payload).await {
                Ok(raw) => {
                    if let Some(next_cursor) = extract_cursor_from_poll_result(&raw) {
                        cursor = next_cursor;
                    }

                    let events = extract_events_from_poll_result(raw);
                    if events.is_empty() {
                        let payload = serde_json::to_string(&json!({
                            "type": "plugin.heartbeat",
                        }))
                        .unwrap_or_else(|_| "{}".to_string());
                        yield Ok::<Event, Infallible>(Event::default().event("heartbeat").data(payload));
                    } else {
                        for (event_name, event_id, event_data) in events {
                            let data = serde_json::to_string(&json!({
                                "type": event_name,
                                "data": event_data,
                            }))
                            .unwrap_or_else(|_| "{}".to_string());
                            let mut event = Event::default().event(event_name).data(data);
                            if let Some(id) = event_id {
                                event = event.id(id);
                            }
                            yield Ok::<Event, Infallible>(event);
                        }
                    }
                }
                Err(err) => {
                    let payload = json!({
                        "ok": false,
                        "error": {
                            "code": err.code,
                            "message": err.message,
                            "details": err.details,
                        }
                    });
                    let data = serde_json::to_string(&json!({
                        "type": "plugin.error",
                        "data": payload,
                    }))
                    .unwrap_or_else(|_| "{}".to_string());
                    yield Ok::<Event, Infallible>(Event::default().event("plugin.error").data(data));
                }
            }

            tokio::time::sleep(Duration::from_millis(poll_interval_ms)).await;
        }
    };

    Sse::new(sse_stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("heartbeat"),
        )
        .into_response()
}

fn plugin_supports_events(plugin: &RegisteredPlugin) -> bool {
    if plugin
        .capabilities
        .iter()
        .any(|cap| cap == "events" || cap == "events.poll")
    {
        return true;
    }

    plugin
        .manifest
        .as_ref()
        .and_then(|manifest| manifest.get("events"))
        .is_some()
}

fn resolve_plugin_assets_root(plugin: &RegisteredPlugin) -> Result<PathBuf, PluginActionFailure> {
    let Some(root) = plugin.root_path.as_ref() else {
        return Err(action_failure(
            StatusCode::BAD_REQUEST,
            "plugin_root_missing",
            format!("Plugin '{}' root path is unavailable", plugin.id),
            None,
        ));
    };

    let assets_root = resolve_assets_root_from_manifest(plugin, root);
    if !assets_root.is_dir() {
        return Err(action_failure(
            StatusCode::NOT_FOUND,
            "plugin_assets_missing",
            format!(
                "Plugin assets directory not found: {}",
                assets_root.to_string_lossy()
            ),
            None,
        ));
    }

    Ok(assets_root)
}

fn resolve_assets_root_from_manifest(plugin: &RegisteredPlugin, root: &Path) -> PathBuf {
    let Some(manifest) = plugin.manifest.as_ref() else {
        return root.join("dist");
    };

    let ui = manifest.get("ui").and_then(Value::as_object);
    if let Some(ui) = ui {
        if let Some(raw) = ui
            .get("assetsDir")
            .and_then(Value::as_str)
            .or_else(|| ui.get("assetsPath").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let path = PathBuf::from(raw);
            return if path.is_absolute() {
                canonicalize_fallback(path)
            } else {
                canonicalize_fallback(root.join(path))
            };
        }

        if let Some(entry) = ui
            .get("entry")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let entry_path = PathBuf::from(entry);
            let resolved = if entry_path.is_absolute() {
                entry_path
            } else {
                root.join(entry_path)
            };
            if let Some(parent) = resolved.parent() {
                return canonicalize_fallback(parent.to_path_buf());
            }
        }
    }

    canonicalize_fallback(root.join("dist"))
}

fn plugin_asset_content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

fn resolve_events_poll_interval_ms(plugin: &RegisteredPlugin, query_value: Option<u64>) -> u64 {
    let manifest_default = plugin
        .manifest
        .as_ref()
        .and_then(|manifest| manifest.get("events"))
        .and_then(Value::as_object)
        .and_then(|events| events.get("pollIntervalMs"))
        .and_then(Value::as_u64)
        .unwrap_or(1200);

    let raw = query_value.unwrap_or(manifest_default);
    raw.clamp(250, 5000)
}

fn extract_cursor_from_poll_result(value: &Value) -> Option<String> {
    let top = value.as_object()?;
    let data = if let Some(ok) = top.get("ok").and_then(Value::as_bool) {
        if !ok {
            return None;
        }
        top.get("data")?
    } else {
        value
    };

    data.as_object()?
        .get("cursor")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn extract_events_from_poll_result(value: Value) -> Vec<(String, Option<String>, Value)> {
    let mut out = Vec::<(String, Option<String>, Value)>::new();

    let base = if let Some(top) = value.as_object() {
        if let Some(ok) = top.get("ok").and_then(Value::as_bool) {
            if !ok {
                if let Some(err) = top.get("error") {
                    out.push(("plugin.error".to_string(), None, err.clone()));
                }
                return out;
            }
            top.get("data").cloned().unwrap_or(Value::Null)
        } else {
            value
        }
    } else {
        value
    };

    if let Some(items) = base
        .as_object()
        .and_then(|obj| obj.get("events"))
        .and_then(Value::as_array)
    {
        for item in items {
            if let Some(obj) = item.as_object() {
                let event = obj
                    .get("event")
                    .and_then(Value::as_str)
                    .or_else(|| obj.get("type").and_then(Value::as_str))
                    .unwrap_or("plugin.event")
                    .to_string();
                let id = obj
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
                let data = obj.get("data").cloned().unwrap_or_else(|| item.clone());
                out.push((event, id, data));
            } else {
                out.push(("plugin.event".to_string(), None, item.clone()));
            }
        }
        return out;
    }

    out.push(("plugin.event".to_string(), None, base));
    out
}

fn action_success_response(value: Value) -> Response {
    if value
        .as_object()
        .and_then(|obj| obj.get("ok"))
        .and_then(Value::as_bool)
        .is_some()
    {
        return (StatusCode::OK, Json(value)).into_response();
    }

    (
        StatusCode::OK,
        Json(PluginActionEnvelope {
            ok: true,
            data: Some(value),
            error: None,
        }),
    )
        .into_response()
}

fn action_failure(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
    details: Option<Value>,
) -> PluginActionFailure {
    PluginActionFailure {
        status,
        code,
        message: message.into(),
        details,
    }
}

fn action_failure_response(err: PluginActionFailure) -> Response {
    (
        err.status,
        Json(PluginActionEnvelope {
            ok: false,
            data: None,
            error: Some(PluginActionErrorBody {
                code: err.code.to_string(),
                message: err.message,
                details: err.details,
            }),
        }),
    )
        .into_response()
}

fn resolve_bridge_invocation(
    plugin: &RegisteredPlugin,
) -> Result<BridgeInvocation, PluginActionFailure> {
    let Some(manifest) = plugin.manifest.as_ref() else {
        return Err(action_failure(
            StatusCode::CONFLICT,
            "plugin_manifest_unavailable",
            format!("Plugin '{}' does not have a Studio manifest", plugin.id),
            None,
        ));
    };

    let bridge_value = manifest.get("bridge").ok_or_else(|| {
        action_failure(
            StatusCode::BAD_REQUEST,
            "plugin_bridge_missing",
            format!("Plugin '{}' manifest does not define 'bridge'", plugin.id),
            None,
        )
    })?;

    let default_cwd = plugin
        .root_path
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let mut timeout = Duration::from_millis(DEFAULT_BRIDGE_TIMEOUT_MS);
    let mut cwd = default_cwd;
    let mut env = HashMap::<String, String>::new();
    let command_tokens = match bridge_value {
        Value::String(raw) => vec![raw.trim().to_string()],
        Value::Array(values) => parse_command_token_array(values).map_err(|message| {
            action_failure(
                StatusCode::BAD_REQUEST,
                "invalid_bridge_config",
                message,
                None,
            )
        })?,
        Value::Object(map) => {
            if let Some(raw_timeout) = map.get("timeoutMs") {
                timeout = Duration::from_millis(parse_bridge_timeout_ms(raw_timeout).map_err(
                    |message| {
                        action_failure(
                            StatusCode::BAD_REQUEST,
                            "invalid_bridge_config",
                            message,
                            None,
                        )
                    },
                )?);
            }

            if let Some(raw_cwd) = map.get("cwd") {
                let Some(cwd_str) = raw_cwd.as_str() else {
                    return Err(action_failure(
                        StatusCode::BAD_REQUEST,
                        "invalid_bridge_config",
                        "bridge.cwd must be a string",
                        None,
                    ));
                };

                cwd = resolve_bridge_cwd(&cwd, cwd_str).map_err(|message| {
                    action_failure(
                        StatusCode::BAD_REQUEST,
                        "invalid_bridge_config",
                        message,
                        None,
                    )
                })?;
            }

            if let Some(raw_env) = map.get("env") {
                let Some(env_obj) = raw_env.as_object() else {
                    return Err(action_failure(
                        StatusCode::BAD_REQUEST,
                        "invalid_bridge_config",
                        "bridge.env must be an object",
                        None,
                    ));
                };

                for (key, value) in env_obj {
                    if key.trim().is_empty() {
                        continue;
                    }
                    let Some(value) = value.as_str() else {
                        return Err(action_failure(
                            StatusCode::BAD_REQUEST,
                            "invalid_bridge_config",
                            format!("bridge.env['{key}'] must be a string"),
                            None,
                        ));
                    };
                    env.insert(key.clone(), value.to_string());
                }
            }

            parse_command_tokens_from_bridge_object(map).map_err(|message| {
                action_failure(
                    StatusCode::BAD_REQUEST,
                    "invalid_bridge_config",
                    message,
                    None,
                )
            })?
        }
        _ => {
            return Err(action_failure(
                StatusCode::BAD_REQUEST,
                "invalid_bridge_config",
                "bridge must be a string, array, or object",
                None,
            ));
        }
    };

    if command_tokens.is_empty() {
        return Err(action_failure(
            StatusCode::BAD_REQUEST,
            "invalid_bridge_config",
            "bridge command is empty",
            None,
        ));
    }

    let program = resolve_bridge_program(&command_tokens[0], &cwd);
    let args = command_tokens.into_iter().skip(1).collect::<Vec<_>>();

    Ok(BridgeInvocation {
        program,
        args,
        cwd,
        env,
        timeout,
    })
}

fn resolve_bridge_program(raw: &str, cwd: &Path) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if !looks_like_path(trimmed) && !trimmed.contains('/') {
        return trimmed.to_string();
    }

    let resolved = resolve_spec_path_with_base(trimmed, cwd);
    resolved.to_string_lossy().into_owned()
}

fn parse_command_tokens_from_bridge_object(
    map: &serde_json::Map<String, Value>,
) -> Result<Vec<String>, String> {
    let Some(command_value) = map.get("command") else {
        return Err("bridge.command is required when bridge is an object".to_string());
    };

    let mut tokens = match command_value {
        Value::String(raw) => {
            let token = raw.trim();
            if token.is_empty() {
                return Err("bridge.command must not be empty".to_string());
            }
            vec![token.to_string()]
        }
        Value::Array(values) => parse_command_token_array(values)?,
        _ => return Err("bridge.command must be a string or array of strings".to_string()),
    };

    if let Some(args_value) = map.get("args") {
        let Value::Array(values) = args_value else {
            return Err("bridge.args must be an array of strings".to_string());
        };
        let args = parse_command_token_array(values)?;
        tokens.extend(args);
    }

    Ok(tokens)
}

fn parse_command_token_array(values: &[Value]) -> Result<Vec<String>, String> {
    let mut out = Vec::<String>::new();
    for (idx, value) in values.iter().enumerate() {
        let Some(raw) = value.as_str() else {
            return Err(format!(
                "bridge command token at index {idx} must be a string"
            ));
        };
        let token = raw.trim();
        if token.is_empty() {
            continue;
        }
        out.push(token.to_string());
    }
    if out.is_empty() {
        return Err("bridge command list must include at least one non-empty token".to_string());
    }
    Ok(out)
}

fn parse_bridge_timeout_ms(value: &Value) -> Result<u64, String> {
    let raw = value
        .as_u64()
        .or_else(|| {
            value
                .as_i64()
                .and_then(|v| if v > 0 { Some(v as u64) } else { None })
        })
        .ok_or_else(|| "bridge.timeoutMs must be a positive integer".to_string())?;

    Ok(raw.clamp(1, MAX_BRIDGE_TIMEOUT_MS))
}

fn resolve_bridge_cwd(base: &Path, raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(base.to_path_buf());
    }

    let resolved = resolve_spec_path_with_base(trimmed, base);
    if !resolved.is_dir() {
        return Err(format!(
            "bridge.cwd does not point to a directory: {}",
            resolved.to_string_lossy()
        ));
    }

    Ok(canonicalize_fallback(resolved))
}

fn resolve_spec_path_with_base(raw: &str, base: &Path) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/")
        && let Ok(home) = std::env::var("HOME")
    {
        return PathBuf::from(home).join(rest);
    }

    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return path;
    }

    base.join(path)
}

async fn invoke_bridge_action(
    bridge: &BridgeInvocation,
    payload: &Value,
) -> Result<Value, PluginActionFailure> {
    let stdin_payload = serde_json::to_vec(payload).map_err(|err| {
        action_failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "bridge_request_encode_failed",
            format!("Failed to encode bridge request payload: {err}"),
            None,
        )
    })?;

    let mut cmd = tokio::process::Command::new(&bridge.program);
    cmd.args(&bridge.args)
        .current_dir(&bridge.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (key, value) in &bridge.env {
        cmd.env(key, value);
    }

    let mut child = cmd.spawn().map_err(|err| {
        action_failure(
            StatusCode::BAD_GATEWAY,
            "bridge_spawn_failed",
            format!("Failed to start plugin bridge process: {err}"),
            Some(json!({
                "program": bridge.program,
                "args": bridge.args,
                "cwd": bridge.cwd.to_string_lossy(),
            })),
        )
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(&stdin_payload).await.map_err(|err| {
            action_failure(
                StatusCode::BAD_GATEWAY,
                "bridge_stdin_write_failed",
                format!("Failed to write action payload to plugin bridge stdin: {err}"),
                None,
            )
        })?;
        let _ = stdin.shutdown().await;
    }

    let Some(mut stdout) = child.stdout.take() else {
        return Err(action_failure(
            StatusCode::BAD_GATEWAY,
            "bridge_stdout_unavailable",
            "Plugin bridge stdout is unavailable",
            None,
        ));
    };
    let Some(mut stderr) = child.stderr.take() else {
        return Err(action_failure(
            StatusCode::BAD_GATEWAY,
            "bridge_stderr_unavailable",
            "Plugin bridge stderr is unavailable",
            None,
        ));
    };

    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::<u8>::new();
        stdout.read_to_end(&mut buf).await.map(|_| buf)
    });

    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::<u8>::new();
        stderr.read_to_end(&mut buf).await.map(|_| buf)
    });

    let status = tokio::select! {
        status = child.wait() => {
            status.map_err(|err| {
                action_failure(
                    StatusCode::BAD_GATEWAY,
                    "bridge_wait_failed",
                    format!("Plugin bridge process wait failed: {err}"),
                    None,
                )
            })?
        }
        _ = tokio::time::sleep(bridge.timeout) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(action_failure(
                StatusCode::GATEWAY_TIMEOUT,
                "bridge_timeout",
                format!("Plugin bridge action timed out after {}ms", bridge.timeout.as_millis()),
                Some(json!({
                    "timeoutMs": bridge.timeout.as_millis(),
                })),
            ));
        }
    };

    let stdout_bytes = stdout_task
        .await
        .map_err(|err| {
            action_failure(
                StatusCode::BAD_GATEWAY,
                "bridge_stdout_read_failed",
                format!("Failed to read plugin bridge stdout: {err}"),
                None,
            )
        })
        .and_then(|res| {
            res.map_err(|err| {
                action_failure(
                    StatusCode::BAD_GATEWAY,
                    "bridge_stdout_read_failed",
                    format!("Failed to read plugin bridge stdout: {err}"),
                    None,
                )
            })
        })?;

    let stderr_bytes = stderr_task
        .await
        .map_err(|err| {
            action_failure(
                StatusCode::BAD_GATEWAY,
                "bridge_stderr_read_failed",
                format!("Failed to read plugin bridge stderr: {err}"),
                None,
            )
        })
        .and_then(|res| {
            res.map_err(|err| {
                action_failure(
                    StatusCode::BAD_GATEWAY,
                    "bridge_stderr_read_failed",
                    format!("Failed to read plugin bridge stderr: {err}"),
                    None,
                )
            })
        })?;

    let stdout_text = String::from_utf8_lossy(&stdout_bytes).to_string();
    let stderr_text = String::from_utf8_lossy(&stderr_bytes).to_string();

    if !status.success() {
        return Err(action_failure(
            StatusCode::BAD_GATEWAY,
            "bridge_process_failed",
            "Plugin bridge exited with non-zero status",
            Some(json!({
                "exitCode": status.code(),
                "stdout": truncate_text(&stdout_text, BRIDGE_OUTPUT_SNIPPET_MAX_CHARS),
                "stderr": truncate_text(&stderr_text, BRIDGE_OUTPUT_SNIPPET_MAX_CHARS),
            })),
        ));
    }

    if stdout_text.trim().is_empty() {
        return Err(action_failure(
            StatusCode::BAD_GATEWAY,
            "bridge_empty_response",
            "Plugin bridge returned an empty response",
            Some(json!({
                "stderr": truncate_text(&stderr_text, BRIDGE_OUTPUT_SNIPPET_MAX_CHARS),
            })),
        ));
    }

    let parsed = serde_json::from_str::<Value>(stdout_text.trim()).map_err(|err| {
        action_failure(
            StatusCode::BAD_GATEWAY,
            "bridge_invalid_json",
            format!("Plugin bridge returned invalid JSON: {err}"),
            Some(json!({
                "stdout": truncate_text(&stdout_text, BRIDGE_OUTPUT_SNIPPET_MAX_CHARS),
                "stderr": truncate_text(&stderr_text, BRIDGE_OUTPUT_SNIPPET_MAX_CHARS),
            })),
        )
    })?;

    Ok(parsed)
}

fn truncate_text(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }

    let mut out = String::new();
    for (idx, ch) in input.chars().enumerate() {
        if idx >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn merge_plugin_specs(
    user: Option<Vec<String>>,
    project: Option<Vec<String>>,
    custom: Option<Vec<String>>,
) -> Vec<String> {
    let mut out = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();

    for list in [user, project, custom].into_iter().flatten() {
        for raw in list {
            let spec = raw.trim();
            if spec.is_empty() {
                continue;
            }
            if seen.insert(spec.to_string()) {
                out.push(spec.to_string());
            }
        }
    }

    out
}

fn normalize_specs(specs: Vec<String>) -> Vec<String> {
    let mut out = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();
    for raw in specs {
        // Be forgiving: allow users/UIs to accidentally paste multiple entries
        // into a single list item separated by newlines/commas/tabs.
        for part in raw.split(|ch| ch == '\n' || ch == '\r' || ch == ',' || ch == '\t') {
            let spec = part.trim();
            if spec.is_empty() {
                continue;
            }
            if seen.insert(spec.to_string()) {
                out.push(spec.to_string());
            }
        }
    }
    out
}

fn discover_plugins(specs: &[String]) -> Vec<RegisteredPlugin> {
    let mut out = Vec::<RegisteredPlugin>::new();
    let mut id_counts = HashMap::<String, usize>::new();

    for spec in specs {
        let mut plugin = discover_plugin(spec);
        plugin.id = dedupe_plugin_id(&plugin.id, &mut id_counts);
        out.push(plugin);
    }

    out
}

fn dedupe_plugin_id(id: &str, counts: &mut HashMap<String, usize>) -> String {
    let base = sanitize_plugin_id(id);
    let count = counts.entry(base.clone()).or_insert(0);
    *count += 1;
    if *count == 1 {
        base
    } else {
        format!("{}-{}", base, count)
    }
}

fn discover_plugin(spec: &str) -> RegisteredPlugin {
    let spec = spec.trim().to_string();
    let fallback_id = derive_plugin_id_from_spec(&spec);

    let root_path = match resolve_plugin_root(&spec) {
        Ok(path) => path,
        Err(err) => {
            return RegisteredPlugin {
                id: fallback_id,
                spec,
                status: PluginStatus::ResolveError,
                root_path: None,
                manifest_path: None,
                manifest: None,
                display_name: None,
                version: None,
                capabilities: Vec::new(),
                error: Some(err),
            };
        }
    };

    let package_json = read_package_json(&root_path);
    let manifest_path = resolve_manifest_path(&root_path, package_json.as_ref());
    let package_name = package_json
        .as_ref()
        .and_then(|pkg| pkg.get("name"))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let id_seed = package_name.clone().unwrap_or_else(|| fallback_id.clone());

    let Some(manifest_path) = manifest_path else {
        return RegisteredPlugin {
            id: sanitize_plugin_id(&id_seed),
            spec,
            status: PluginStatus::ManifestMissing,
            root_path: Some(root_path),
            manifest_path: None,
            manifest: None,
            display_name: None,
            version: None,
            capabilities: Vec::new(),
            error: Some("studio manifest not found".to_string()),
        };
    };

    if !manifest_path.is_file() {
        return RegisteredPlugin {
            id: sanitize_plugin_id(&id_seed),
            spec,
            status: PluginStatus::ManifestMissing,
            root_path: Some(root_path),
            manifest_path: Some(manifest_path),
            manifest: None,
            display_name: None,
            version: None,
            capabilities: Vec::new(),
            error: Some("studio manifest file does not exist".to_string()),
        };
    }

    let raw = match std::fs::read_to_string(&manifest_path) {
        Ok(raw) => raw,
        Err(err) => {
            return RegisteredPlugin {
                id: sanitize_plugin_id(&id_seed),
                spec,
                status: PluginStatus::ManifestInvalid,
                root_path: Some(root_path),
                manifest_path: Some(manifest_path),
                manifest: None,
                display_name: None,
                version: None,
                capabilities: Vec::new(),
                error: Some(format!("failed to read studio manifest: {err}")),
            };
        }
    };

    let manifest = match parse_manifest_value(&raw) {
        Ok(value) => value,
        Err(err) => {
            return RegisteredPlugin {
                id: sanitize_plugin_id(&id_seed),
                spec,
                status: PluginStatus::ManifestInvalid,
                root_path: Some(root_path),
                manifest_path: Some(manifest_path),
                manifest: None,
                display_name: None,
                version: None,
                capabilities: Vec::new(),
                error: Some(err),
            };
        }
    };

    let manifest_id = manifest
        .get("id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .filter(|value| !value.trim().is_empty());

    let plugin_id = sanitize_plugin_id(
        manifest_id
            .as_deref()
            .or(package_name.as_deref())
            .unwrap_or(&fallback_id),
    );

    let display_name = manifest
        .get("displayName")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let capabilities = manifest
        .get("capabilities")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    RegisteredPlugin {
        id: plugin_id,
        spec,
        status: PluginStatus::Ready,
        root_path: Some(root_path),
        manifest_path: Some(manifest_path),
        manifest: Some(manifest),
        display_name,
        version,
        capabilities,
        error: None,
    }
}

fn parse_manifest_value(raw: &str) -> Result<Value, String> {
    match serde_json::from_str::<Value>(raw) {
        Ok(value) => Ok(value),
        Err(json_err) => match json5::from_str::<Value>(raw) {
            Ok(value) => Ok(value),
            Err(json5_err) => Err(format!(
                "failed to parse studio manifest as JSON ({json_err}) or JSON5 ({json5_err})"
            )),
        },
    }
}

fn resolve_plugin_root(spec: &str) -> Result<PathBuf, String> {
    let spec = spec.trim();
    if spec.is_empty() {
        return Err("empty plugin spec".to_string());
    }

    if spec.starts_with("file:") {
        let path = resolve_file_spec_path(spec)?;
        return resolve_local_path_root(&path);
    }

    if spec.starts_with("link:") {
        let rest = spec
            .strip_prefix("link:")
            .unwrap_or(spec)
            .trim();
        if rest.is_empty() {
            return Err("empty link: plugin spec".to_string());
        }
        let path = resolve_spec_path(rest);
        return resolve_local_path_root(&path);
    }

    if looks_like_path(spec) {
        let path = resolve_spec_path(spec);
        return resolve_local_path_root(&path);
    }

    // Support npm-style specifiers like:
    // - name@version
    // - @scope/name@version
    // - name@file:./local/path
    // - name@./local/path
    // Resolve the name part from node_modules, and treat file/path references as local plugins.
    if let Some((name, reference)) = split_npm_name_and_reference(spec) {
        if reference.starts_with("file:") {
            let path = resolve_file_spec_path(reference)?;
            return resolve_local_path_root(&path);
        }

        if reference.starts_with("link:") {
            let rest = reference
                .strip_prefix("link:")
                .unwrap_or(reference)
                .trim();
            if rest.is_empty() {
                return Err("empty link: plugin spec".to_string());
            }
            let path = resolve_spec_path(rest);
            return resolve_local_path_root(&path);
        }

        if looks_like_path(reference) {
            let path = resolve_spec_path(reference);
            return resolve_local_path_root(&path);
        }

        return resolve_package_spec_root(name);
    }

    resolve_package_spec_root(spec)
}

fn split_npm_name_and_reference(spec: &str) -> Option<(&str, &str)> {
    let spec = spec.trim();
    if spec.is_empty() {
        return None;
    }

    // Scoped packages look like: @scope/name[@ref]
    if spec.starts_with('@') {
        let slash_idx = spec.find('/')?;
        let after_slash = &spec[slash_idx + 1..];
        let at_rel = after_slash.find('@')?;
        let at_idx = slash_idx + 1 + at_rel;
        let name = spec[..at_idx].trim();
        let reference = spec[at_idx + 1..].trim();
        if name.is_empty() || reference.is_empty() {
            return None;
        }
        return Some((name, reference));
    }

    // Unscoped: name[@ref]
    let at_idx = spec.find('@')?;
    let name = spec[..at_idx].trim();
    let reference = spec[at_idx + 1..].trim();
    if name.is_empty() || reference.is_empty() {
        return None;
    }
    Some((name, reference))
}

fn resolve_file_spec_path(spec: &str) -> Result<PathBuf, String> {
    let spec = spec.trim();
    if !spec.starts_with("file:") {
        return Err(format!("not a file: spec: {spec}"));
    }

    // file://... (URL form)
    if spec.starts_with("file://") {
        let url = url::Url::parse(spec).map_err(|err| format!("invalid file URL: {err}"))?;
        if url.scheme() != "file" {
            return Err(format!("unsupported URL scheme '{}': {spec}", url.scheme()));
        }
        return url
            .to_file_path()
            .map_err(|_| format!("failed to convert file URL to path: {spec}"));
    }

    // npm-style file: specifier (not necessarily a valid file:// URL)
    let rest = spec
        .strip_prefix("file:")
        .unwrap_or("")
        .trim();
    if rest.is_empty() {
        return Err("empty file: plugin spec".to_string());
    }
    Ok(resolve_spec_path(rest))
}

fn looks_like_path(spec: &str) -> bool {
    spec.starts_with('/')
        || spec.starts_with("./")
        || spec.starts_with("../")
        || spec.starts_with("~/")
}

fn resolve_spec_path(spec: &str) -> PathBuf {
    if let Some(rest) = spec.strip_prefix("~/")
        && let Ok(home) = std::env::var("HOME")
    {
        return PathBuf::from(home).join(rest);
    }

    let path = PathBuf::from(spec);
    if path.is_absolute() {
        return path;
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(path)
}

fn resolve_local_path_root(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.to_string_lossy()));
    }

    if let Some(root) = find_package_root(path) {
        return Ok(canonicalize_fallback(root));
    }

    if path.is_dir() {
        return Ok(canonicalize_fallback(path.to_path_buf()));
    }

    let Some(parent) = path.parent() else {
        return Err(format!(
            "cannot resolve parent directory for path: {}",
            path.display()
        ));
    };

    Ok(canonicalize_fallback(parent.to_path_buf()))
}

fn resolve_package_spec_root(spec: &str) -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let store = crate::opencode_config::OpenCodeConfigStore::from_env();
    let opencode_home = store.opencode_config_dir();

    let candidates = [
        cwd.join("node_modules").join(spec),
        opencode_home.join("node_modules").join(spec),
    ];

    for candidate in candidates {
        if candidate.exists() {
            if let Some(root) = find_package_root(&candidate) {
                return Ok(canonicalize_fallback(root));
            }
            if candidate.is_dir() {
                return Ok(canonicalize_fallback(candidate));
            }
        }
    }

    Err(format!(
        "failed to resolve npm package '{spec}' from node_modules"
    ))
}

fn find_package_root(path: &Path) -> Option<PathBuf> {
    let mut cursor = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()?.to_path_buf()
    };

    loop {
        if cursor.join("package.json").is_file() {
            return Some(cursor);
        }
        if !cursor.pop() {
            return None;
        }
    }
}

fn read_package_json(root: &Path) -> Option<Value> {
    let path = root.join("package.json");
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&raw).ok()
}

fn resolve_manifest_path(root: &Path, package_json: Option<&Value>) -> Option<PathBuf> {
    if let Some(path) = package_json
        .and_then(|pkg| pkg.get("opencodeStudio"))
        .and_then(|meta| meta.get("manifest"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        if path.is_absolute() {
            return Some(path);
        }
        return Some(root.join(path));
    }

    let dist = root.join("dist").join("studio.manifest.json");
    if dist.is_file() {
        return Some(dist);
    }

    let direct = root.join("studio.manifest.json");
    if direct.is_file() {
        return Some(direct);
    }

    None
}

fn derive_plugin_id_from_spec(spec: &str) -> String {
    let spec = spec.trim();
    if spec.is_empty() {
        return "plugin".to_string();
    }

    // Prefer the package name for npm-style specifiers like name@version.
    if let Some((name, _reference)) = split_npm_name_and_reference(spec) {
        return sanitize_plugin_id(name);
    }

    let raw = if spec.starts_with("file:") {
        resolve_file_spec_path(spec)
            .ok()
            .as_ref()
            .and_then(|path| {
                path.file_stem()
                    .or_else(|| path.file_name())
                    .and_then(|value| value.to_str())
            })
            .unwrap_or("plugin")
            .to_string()
    } else if spec.starts_with("link:") {
        let rest = spec.strip_prefix("link:").unwrap_or("").trim();
        Path::new(rest)
            .file_stem()
            .or_else(|| Path::new(rest).file_name())
            .and_then(|value| value.to_str())
            .unwrap_or("plugin")
            .to_string()
    } else if looks_like_path(spec) {
        Path::new(spec)
            .file_stem()
            .or_else(|| Path::new(spec).file_name())
            .and_then(|value| value.to_str())
            .unwrap_or("plugin")
            .to_string()
    } else {
        spec.to_string()
    };

    sanitize_plugin_id(&raw)
}

fn sanitize_plugin_id(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else {
            out.push('-');
        }
    }

    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "plugin".to_string()
    } else {
        trimmed.to_string()
    }
}

fn canonicalize_fallback(path: PathBuf) -> PathBuf {
    path.canonicalize().unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::{
        PluginStatus, RegisteredPlugin, discover_plugins, extract_cursor_from_poll_result,
        extract_events_from_poll_result, normalize_specs, resolve_bridge_invocation,
        resolve_manifest_path, sanitize_plugin_id,
    };
    use serde_json::json;
    use std::path::PathBuf;
    use std::time::Duration;
    use tempfile::tempdir;

    #[test]
    fn normalize_specs_trims_and_dedupes() {
        let specs = vec![
            "  a  ".to_string(),
            "a".to_string(),
            "".to_string(),
            "  b".to_string(),
        ];
        let normalized = normalize_specs(specs);
        assert_eq!(normalized, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn normalize_specs_splits_commas_newlines_and_tabs() {
        let specs = vec!["a, b\nc\t d".to_string(), "c".to_string()];
        let normalized = normalize_specs(specs);
        assert_eq!(
            normalized,
            vec![
                "a".to_string(),
                "b".to_string(),
                "c".to_string(),
                "d".to_string()
            ]
        );
    }

    #[test]
    fn sanitize_plugin_id_replaces_route_unsafe_chars() {
        assert_eq!(sanitize_plugin_id("@scope/pkg"), "scope-pkg");
        assert_eq!(
            sanitize_plugin_id(" opencode planpilot "),
            "opencode-planpilot"
        );
    }

    #[test]
    fn resolve_manifest_path_prefers_package_metadata() {
        let root = PathBuf::from("/tmp/plugin");
        let package_json = json!({
            "opencodeStudio": {
                "manifest": "custom/studio.manifest.json"
            }
        });

        let manifest = resolve_manifest_path(&root, Some(&package_json)).expect("manifest path");
        assert_eq!(
            manifest,
            PathBuf::from("/tmp/plugin/custom/studio.manifest.json")
        );
    }

    #[test]
    fn discover_plugins_reads_manifest_for_file_spec() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();
        let src = root.join("src");
        std::fs::create_dir_all(&src).expect("mkdir src");

        std::fs::write(
            root.join("package.json"),
            r#"{
  "name": "opencode-planpilot",
  "opencodeStudio": { "manifest": "studio.manifest.json" }
}"#,
        )
        .expect("write package");

        std::fs::write(
            root.join("studio.manifest.json"),
            r#"{
  "id": "opencode-planpilot",
  "version": "1.0.0",
  "displayName": "Planpilot",
  "capabilities": ["settings.panel", "chat.sidebar"]
}"#,
        )
        .expect("write manifest");

        let entry_file = src.join("index.ts");
        std::fs::write(&entry_file, "export default {}\n").expect("write entry");
        let spec = format!("file://{}", entry_file.to_string_lossy());

        let plugins = discover_plugins(&[spec]);
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].id, "opencode-planpilot");
        assert!(plugins[0].manifest.is_some());
        assert_eq!(plugins[0].capabilities.len(), 2);
    }

    #[test]
    fn discover_plugins_reads_manifest_for_file_colon_spec() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();
        let src = root.join("src");
        std::fs::create_dir_all(&src).expect("mkdir src");

        std::fs::write(
            root.join("package.json"),
            r#"{
  "name": "opencode-planpilot",
  "opencodeStudio": { "manifest": "studio.manifest.json" }
}"#,
        )
        .expect("write package");

        std::fs::write(
            root.join("studio.manifest.json"),
            r#"{
  "id": "opencode-planpilot",
  "version": "1.0.0",
  "displayName": "Planpilot",
  "capabilities": ["settings.panel"]
}"#,
        )
        .expect("write manifest");

        let entry_file = src.join("index.ts");
        std::fs::write(&entry_file, "export default {}\n").expect("write entry");
        let spec = format!("file:{}", entry_file.to_string_lossy());

        let plugins = discover_plugins(&[spec]);
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].id, "opencode-planpilot");
        assert!(plugins[0].manifest.is_some());
        assert_eq!(plugins[0].capabilities, vec!["settings.panel".to_string()]);
    }

    #[test]
    fn discover_plugins_reads_manifest_for_named_file_colon_spec() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();
        std::fs::write(
            root.join("package.json"),
            r#"{
  "name": "opencode-planpilot",
  "opencodeStudio": { "manifest": "studio.manifest.json" }
}"#,
        )
        .expect("write package");

        std::fs::write(
            root.join("studio.manifest.json"),
            r#"{
  "id": "opencode-planpilot",
  "version": "1.0.0",
  "displayName": "Planpilot",
  "capabilities": []
}"#,
        )
        .expect("write manifest");

        let spec = format!("opencode-planpilot@file:{}", root.to_string_lossy());
        let plugins = discover_plugins(&[spec]);
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].id, "opencode-planpilot");
        assert!(matches!(plugins[0].status, PluginStatus::Ready));
        assert!(plugins[0].root_path.is_some());
        assert!(plugins[0].manifest.is_some());
    }

    #[test]
    fn discover_plugins_reads_manifest_for_scoped_named_file_colon_spec() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();
        std::fs::write(
            root.join("package.json"),
            r#"{
  "name": "@scope/planpilot",
  "opencodeStudio": { "manifest": "studio.manifest.json" }
}"#,
        )
        .expect("write package");

        std::fs::write(
            root.join("studio.manifest.json"),
            r#"{
  "id": "@scope/planpilot",
  "version": "1.0.0",
  "displayName": "Planpilot",
  "capabilities": []
}"#,
        )
        .expect("write manifest");

        let spec = format!("@scope/planpilot@file:{}", root.to_string_lossy());
        let plugins = discover_plugins(&[spec]);
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].id, "scope-planpilot");
        assert!(matches!(plugins[0].status, PluginStatus::Ready));
        assert!(plugins[0].manifest.is_some());
    }

    #[test]
    fn resolve_bridge_invocation_reads_timeout_and_args() {
        let plugin = RegisteredPlugin {
            id: "opencode-planpilot".to_string(),
            spec: "file:///tmp/planpilot/src/index.ts".to_string(),
            status: PluginStatus::Ready,
            root_path: Some(PathBuf::from("/tmp")),
            manifest_path: Some(PathBuf::from("/tmp/studio.manifest.json")),
            manifest: Some(json!({
                "id": "opencode-planpilot",
                "bridge": {
                    "command": "node",
                    "args": ["dist/studio-bridge.js", "--stdio"],
                    "timeoutMs": 3400,
                    "cwd": "/tmp"
                }
            })),
            display_name: Some("Planpilot".to_string()),
            version: Some("1.0.0".to_string()),
            capabilities: vec!["chat.sidebar".to_string()],
            error: None,
        };

        let bridge = resolve_bridge_invocation(&plugin).expect("bridge invocation");
        assert_eq!(bridge.program, "node");
        assert_eq!(bridge.args, vec!["dist/studio-bridge.js", "--stdio"]);
        assert_eq!(bridge.cwd, PathBuf::from("/tmp"));
        assert_eq!(bridge.timeout, Duration::from_millis(3400));
    }

    #[test]
    fn resolve_bridge_invocation_errors_when_bridge_missing() {
        let plugin = RegisteredPlugin {
            id: "opencode-planpilot".to_string(),
            spec: "file:///tmp/planpilot/src/index.ts".to_string(),
            status: PluginStatus::Ready,
            root_path: Some(PathBuf::from("/tmp")),
            manifest_path: Some(PathBuf::from("/tmp/studio.manifest.json")),
            manifest: Some(json!({
                "id": "opencode-planpilot"
            })),
            display_name: Some("Planpilot".to_string()),
            version: Some("1.0.0".to_string()),
            capabilities: vec![],
            error: None,
        };

        let err = resolve_bridge_invocation(&plugin).expect_err("expected missing bridge error");
        assert_eq!(err.code, "plugin_bridge_missing");
    }

    #[test]
    fn extract_poll_cursor_from_enveloped_result() {
        let payload = json!({
            "ok": true,
            "data": {
                "cursor": "abc:123",
                "events": []
            }
        });

        let cursor = extract_cursor_from_poll_result(&payload).expect("cursor");
        assert_eq!(cursor, "abc:123");
    }

    #[test]
    fn extract_events_from_poll_result_uses_event_name_and_id() {
        let payload = json!({
            "ok": true,
            "data": {
                "events": [
                    {
                        "event": "planpilot.runtime.changed",
                        "id": "cursor-1",
                        "data": { "activePlan": { "id": 1 } }
                    }
                ]
            }
        });

        let events = extract_events_from_poll_result(payload);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "planpilot.runtime.changed");
        assert_eq!(events[0].1.as_deref(), Some("cursor-1"));
        assert_eq!(events[0].2, json!({ "activePlan": { "id": 1 } }));
    }
}
