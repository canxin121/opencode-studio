use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{opencode_config, opencode_config_model::OpenCodeConfig};

use super::json_io::{read_jsonc_value, write_json_value};
use super::utils::resolve_directory_path_no_fs;

const CLIENT_RELOAD_DELAY_MS: i64 = 800;

#[derive(Debug, Deserialize)]
pub struct OpencodeConfigQuery {
    pub directory: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeConfigPaths {
    pub user: String,
    pub project: Option<String>,
    pub custom: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeConfigResponse {
    pub scope: String,
    pub path: Option<String>,
    pub exists: bool,
    pub config: Value,
    pub paths: OpencodeConfigPaths,
}

fn resolve_config_scope(raw: Option<&str>) -> Result<&'static str, String> {
    match raw.unwrap_or("user").trim() {
        "user" => Ok("user"),
        "project" => Ok("project"),
        "custom" => Ok("custom"),
        other => Err(format!("invalid scope: {other}")),
    }
}

pub async fn config_opencode_get(
    State(_state): State<Arc<crate::AppState>>,
    Query(query): Query<OpencodeConfigQuery>,
) -> Response {
    let scope = match resolve_config_scope(query.scope.as_deref()) {
        Ok(v) => v,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": err})),
            )
                .into_response();
        }
    };

    let directory = query
        .directory
        .as_deref()
        .and_then(resolve_directory_path_no_fs)
        .map(PathBuf::from);

    if scope == "project" && directory.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "project scope requires directory"})),
        )
            .into_response();
    }

    let store = opencode_config::OpenCodeConfigStore::from_env();
    let paths = store.get_config_paths(directory.as_deref());
    let target_path = match scope {
        "user" => Some(paths.user_path.clone()),
        "project" => paths.project_path.clone(),
        "custom" => paths.custom_path.clone(),
        _ => None,
    };

    let Some(target_path) = target_path else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "config scope not available"})),
        )
            .into_response();
    };

    let exists = target_path.exists();
    let config = match read_jsonc_value(&target_path).await {
        Ok(v) => v,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": err})),
            )
                .into_response();
        }
    };

    let response = OpencodeConfigResponse {
        scope: scope.to_string(),
        path: Some(target_path.to_string_lossy().into_owned()),
        exists,
        config,
        paths: OpencodeConfigPaths {
            user: paths.user_path.to_string_lossy().into_owned(),
            project: paths.project_path.map(|p| p.to_string_lossy().into_owned()),
            custom: paths.custom_path.map(|p| p.to_string_lossy().into_owned()),
        },
    };

    Json(response).into_response()
}

pub async fn config_opencode_put(
    State(_state): State<Arc<crate::AppState>>,
    Query(query): Query<OpencodeConfigQuery>,
    Json(body): Json<Value>,
) -> Response {
    let scope = match resolve_config_scope(query.scope.as_deref()) {
        Ok(v) => v,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": err})),
            )
                .into_response();
        }
    };

    let directory = query
        .directory
        .as_deref()
        .and_then(resolve_directory_path_no_fs)
        .map(PathBuf::from);

    if scope == "project" && directory.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "project scope requires directory"})),
        )
            .into_response();
    }

    let store = opencode_config::OpenCodeConfigStore::from_env();
    let paths = store.get_config_paths(directory.as_deref());
    let target_path = match scope {
        "user" => Some(paths.user_path.clone()),
        "project" => paths.project_path.clone(),
        "custom" => paths.custom_path.clone(),
        _ => None,
    };

    let Some(target_path) = target_path else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "config scope not available"})),
        )
            .into_response();
    };

    if !body.is_object() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "config must be a JSON object"})),
        )
            .into_response();
    }

    let mut config = body;
    if let Value::Object(obj) = &mut config {
        obj.entry("$schema".to_string())
            .or_insert_with(|| Value::String("https://opencode.ai/config.json".to_string()));
    }

    let parsed = match serde_json::from_value::<OpenCodeConfig>(config.clone()) {
        Ok(v) => v,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("invalid opencode config: {err}")})),
            )
                .into_response();
        }
    };
    if let Err(err) = parsed.validate() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": format!("invalid opencode config: {err}")})),
        )
            .into_response();
    }

    if let Err(err) = write_json_value(&target_path, &config).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err})),
        )
            .into_response();
    }

    let response = OpencodeConfigResponse {
        scope: scope.to_string(),
        path: Some(target_path.to_string_lossy().into_owned()),
        exists: true,
        config,
        paths: OpencodeConfigPaths {
            user: paths.user_path.to_string_lossy().into_owned(),
            project: paths.project_path.map(|p| p.to_string_lossy().into_owned()),
            custom: paths.custom_path.map(|p| p.to_string_lossy().into_owned()),
        },
    };

    Json(response).into_response()
}

pub async fn config_reload_post(State(state): State<Arc<crate::AppState>>) -> Response {
    // This endpoint acts as an explicit "apply" step.
    // Kick OpenCode refresh in the background so the UI can reload quickly.
    tokio::spawn(async move {
        let _ = state.opencode.restart("manual configuration reload").await;
    });

    Json(serde_json::json!({
        "success": true,
        "requiresReload": true,
        "message": "Configuration reloaded successfully. Refreshing interface…",
        "reloadDelayMs": CLIENT_RELOAD_DELAY_MS,
    }))
    .into_response()
}
