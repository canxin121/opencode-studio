use std::path::Path;

use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use base64::Engine as _;
use serde::Deserialize;

use crate::git2_utils;

use super::super::{
    MAX_BLOB_BYTES, abs_path, git2_open_error_response, is_safe_repo_rel_path, map_git_failure,
    run_git,
};

fn is_image_file(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "ico" | "bmp" | "avif"
    )
}

fn image_mime(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

#[derive(Debug, Deserialize)]
pub struct GitFileDiffQuery {
    pub directory: Option<String>,
    pub path: Option<String>,
    // If true, compare HEAD -> index; else compare index -> workdir.
    pub staged: Option<bool>,
}

pub async fn git_file_diff(Query(q): Query<GitFileDiffQuery>) -> Response {
    let Some(dir_raw) = q.directory.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "directory parameter is required"})),
        )
            .into_response();
    };
    let dir = abs_path(dir_raw);
    let Some(file_path) = q
        .path
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "path parameter is required"})),
        )
            .into_response();
    };

    if !is_safe_repo_rel_path(file_path) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
        )
            .into_response();
    }

    // Git panel needs different bases depending on whether we're previewing staged or unstaged.
    // - staged=true:  original=HEAD,  modified=index
    // - staged=false: original=index, modified=workdir
    let staged = q.staged.unwrap_or(false);

    let mut original = String::new();
    let mut modified = String::new();

    if is_image_file(file_path) {
        let mime = image_mime(file_path);

        let repo_bytes = tokio::task::spawn_blocking({
            let dir = dir.clone();
            let file_path = file_path.to_string();
            move || -> Result<(Vec<u8>, Vec<u8>), git2_utils::Git2OpenError> {
                let repo = git2_utils::open_repo_discover(&dir)?;

                let mut head_bytes: Vec<u8> = Vec::new();
                if staged
                    && let Some(tree) = repo.head().ok().and_then(|h| h.peel_to_tree().ok())
                    && let Ok(entry) = tree.get_path(Path::new(&file_path))
                    && entry.kind() == Some(git2::ObjectType::Blob)
                    && let Ok(blob) = repo.find_blob(entry.id())
                    && blob.size() <= MAX_BLOB_BYTES
                {
                    head_bytes = blob.content().to_vec();
                }

                let mut index_bytes: Vec<u8> = Vec::new();
                if let Ok(index) = repo.index()
                    && let Some(entry) = index.get_path(Path::new(&file_path), 0)
                    && let Ok(blob) = repo.find_blob(entry.id)
                    && blob.size() <= MAX_BLOB_BYTES
                {
                    index_bytes = blob.content().to_vec();
                }

                Ok((head_bytes, index_bytes))
            }
        })
        .await;

        let (head_bytes, index_bytes) = match repo_bytes {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => return git2_open_error_response(e),
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e.to_string(), "code": "git2_task_failed"})),
                )
                    .into_response();
            }
        };

        let workdir_bytes = if staged {
            Vec::new()
        } else {
            let full = dir.join(file_path);
            tokio::fs::read(&full).await.unwrap_or_default()
        };

        let (a, b) = if staged {
            (head_bytes, index_bytes)
        } else {
            (index_bytes, workdir_bytes)
        };

        if !a.is_empty() {
            let b64 = base64::engine::general_purpose::STANDARD.encode(a);
            original = format!("data:{mime};base64,{b64}");
        }
        if !b.is_empty() && b.len() <= MAX_BLOB_BYTES {
            let b64 = base64::engine::general_purpose::STANDARD.encode(b);
            modified = format!("data:{mime};base64,{b64}");
        }
    } else {
        let repo_text = tokio::task::spawn_blocking({
            let dir = dir.clone();
            let file_path = file_path.to_string();
            move || -> Result<(String, String), git2_utils::Git2OpenError> {
                let repo = git2_utils::open_repo_discover(&dir)?;

                let mut head_text = String::new();
                if staged
                    && let Some(tree) = repo.head().ok().and_then(|h| h.peel_to_tree().ok())
                    && let Ok(entry) = tree.get_path(Path::new(&file_path))
                    && entry.kind() == Some(git2::ObjectType::Blob)
                    && let Ok(blob) = repo.find_blob(entry.id())
                    && blob.size() <= MAX_BLOB_BYTES
                {
                    head_text = String::from_utf8_lossy(blob.content()).to_string();
                }

                let mut index_text = String::new();
                if let Ok(index) = repo.index()
                    && let Some(entry) = index.get_path(Path::new(&file_path), 0)
                    && let Ok(blob) = repo.find_blob(entry.id)
                    && blob.size() <= MAX_BLOB_BYTES
                {
                    index_text = String::from_utf8_lossy(blob.content()).to_string();
                }

                Ok((head_text, index_text))
            }
        })
        .await;

        let (head_text, index_text) = match repo_text {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => return git2_open_error_response(e),
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e.to_string(), "code": "git2_task_failed"})),
                )
                    .into_response();
            }
        };

        let workdir_text = if staged {
            String::new()
        } else {
            let full = dir.join(file_path);
            if let Ok(meta) = tokio::fs::metadata(&full).await
                && meta.is_file()
                && meta.len() <= MAX_BLOB_BYTES as u64
            {
                tokio::fs::read_to_string(&full).await.unwrap_or_default()
            } else {
                String::new()
            }
        };

        if staged {
            original = head_text;
            modified = index_text;
        } else {
            original = index_text;
            modified = workdir_text;
        }
    }

    Json(serde_json::json!({"original": original, "modified": modified, "path": file_path}))
        .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCompareQuery {
    pub directory: Option<String>,
    pub base: Option<String>,
    pub head: Option<String>,
    pub path: Option<String>,
    #[serde(rename = "contextLines")]
    pub context_lines: Option<String>,
}

pub async fn git_compare(Query(q): Query<GitCompareQuery>) -> Response {
    let Some(dir_raw) = q.directory.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "directory parameter is required"})),
        )
            .into_response();
    };
    let dir = abs_path(dir_raw);
    let Some(base) = q
        .base
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "base is required", "code": "missing_base"})),
        )
            .into_response();
    };
    let Some(head) = q
        .head
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "head is required", "code": "missing_head"})),
        )
            .into_response();
    };

    let path = q
        .path
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    if let Some(p) = path {
        if !is_safe_repo_rel_path(p) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
            )
                .into_response();
        }
    }

    let context = q
        .context_lines
        .as_deref()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(3)
        .clamp(0, 500) as u32;

    let range = format!("{}...{}", base, head);
    let mut args: Vec<String> = vec![
        "diff".into(),
        "--no-color".into(),
        "--no-ext-diff".into(),
        format!("-U{}", context),
        range,
    ];
    if let Some(p) = path {
        args.push("--".into());
        args.push(p.to_string());
    }

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let (code, out, err) =
        run_git(&dir, &args_ref)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_compare_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"diff": out})).into_response()
}
