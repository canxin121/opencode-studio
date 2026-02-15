use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use super::{DirectoryQuery, is_safe_repo_rel_path, lock_repo, require_directory};

#[derive(Debug, Deserialize)]
pub struct GitIgnoreBody {
    pub path: Option<String>,
}

fn normalize_ignore_entry(raw: &str) -> Option<String> {
    let mut entry = raw.trim().replace('\\', "/");
    if entry.is_empty() {
        return None;
    }
    if entry.starts_with("./") {
        entry = entry.trim_start_matches("./").to_string();
    }
    entry = entry.trim_start_matches('/').to_string();
    if entry.is_empty() || entry == "." {
        return None;
    }
    Some(entry)
}

pub async fn git_ignore(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitIgnoreBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(raw_path) = body
        .path
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "path is required", "code": "missing_path"})),
        )
            .into_response();
    };

    if !is_safe_repo_rel_path(raw_path) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
        )
            .into_response();
    }

    let Some(mut entry) = normalize_ignore_entry(raw_path) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
        )
            .into_response();
    };

    let full = dir.join(&entry);
    if let Ok(meta) = tokio::fs::metadata(&full).await {
        if meta.is_dir() && !entry.ends_with('/') {
            entry.push('/');
        }
    }

    let ignore_path = dir.join(".gitignore");
    let existing = tokio::fs::read_to_string(&ignore_path)
        .await
        .unwrap_or_default();
    let already = existing.lines().any(|l| l.trim() == entry);
    if !already {
        let mut next = existing;
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str(&entry);
        next.push('\n');
        if let Err(e) = tokio::fs::write(&ignore_path, next).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string(), "code": "gitignore_write_failed"})),
            )
                .into_response();
        }
    }

    Json(serde_json::json!({"success": true, "added": !already, "path": entry})).into_response()
}
