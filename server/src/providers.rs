use std::path::Path;
use std::sync::Arc;

use axum::{
    Json,
    extract::{Path as AxumPath, Query, State},
    http::HeaderMap,
};
use serde::{Deserialize, Serialize};

use crate::{ApiResult, AppError, fs, opencode_auth, opencode_config};

#[derive(Debug, Deserialize)]
pub struct EnvCheckRequest {
    pub vars: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvCheckResponse {
    pub present: Vec<String>,
    pub missing: Vec<String>,
}

fn is_safe_env_name(name: &str) -> bool {
    let s = name.trim();
    if s.is_empty() || s.len() > 80 {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

pub async fn env_check_post(
    State(_state): State<Arc<crate::AppState>>,
    Json(body): Json<EnvCheckRequest>,
) -> ApiResult<Json<EnvCheckResponse>> {
    let mut present = Vec::<String>::new();
    let mut missing = Vec::<String>::new();

    // Avoid turning this endpoint into an arbitrary environment oracle.
    // This is still local-only, but restrict size and allowed characters.
    let mut uniq = std::collections::BTreeSet::<String>::new();
    for name in body.vars.into_iter().take(200) {
        let n = name.trim().to_string();
        if !is_safe_env_name(&n) {
            continue;
        }
        uniq.insert(n);
    }

    for name in uniq {
        let ok = std::env::var_os(&name)
            .and_then(|v| v.into_string().ok())
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);
        if ok {
            present.push(name);
        } else {
            missing.push(name);
        }
    }

    Ok(Json(EnvCheckResponse { present, missing }))
}

#[derive(Debug, Deserialize)]
pub struct ProviderDirectoryQuery {
    pub directory: Option<String>,
}

pub async fn provider_source_get(
    State(_state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(q): Query<ProviderDirectoryQuery>,
    AxumPath(provider_id): AxumPath<String>,
) -> ApiResult<Json<ProviderSourceResponse>> {
    let provider_id = provider_id.trim().to_string();
    if provider_id.is_empty() {
        return Err(AppError::bad_request("Provider ID is required"));
    }

    // Directory is optional. If a directory header/query is provided and invalid, return 400.
    let requested = headers
        .get("x-opencode-directory")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| {
            q.directory
                .as_deref()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        });

    let working_directory: Option<String> = if let Some(req) = requested {
        let abs = fs::validate_directory(&req).await?;
        Some(abs.to_string_lossy().into_owned())
    } else {
        None
    };

    let working_path = working_directory.as_deref().map(Path::new);
    let sources = match opencode_config::get_provider_sources(&provider_id, working_path) {
        Ok(v) => v,
        Err(err) => return Err(AppError::internal(err.to_string())),
    };

    let auth_exists = opencode_auth::get_provider_auth(&provider_id)
        .ok()
        .flatten()
        .is_some();

    // Ensure response shape stays stable for the UI.
    let mut out_sources = sources;
    if let Some(auth) = out_sources
        .get_mut("sources")
        .and_then(|v| v.as_object_mut())
        .and_then(|m| m.get_mut("auth"))
        .and_then(|v| v.as_object_mut())
    {
        auth.insert("exists".to_string(), serde_json::Value::Bool(auth_exists));
    }

    Ok(Json(ProviderSourceResponse {
        provider_id,
        sources: out_sources
            .get("sources")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSourceResponse {
    pub provider_id: String,
    pub sources: serde_json::Value,
}
