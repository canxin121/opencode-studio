use std::collections::HashSet;
use std::path::{Path, PathBuf};

use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use super::{
    DirectoryQuery, is_safe_repo_rel_path, lock_repo, map_git_failure, require_directory, run_git,
};

fn count_status_paths(status_output: &str) -> usize {
    let mut seen: HashSet<String> = HashSet::new();
    for raw in status_output.lines() {
        let line = raw.trim_end();
        if line.len() < 4 {
            continue;
        }
        // Porcelain format: XY<space><path> (or old -> new for renames).
        let mut payload = line[3..].trim().to_string();
        if let Some((_old, new_path)) = payload.split_once(" -> ") {
            payload = new_path.trim().to_string();
        }
        if payload.is_empty() {
            continue;
        }
        seen.insert(payload);
    }
    seen.len()
}

fn resolve_worktree_migrate_source_path(raw: &str, repo: &Path) -> Result<PathBuf, Box<Response>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(Box::new((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "sourcePath is required", "code": "missing_source_path"})),
        )
            .into_response()));
    }
    let p = Path::new(trimmed);
    let full =
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            if !is_safe_repo_rel_path(trimmed) {
                return Err(Box::new((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Invalid sourcePath", "code": "invalid_path"})),
            )
                .into_response()));
            }
            repo.join(trimmed)
        };
    Ok(full)
}

async fn git_common_dir(dir: &Path) -> Option<String> {
    let (code, out, _err) = run_git(dir, &["rev-parse", "--git-common-dir"])
        .await
        .ok()?;
    if code != 0 {
        return None;
    }
    let raw = out.trim();
    if raw.is_empty() {
        return None;
    }
    let p = PathBuf::from(raw);
    let full = if p.is_absolute() { p } else { dir.join(p) };
    Some(full.to_string_lossy().into_owned())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeInfo {
    pub worktree: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub locked: bool,
    pub prunable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prunable_reason: Option<String>,
}

fn clean_branch_name(branch: &str) -> String {
    if let Some(rest) = branch.strip_prefix("refs/heads/") {
        return rest.to_string();
    }
    if let Some(rest) = branch.strip_prefix("heads/") {
        return rest.to_string();
    }
    if let Some(rest) = branch.strip_prefix("refs/") {
        return rest.to_string();
    }
    branch.to_string()
}

pub async fn git_worktrees(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let (code, out, err) = run_git(&dir, &["worktree", "list", "--porcelain"])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        // Return [] for non-worktree repos.
        let mut resp = Json(Vec::<GitWorktreeInfo>::new()).into_response();
        resp.headers_mut().insert(
            "X-OpenCode-Studio-Warning",
            "git worktrees unavailable".parse().unwrap(),
        );
        tracing::warn!("git worktree list failed: {}", err.trim());
        return resp;
    }

    let mut worktrees = Vec::new();
    let mut current: Option<GitWorktreeInfo> = None;
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            if let Some(wt) = current.take() {
                worktrees.push(wt);
            }
            current = Some(GitWorktreeInfo {
                worktree: rest.trim().to_string(),
                head: None,
                branch: None,
                locked: false,
                prunable: false,
                locked_reason: None,
                prunable_reason: None,
            });
        } else if let Some(rest) = line.strip_prefix("HEAD ") {
            if let Some(ref mut wt) = current {
                wt.head = Some(rest.trim().to_string());
            }
        } else if let Some(rest) = line.strip_prefix("branch ") {
            if let Some(ref mut wt) = current {
                wt.branch = Some(clean_branch_name(rest.trim()));
            }
        } else if let Some(rest) = line.strip_prefix("locked") {
            if let Some(ref mut wt) = current {
                wt.locked = true;
                let reason = rest.trim();
                if !reason.is_empty() {
                    wt.locked_reason = Some(reason.to_string());
                }
            }
        } else if let Some(rest) = line.strip_prefix("prunable") {
            if let Some(ref mut wt) = current {
                wt.prunable = true;
                let reason = rest.trim();
                if !reason.is_empty() {
                    wt.prunable_reason = Some(reason.to_string());
                }
            }
        } else if line.trim().is_empty()
            && let Some(wt) = current.take()
        {
            worktrees.push(wt);
        }
    }
    if let Some(wt) = current.take() {
        worktrees.push(wt);
    }

    Json(worktrees).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeAddBody {
    pub path: Option<String>,
    pub branch: Option<String>,
    pub start_point: Option<String>,
    pub create_branch: Option<bool>,
}

