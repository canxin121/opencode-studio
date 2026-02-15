use std::collections::HashSet;
use std::path::{Path, PathBuf};

use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use super::{
    DirectoryQuery, is_safe_repo_rel_path, map_git_failure, path_slash, rel_path_slash,
    require_directory, run_git,
};

#[derive(Debug, Serialize)]
pub struct GitCheckResponse {
    #[serde(rename = "isGitRepository")]
    pub is_git_repository: bool,
}

pub async fn git_check(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let ok = run_git(&dir, &["rev-parse", "--is-inside-work-tree"]).await;
    let is_repo = ok
        .map(|(code, out, _)| code == 0 && out.trim() == "true")
        .unwrap_or(false);
    Json(GitCheckResponse {
        is_git_repository: is_repo,
    })
    .into_response()
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub root: String,
    pub relative: String,
    pub kind: String,
}

async fn discover_parent_repos(base: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut current = base.parent();

    while let Some(dir) = current {
        let (code, stdout, _stderr) = run_git(dir, &["rev-parse", "--show-toplevel"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
        if code == 0 {
            let top = stdout.trim();
            if !top.is_empty() {
                let root = PathBuf::from(top);
                if root != base {
                    let normalized = path_slash(&root);
                    if seen.insert(normalized.clone()) {
                        out.push(normalized);
                    }
                }
            }
        }
        current = dir.parent();
    }

    out.sort();
    out
}

pub async fn git_repos(Query(q): Query<DirectoryQuery>) -> Response {
    let base = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    // Rough parity with VS Code behavior: scan for nested repos, but avoid heavy dirs.
    let max_depth = 8usize;
    let mut roots: HashSet<PathBuf> = HashSet::new();

    let mut it = WalkDir::new(&base)
        .follow_links(false)
        .max_depth(max_depth)
        .into_iter();

    while let Some(next) = it.next() {
        let entry = match next {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy();
        if entry.file_type().is_dir() {
            // Skip common large folders.
            if matches!(
                name.as_ref(),
                "node_modules" | "target" | ".opencode-studio" | "dist" | "build" | ".next"
            ) {
                it.skip_current_dir();
                continue;
            }

            if name == ".git" {
                if let Some(parent) = entry.path().parent() {
                    roots.insert(parent.to_path_buf());
                }
                // Never walk into .git internals.
                it.skip_current_dir();
                continue;
            }
        }

        // Worktree style: .git is a file pointing to the real dir.
        if entry.file_type().is_file()
            && name == ".git"
            && let Some(parent) = entry.path().parent()
        {
            roots.insert(parent.to_path_buf());
        }
    }

    let mut repos: Vec<GitRepoInfo> = roots
        .into_iter()
        .map(|root| {
            let git_path = root.join(".git");
            let kind = match std::fs::metadata(&git_path) {
                Ok(m) if m.is_file() => "worktree".to_string(),
                Ok(m) if m.is_dir() => "dir".to_string(),
                _ => "unknown".to_string(),
            };
            GitRepoInfo {
                root: path_slash(&root),
                relative: rel_path_slash(&base, &root),
                kind,
            }
        })
        .collect();

    repos.sort_by(|a, b| {
        // Stable-ish ordering: project root first, then shallow -> deeper.
        let al = a.relative.matches('/').count();
        let bl = b.relative.matches('/').count();
        (a.relative != ".")
            .cmp(&(b.relative != "."))
            .then(al.cmp(&bl))
            .then(a.relative.cmp(&b.relative))
    });

    let parent_repos = discover_parent_repos(&base).await;

    Json(serde_json::json!({
        "repos": repos,
        "count": repos.len(),
        "base": path_slash(&base),
        "parentRepos": parent_repos,
        "parentCount": parent_repos.len(),
    }))
    .into_response()
}

pub async fn git_safe_directory(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let safe_path = path_slash(&dir);
    let (check_code, check_out, _check_err) =
        run_git(&dir, &["config", "--global", "--get-all", "safe.directory"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));

    if check_code == 0 {
        let exists = check_out
            .lines()
            .map(|line| line.trim())
            .any(|line| line == "*" || line == safe_path);
        if exists {
            return Json(serde_json::json!({
                "success": true,
                "path": safe_path,
                "alreadyPresent": true,
            }))
            .into_response();
        }
    }

    let (code, out, err) = run_git(
        &dir,
        &["config", "--global", "--add", "safe.directory", &safe_path],
    )
    .await
    .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_safe_directory_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({
        "success": true,
        "path": safe_path,
        "alreadyPresent": false,
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInitBody {
    pub path: Option<String>,
    pub default_branch: Option<String>,
}

pub async fn git_init(Query(q): Query<DirectoryQuery>, Json(body): Json<GitInitBody>) -> Response {
    let base = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let rel = body.path.as_deref().map(|s| s.trim()).unwrap_or(".");

    let target: PathBuf = if rel.is_empty() || rel == "." {
        base.clone()
    } else {
        if !is_safe_repo_rel_path(rel) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
            )
                .into_response();
        }
        base.join(rel)
    };

    // Keep init contained within the requested project directory.
    if !target.starts_with(&base) {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({"error": "Path escapes project directory", "code": "invalid_path"}),
            ),
        )
            .into_response();
    }

    if let Err(err) = tokio::fs::create_dir_all(&target).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.to_string(), "code": "mkdir_failed"})),
        )
            .into_response();
    }

    let git_marker = target.join(".git");
    if tokio::fs::metadata(&git_marker).await.is_ok() {
        return (
            StatusCode::CONFLICT,
            Json(
                serde_json::json!({"error": "Already a git repository", "code": "already_git_repo"}),
            ),
        )
            .into_response();
    }

    let default_branch = body
        .default_branch
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    if let Some(branch) = default_branch
        && branch.chars().any(|ch| ch.is_whitespace())
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid default branch name",
                "code": "invalid_default_branch",
            })),
        )
            .into_response();
    }

    let mut args: Vec<&str> = vec!["init"];
    if let Some(branch) = default_branch {
        args.push("--initial-branch");
        args.push(branch);
    }

    let (code, out, err) =
        run_git(&target, &args)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_init_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({
        "success": true,
        "root": path_slash(&target),
        "relative": rel_path_slash(&base, &target),
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCloneBody {
    pub url: Option<String>,
    pub path: Option<String>,
    #[serde(default)]
    pub recursive: Option<bool>,
    pub r#ref: Option<String>,
    pub depth: Option<u32>,
}

fn infer_repo_dir(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let last = trimmed
        .rsplit(|c| c == '/' || c == ':')
        .next()
        .unwrap_or(trimmed);
    let mut name = last.to_string();
    if let Some(stripped) = name.strip_suffix(".git") {
        name = stripped.to_string();
    }
    if name.is_empty() {
        return None;
    }
    Some(name)
}

pub async fn git_clone(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitCloneBody>,
) -> Response {
    let base = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let Some(url) = body
        .url
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "url is required", "code": "missing_url"})),
        )
            .into_response();
    };

    let clone_ref = body
        .r#ref
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    if let Some(rf) = clone_ref
        && rf.chars().any(|ch| ch.is_whitespace())
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid ref name", "code": "invalid_ref"})),
        )
            .into_response();
    }

    let clone_depth = body.depth;
    if matches!(clone_depth, Some(0)) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "depth must be greater than 0", "code": "invalid_depth"})),
        )
            .into_response();
    }

    let mut rel = body.path.as_deref().map(|s| s.trim()).unwrap_or("");
    let inferred;
    if rel.is_empty() {
        inferred = infer_repo_dir(url).unwrap_or_default();
        rel = inferred.as_str();
    }

    if rel.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "path is required", "code": "missing_path"})),
        )
            .into_response();
    }

    if !is_safe_repo_rel_path(rel) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
        )
            .into_response();
    }

    let target = base.join(rel);
    if !target.starts_with(&base) {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({"error": "Path escapes project directory", "code": "invalid_path"}),
            ),
        )
            .into_response();
    }

    if let Ok(meta) = tokio::fs::metadata(&target).await {
        if meta.is_dir() {
            if let Ok(mut entries) = tokio::fs::read_dir(&target).await {
                if entries.next_entry().await.ok().flatten().is_some() {
                    return (
                        StatusCode::CONFLICT,
                        Json(
                            serde_json::json!({"error": "Target directory not empty", "code": "target_not_empty"}),
                        ),
                    )
                        .into_response();
                }
            }
        } else {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "Target exists", "code": "target_exists"})),
            )
                .into_response();
        }
    }

    if let Some(parent) = target.parent() {
        if let Err(err) = tokio::fs::create_dir_all(parent).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": err.to_string(), "code": "mkdir_failed"})),
            )
                .into_response();
        }
    }

    let target_str = target.to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["clone".to_string()];
    if body.recursive.unwrap_or(false) {
        args.push("--recursive".to_string());
    }
    if let Some(rf) = clone_ref {
        args.push("--branch".to_string());
        args.push(rf.to_string());
    }
    if let Some(depth) = clone_depth {
        args.push("--depth".to_string());
        args.push(depth.to_string());
    }
    args.push(url.to_string());
    args.push(target_str);

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let (code, out, err) =
        run_git(&base, &args_ref)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_clone_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({
        "success": true,
        "root": path_slash(&target),
        "relative": rel_path_slash(&base, &target),
    }))
    .into_response()
}
