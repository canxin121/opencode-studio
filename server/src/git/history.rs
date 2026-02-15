use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use crate::git2_utils;

use super::{
    DirectoryQuery, MAX_BLOB_BYTES, abs_path, git2_open_error_response, is_safe_repo_rel_path,
    lock_repo, map_git_failure, require_directory, run_git,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub refs: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub parents: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogResponse {
    pub commits: Vec<GitLogCommit>,
    pub has_more: bool,
    pub next_offset: usize,
}

#[derive(Debug, Deserialize)]
pub struct GitLogQuery {
    pub directory: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub path: Option<String>,
    pub author: Option<String>,
    pub message: Option<String>,
    pub r#ref: Option<String>,
    pub graph: Option<bool>,
}

pub async fn git_log(Query(q): Query<GitLogQuery>) -> Response {
    let Some(dir_raw) = q.directory.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "directory parameter is required"})),
        )
            .into_response();
    };
    let dir = abs_path(dir_raw);

    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let offset = q.offset.unwrap_or(0);

    let path = q
        .path
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let author = q
        .author
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let message = q
        .message
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let ref_name = q
        .r#ref
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let include_graph = q.graph.unwrap_or(false);

    if let Some(p) = path {
        if !is_safe_repo_rel_path(p) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
            )
                .into_response();
        }
    }

    let max_count = limit + 1;
    let format = "%x1f%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%b%x1f%D%x1f%P%x1e";
    let mut args: Vec<String> = vec![
        "log".into(),
        "--date=iso-strict".into(),
        format!("--max-count={}", max_count),
        format!("--skip={}", offset),
        format!("--pretty=format:{}", format),
    ];
    if include_graph {
        args.push("--graph".into());
    }
    if author.is_some() || message.is_some() {
        args.push("--fixed-strings".into());
        args.push("--regexp-ignore-case".into());
    }
    if let Some(a) = author {
        args.push(format!("--author={}", a));
    }
    if let Some(m) = message {
        args.push(format!("--grep={}", m));
    }
    if let Some(r) = ref_name {
        args.push(r.to_string());
    }
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
            Json(serde_json::json!({"error": err.trim(), "code": "git_log_failed"})),
        )
            .into_response();
    }

    let mut commits: Vec<GitLogCommit> = Vec::new();
    for record in out
        .split('\x1e')
        .map(|r| r.trim_end())
        .filter(|r| !r.is_empty())
    {
        let Some((graph_prefix, rest)) = record.split_once('\x1f') else {
            continue;
        };
        let fields: Vec<&str> = rest.split('\x1f').collect();
        if fields.len() < 9 {
            continue;
        }
        let refs = fields[7]
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        let parents = fields[8]
            .split(' ')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect::<Vec<_>>();

        commits.push(GitLogCommit {
            hash: fields[0].to_string(),
            short_hash: fields[1].to_string(),
            author_name: fields[2].to_string(),
            author_email: fields[3].to_string(),
            author_date: fields[4].to_string(),
            subject: fields[5].to_string(),
            body: fields[6].trim().to_string(),
            graph: if graph_prefix.trim().is_empty() {
                None
            } else {
                Some(graph_prefix.to_string())
            },
            refs,
            parents,
        });
    }

    let has_more = commits.len() > limit;
    if has_more {
        commits.truncate(limit);
    }
    let returned_count = commits.len();

    Json(GitLogResponse {
        commits,
        has_more,
        next_offset: offset.saturating_add(returned_count),
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitCommitDiffQuery {
    pub directory: Option<String>,
    pub commit: Option<String>,
    #[serde(rename = "contextLines")]
    pub context_lines: Option<String>,
}

pub async fn git_commit_diff(Query(q): Query<GitCommitDiffQuery>) -> Response {
    let Some(dir_raw) = q.directory.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "directory parameter is required"})),
        )
            .into_response();
    };
    let dir = abs_path(dir_raw);
    let Some(commit) = q
        .commit
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "commit parameter is required"})),
        )
            .into_response();
    };

    let context = q
        .context_lines
        .as_deref()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(3)
        .clamp(0, 500) as u32;

    let args = [
        "show",
        "--no-color",
        "--no-ext-diff",
        &format!("-U{}", context),
        "--format=",
        commit,
    ];
    let (code, out, err) =
        run_git(&dir, &args)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_commit_diff_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"diff": out})).into_response()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    pub path: String,
    pub status: String,
    pub insertions: i32,
    pub deletions: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GitCommitFilesResponse {
    pub files: Vec<GitCommitFile>,
}

