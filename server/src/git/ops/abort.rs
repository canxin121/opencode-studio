use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use super::super::{DirectoryQuery, lock_repo, map_git_failure, require_directory, run_git};

#[derive(Debug, Deserialize)]
pub struct GitAbortBody {
    // reserved for future
    pub _dummy: Option<bool>,
}

pub async fn git_merge_abort(
    Query(q): Query<DirectoryQuery>,
    Json(_): Json<GitAbortBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let (code, out, err) =
        run_git(&dir, &["merge", "--abort"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim()})),
        )
            .into_response();
    }
    Json(serde_json::json!({"success": true})).into_response()
}

pub async fn git_rebase_abort(
    Query(q): Query<DirectoryQuery>,
    Json(_): Json<GitAbortBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let (code, out, err) =
        run_git(&dir, &["rebase", "--abort"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim()})),
        )
            .into_response();
    }
    Json(serde_json::json!({"success": true})).into_response()
}

pub async fn git_cherry_pick_abort(
    Query(q): Query<DirectoryQuery>,
    Json(_): Json<GitAbortBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let (code, out, err) = run_git(&dir, &["cherry-pick", "--abort"]).await.unwrap_or((
        1,
        "".to_string(),
        "".to_string(),
    ));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim()})),
        )
            .into_response();
    }
    Json(serde_json::json!({"success": true})).into_response()
}

pub async fn git_revert_abort(
    Query(q): Query<DirectoryQuery>,
    Json(_): Json<GitAbortBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let (code, out, err) =
        run_git(&dir, &["revert", "--abort"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim()})),
        )
            .into_response();
    }
    Json(serde_json::json!({"success": true})).into_response()
}