fn resolve_worktree_path(repo: &Path, raw: &str) -> Result<PathBuf, Box<Response>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(Box::new(
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "path is required", "code": "missing_path"})),
            )
                .into_response(),
        ));
    }
    let p = Path::new(trimmed);
    let full = if p.is_absolute() {
        p.to_path_buf()
    } else {
        if !is_safe_repo_rel_path(trimmed) {
            return Err(Box::new(
                (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
                )
                    .into_response(),
            ));
        }
        repo.join(trimmed)
    };
    if !full.starts_with(repo) {
        return Err(Box::new((
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({"error": "Worktree path must be within repo", "code": "path_outside_repo"}),
            ),
        )
            .into_response()));
    }
    Ok(full)
}

pub async fn git_worktree_add(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitWorktreeAddBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(path_raw) = body.path.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "path is required", "code": "missing_path"})),
        )
            .into_response();
    };
    let target = match resolve_worktree_path(&dir, path_raw) {
        Ok(p) => p,
        Err(resp) => return *resp,
    };

    let branch = body
        .branch
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let start_point = body
        .start_point
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let create_branch = body.create_branch.unwrap_or(false);

    let target_str = target.to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["worktree".into(), "add".into()];
    if create_branch {
        let Some(name) = branch else {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "branch is required", "code": "missing_branch"})),
            )
                .into_response();
        };
        args.push("-b".into());
        args.push(name.to_string());
        args.push(target_str);
        if let Some(sp) = start_point {
            args.push(sp.to_string());
        }
    } else {
        args.push(target_str);
        if let Some(b) = branch {
            args.push(b.to_string());
        }
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
            Json(serde_json::json!({"error": err.trim(), "code": "git_worktree_add_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true, "path": target.to_string_lossy()})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitWorktreeRemoveBody {
    pub path: Option<String>,
}

pub async fn git_worktree_remove(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitWorktreeRemoveBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(path_raw) = body.path.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "path is required", "code": "missing_path"})),
        )
            .into_response();
    };
    let target = match resolve_worktree_path(&dir, path_raw) {
        Ok(p) => p,
        Err(resp) => return *resp,
    };

    let target_str = target.to_string_lossy().to_string();
    let (code, out, err) = run_git(&dir, &["worktree", "remove", &target_str])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_worktree_remove_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

pub async fn git_worktree_prune(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let (code, out, err) =
        run_git(&dir, &["worktree", "prune"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_worktree_prune_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true, "output": out.trim()})).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeMigrateBody {
    pub source_path: Option<String>,
    #[serde(default)]
    pub include_untracked: Option<bool>,
    #[serde(default)]
    pub delete_from_source: Option<bool>,
}