#[derive(Debug, Deserialize)]
pub struct GitCommitFilesQuery {
    pub directory: Option<String>,
    pub commit: Option<String>,
}

fn normalize_numstat_path(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return "".to_string();
    }
    if let (Some(start), Some(end)) = (raw.find('{'), raw.find('}')) {
        if end > start {
            let inside = &raw[start + 1..end];
            if let Some((_, new)) = inside.split_once(" => ") {
                let prefix = &raw[..start];
                let suffix = &raw[end + 1..];
                return format!("{}{}{}", prefix, new, suffix).trim().to_string();
            }
        }
    }
    if let Some((_, new)) = raw.rsplit_once(" => ") {
        return new.trim().to_string();
    }
    raw.to_string()
}

fn parse_numstat_line(line: &str) -> Option<(String, i32, i32)> {
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() < 3 {
        return None;
    }
    let ins = if parts[0].trim() == "-" {
        0
    } else {
        parts[0].trim().parse::<i32>().unwrap_or(0)
    };
    let del = if parts[1].trim() == "-" {
        0
    } else {
        parts[1].trim().parse::<i32>().unwrap_or(0)
    };
    let path = if parts.len() >= 4 {
        parts.last().unwrap_or(&"")
    } else {
        parts[2]
    };
    let path = normalize_numstat_path(path);
    if path.is_empty() {
        return None;
    }
    Some((path, ins, del))
}

pub async fn git_commit_files(Query(q): Query<GitCommitFilesQuery>) -> Response {
    let Some(dir_raw) = q.directory.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "directory parameter is required"})),
        )
            .into_response();
    };
    let dir = abs_path(dir_raw);
    let Some(commit) = q
        .commit
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "commit parameter is required"})),
        )
            .into_response();
    };

    let name_args = [
        "diff-tree",
        "--no-commit-id",
        "--name-status",
        "-r",
        "-M",
        commit,
    ];
    let (code, out, err) =
        run_git(&dir, &name_args)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_commit_files_failed"})),
        )
            .into_response();
    }

    let numstat_args = [
        "diff-tree",
        "--no-commit-id",
        "--numstat",
        "-r",
        "-M",
        commit,
    ];
    let (n_code, n_out, _n_err) =
        run_git(&dir, &numstat_args)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));

    let mut stats_map: std::collections::HashMap<String, (i32, i32)> =
        std::collections::HashMap::new();
    if n_code == 0 {
        for line in n_out.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
            if let Some((path, ins, del)) = parse_numstat_line(line) {
                stats_map.insert(path, (ins, del));
            }
        }
    }

    let mut files: Vec<GitCommitFile> = Vec::new();
    for line in out.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
        let mut parts = line.split('\t');
        let status_raw = parts.next().unwrap_or("").trim();
        if status_raw.is_empty() {
            continue;
        }
        let status = status_raw.chars().next().unwrap_or('M').to_string();
        let mut old_path: Option<String> = None;
        let path = if status_raw.starts_with('R') || status_raw.starts_with('C') {
            let old = parts.next().unwrap_or("").trim();
            let new = parts.next().unwrap_or("").trim();
            if !old.is_empty() {
                old_path = Some(old.to_string());
            }
            new.to_string()
        } else {
            parts.next().unwrap_or("").trim().to_string()
        };
        if path.is_empty() {
            continue;
        }

        let (ins, del) = stats_map.get(&path).cloned().unwrap_or((0, 0));
        files.push(GitCommitFile {
            path,
            status,
            insertions: ins,
            deletions: del,
            old_path,
        });
    }

    Json(GitCommitFilesResponse { files }).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitCommitFileDiffQuery {
    pub directory: Option<String>,
    pub commit: Option<String>,
    pub path: Option<String>,
    #[serde(rename = "contextLines")]
    pub context_lines: Option<String>,
}

