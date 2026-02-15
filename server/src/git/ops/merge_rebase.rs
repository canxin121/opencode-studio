use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use super::super::{DirectoryQuery, lock_repo, map_git_failure, require_directory, run_git};

#[derive(Debug, Deserialize)]
pub struct GitMergeBody {
    pub branch: Option<String>,
}

pub async fn git_merge(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitMergeBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(branch) = body
        .branch
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "branch is required", "code": "missing_branch"})),
        )
            .into_response();
    };

    let (code, out, err) = run_git(&dir, &["merge", "--no-edit", branch])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_merge_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitRebaseBody {
    pub branch: Option<String>,
}

pub async fn git_rebase(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitRebaseBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(branch) = body
        .branch
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "branch is required", "code": "missing_branch"})),
        )
            .into_response();
    };

    let (code, out, err) =
        run_git(&dir, &["rebase", branch])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_rebase_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}