pub async fn git_worktree_migrate(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitWorktreeMigrateBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(source_raw) = body.source_path.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({"error": "sourcePath is required", "code": "missing_source_path"}),
            ),
        )
            .into_response();
    };
    let source = match resolve_worktree_migrate_source_path(source_raw, &dir) {
        Ok(p) => p,
        Err(resp) => return *resp,
    };
    if source == dir {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "sourcePath must be different from target worktree",
                "code": "invalid_source_path"
            })),
        )
            .into_response();
    }
    if !source.is_dir() {
        return (
            StatusCode::NOT_FOUND,
            Json(
                serde_json::json!({"error": "Source worktree not found", "code": "source_not_found"}),
            ),
        )
            .into_response();
    }

    let Some(target_common) = git_common_dir(&dir).await else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Target directory is not a git worktree",
                "code": "target_not_git_repo"
            })),
        )
            .into_response();
    };
    let Some(source_common) = git_common_dir(&source).await else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "sourcePath is not a git worktree",
                "code": "source_not_git_repo"
            })),
        )
            .into_response();
    };
    if source_common != target_common {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Source and target worktrees belong to different repositories",
                "code": "worktree_repo_mismatch"
            })),
        )
            .into_response();
    }

    let (status_code, status_out, status_err) = run_git(&source, &["status", "--porcelain"])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if status_code != 0 {
        if let Some(resp) = map_git_failure(status_code, &status_out, &status_err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": status_err.trim(), "code": "git_status_failed"})),
        )
            .into_response();
    }
    let changed_files = count_status_paths(&status_out);
    if changed_files == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "No local changes to migrate from source worktree",
                "code": "git_no_changes_to_migrate"
            })),
        )
            .into_response();
    }

    let include_untracked = body.include_untracked.unwrap_or(true);
    let delete_from_source = body.delete_from_source.unwrap_or(true);

    let source_name = source
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| source.to_string_lossy().into_owned());
    let target_name = dir
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| dir.to_string_lossy().into_owned());
    let stash_name = format!("migration:{source_name}->{target_name}");

    let mut stash_args: Vec<String> = vec![
        "stash".to_string(),
        "push".to_string(),
        "-m".to_string(),
        stash_name,
    ];
    if include_untracked {
        stash_args.push("--include-untracked".to_string());
    }
    let stash_args_ref: Vec<&str> = stash_args.iter().map(|s| s.as_str()).collect();
    let (stash_code, stash_out, stash_err) =
        run_git(&source, &stash_args_ref)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if stash_code != 0 {
        if let Some(resp) = map_git_failure(stash_code, &stash_out, &stash_err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": stash_err.trim(), "code": "git_stash_push_failed"})),
        )
            .into_response();
    }

    let (ref_code, ref_out, ref_err) =
        run_git(&source, &["stash", "list", "-n", "1", "--format=%gd"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if ref_code != 0 {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": ref_err.trim(),
                "code": "git_stash_ref_failed"
            })),
        )
            .into_response();
    }
    let stash_ref = ref_out
        .lines()
        .next()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("stash@{0}")
        .to_string();

    let apply_cmd = if delete_from_source {
        ["stash", "pop", stash_ref.as_str()]
    } else {
        ["stash", "apply", stash_ref.as_str()]
    };
    let (apply_code, apply_out, apply_err) =
        run_git(&dir, &apply_cmd)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if apply_code != 0 {
        // Best-effort restore source changes so migration failures are not destructive.
        let _ = run_git(&source, &["stash", "pop", "--index", &stash_ref]).await;
        if let Some(resp) = map_git_failure(apply_code, &apply_out, &apply_err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": apply_err.trim(),
                "code": "git_worktree_migrate_failed"
            })),
        )
            .into_response();
    }

    if !delete_from_source {
        let (restore_code, restore_out, restore_err) =
            run_git(&source, &["stash", "pop", "--index", &stash_ref])
                .await
                .unwrap_or((1, "".to_string(), "".to_string()));
        if restore_code != 0 {
            if let Some(resp) = map_git_failure(restore_code, &restore_out, &restore_err) {
                return resp;
            }
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": restore_err.trim(),
                    "code": "git_worktree_restore_failed"
                })),
            )
                .into_response();
        }
    }

    Json(serde_json::json!({
        "success": true,
        "sourcePath": source.to_string_lossy(),
        "targetPath": dir.to_string_lossy(),
        "migratedFiles": changed_files,
        "deleteFromSource": delete_from_source,
        "includeUntracked": include_untracked,
    }))
    .into_response()
}