pub async fn git_commit_file_diff(Query(q): Query<GitCommitFileDiffQuery>) -> Response {
    let Some(dir_raw) = q.directory.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "directory parameter is required"})),
        )
            .into_response();
    };
    let dir = abs_path(dir_raw);
    let Some(commit) = q
        .commit
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "commit parameter is required"})),
        )
            .into_response();
    };
    let Some(path) = q
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

    if !is_safe_repo_rel_path(path) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
        )
            .into_response();
    }

    let context = q
        .context_lines
        .as_deref()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(3)
        .clamp(0, 500) as u32;

    let args = [
        "show",
        "--no-color",
        "--no-ext-diff",
        &format!("-U{}", context),
        "--format=",
        commit,
        "--",
        path,
    ];
    let (code, out, err) =
        run_git(&dir, &args)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_commit_file_diff_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"diff": out})).into_response()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileContentResponse {
    pub content: String,
    pub exists: bool,
    pub binary: bool,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
pub struct GitCommitFileContentQuery {
    pub directory: Option<String>,
    pub commit: Option<String>,
    pub path: Option<String>,
}

pub async fn git_commit_file_content(Query(q): Query<GitCommitFileContentQuery>) -> Response {
    let Some(dir_raw) = q.directory.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "directory parameter is required"})),
        )
            .into_response();
    };
    let dir = abs_path(dir_raw);
    let Some(commit) = q
        .commit
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "commit parameter is required"})),
        )
            .into_response();
    };
    let Some(path) = q
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

    if !is_safe_repo_rel_path(path) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
        )
            .into_response();
    }

    let commit = commit.to_string();
    let path = path.to_string();
    let read_result = tokio::task::spawn_blocking(move || {
        let repo = git2_utils::open_repo_discover(&dir)?;

        let commit_obj = repo
            .revparse_single(&commit)
            .and_then(|obj| obj.peel_to_commit())
            .map_err(|err| git2_utils::Git2OpenError::Other(err.message().to_string()))?;

        let tree = commit_obj
            .tree()
            .map_err(|err| git2_utils::Git2OpenError::Other(err.message().to_string()))?;

        let entry = match tree.get_path(std::path::Path::new(&path)) {
            Ok(entry) => entry,
            Err(err) if err.code() == git2::ErrorCode::NotFound => {
                return Ok(GitCommitFileContentResponse {
                    content: String::new(),
                    exists: false,
                    binary: false,
                    truncated: false,
                });
            }
            Err(err) => {
                return Err(git2_utils::Git2OpenError::Other(err.message().to_string()));
            }
        };

        if entry.kind() != Some(git2::ObjectType::Blob) {
            return Ok(GitCommitFileContentResponse {
                content: String::new(),
                exists: true,
                binary: true,
                truncated: false,
            });
        }

        let blob = repo
            .find_blob(entry.id())
            .map_err(|err| git2_utils::Git2OpenError::Other(err.message().to_string()))?;
        let bytes = blob.content();
        let truncated = bytes.len() > MAX_BLOB_BYTES;
        let payload = if truncated {
            &bytes[..MAX_BLOB_BYTES]
        } else {
            bytes
        };

        Ok(GitCommitFileContentResponse {
            content: String::from_utf8_lossy(payload).to_string(),
            exists: true,
            binary: std::str::from_utf8(payload).is_err(),
            truncated,
        })
    })
    .await;

    match read_result {
        Ok(Ok(resp)) => Json(resp).into_response(),
        Ok(Err(err)) => git2_open_error_response(err),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.to_string(), "code": "git2_task_failed"})),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct GitCommitActionBody {
    pub commit: Option<String>,
}

pub async fn git_cherry_pick(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitCommitActionBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(commit) = body
        .commit
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "commit is required", "code": "missing_commit"})),
        )
            .into_response();
    };

    let (code, out, err) = run_git(&dir, &["cherry-pick", commit]).await.unwrap_or((
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
            Json(serde_json::json!({"error": err.trim(), "code": "git_cherry_pick_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

pub async fn git_revert_commit(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitCommitActionBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(commit) = body
        .commit
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "commit is required", "code": "missing_commit"})),
        )
            .into_response();
    };

    let (code, out, err) = run_git(&dir, &["revert", "--no-edit", commit])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_revert_commit_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}
