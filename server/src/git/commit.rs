use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use super::{
    DirectoryQuery, GitBranchProtectionPrompt, GitCommitSummary, git_allow_no_verify_commit,
    git_branch_protection_for_branch, git_config_get, git_enforce_branch_protection, lock_repo,
    map_git_failure, redact_git_output, require_directory, run_git, truncate_for_payload,
};

#[derive(Debug, Deserialize)]
pub struct GitCommitBody {
    pub message: Option<String>,
    #[serde(rename = "addAll")]
    pub add_all: Option<bool>,
    pub files: Option<Vec<String>>,
    #[serde(rename = "gpgPassphrase")]
    pub gpg_passphrase: Option<String>,

    // VS Code-like options.
    #[serde(default, rename = "noVerify")]
    pub no_verify: Option<bool>,
    #[serde(default)]
    pub signoff: Option<bool>,
    #[serde(default)]
    pub amend: Option<bool>,
    #[serde(default, rename = "allowEmpty")]
    pub allow_empty: Option<bool>,
    #[serde(default, rename = "noGpgSign")]
    pub no_gpg_sign: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub success: bool,
    pub commit: String,
    pub branch: String,
    pub summary: GitCommitSummary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUndoCommitBody {
    // "soft" (default) | "mixed"
    pub mode: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GitResetCommitBody {
    pub commit: Option<String>,
    pub mode: Option<String>,
}

async fn git_path_exists(dir: &Path, name: &str) -> bool {
    let (code, out, _) = run_git(dir, &["rev-parse", "--git-path", name])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        return false;
    }
    let raw = out.trim();
    if raw.is_empty() {
        return false;
    }
    let p = PathBuf::from(raw);
    let full = if p.is_absolute() { p } else { dir.join(p) };
    tokio::fs::metadata(full).await.is_ok()
}

pub async fn git_undo_commit(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitUndoCommitBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    // Disallow undo while sequencer operations are in progress.
    let busy = git_path_exists(&dir, "MERGE_HEAD").await
        || git_path_exists(&dir, "rebase-apply").await
        || git_path_exists(&dir, "rebase-merge").await
        || git_path_exists(&dir, "CHERRY_PICK_HEAD").await
        || git_path_exists(&dir, "REVERT_HEAD").await;
    if busy {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "Cannot undo commit while a merge/rebase/cherry-pick/revert is in progress",
                "code": "git_undo_not_allowed",
            })),
        )
            .into_response();
    }

    // Ensure there's a parent commit.
    let (c0, o0, e0) = run_git(&dir, &["rev-parse", "--verify", "HEAD~1"])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if c0 != 0 {
        if let Some(resp) = map_git_failure(c0, &o0, &e0) {
            return resp;
        }
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "No parent commit to undo",
                "code": "git_undo_not_possible",
            })),
        )
            .into_response();
    }

    let mode = body
        .mode
        .as_deref()
        .unwrap_or("soft")
        .trim()
        .to_ascii_lowercase();
    let flag = if mode == "mixed" {
        "--mixed"
    } else if mode == "soft" {
        "--soft"
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid mode", "code": "invalid_mode"})),
        )
            .into_response();
    };

    let (c, o, e) = run_git(&dir, &["reset", flag, "HEAD~1"]).await.unwrap_or((
        1,
        "".to_string(),
        "".to_string(),
    ));
    if c != 0 {
        if let Some(resp) = map_git_failure(c, &o, &e) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.trim(), "code": "git_reset_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true, "mode": mode})).into_response()
}

pub async fn git_reset_commit(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitResetCommitBody>,
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
            Json(serde_json::json!({
                "error": "commit is required",
                "code": "missing_commit"
            })),
        )
            .into_response();
    };

    let busy = git_path_exists(&dir, "MERGE_HEAD").await
        || git_path_exists(&dir, "rebase-apply").await
        || git_path_exists(&dir, "rebase-merge").await
        || git_path_exists(&dir, "CHERRY_PICK_HEAD").await
        || git_path_exists(&dir, "REVERT_HEAD").await;
    if busy {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "Cannot reset while a merge/rebase/cherry-pick/revert is in progress",
                "code": "git_reset_not_allowed",
            })),
        )
            .into_response();
    }

    let mode = body
        .mode
        .as_deref()
        .unwrap_or("mixed")
        .trim()
        .to_ascii_lowercase();
    let flag = if mode == "hard" {
        "--hard"
    } else if mode == "soft" {
        "--soft"
    } else if mode == "mixed" {
        "--mixed"
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid mode", "code": "invalid_mode"})),
        )
            .into_response();
    };

    let (code, out, err) = run_git(&dir, &["reset", flag, commit]).await.unwrap_or((
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
            Json(serde_json::json!({"error": err.trim(), "code": "git_reset_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true, "mode": mode, "commit": commit})).into_response()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitTemplateResponse {
    pub configured: bool,
    pub path: Option<String>,
    pub template: Option<String>,
}

pub async fn git_commit_template(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let global = git_config_get(None, "--global", "commit.template").await;
    let raw = git_config_get(Some(&dir), "--local", "commit.template")
        .await
        .or(global);
    let Some(p) = raw else {
        return Json(GitCommitTemplateResponse {
            configured: false,
            path: None,
            template: None,
        })
        .into_response();
    };

    let mut path = PathBuf::from(p.trim());
    if !path.is_absolute() {
        path = dir.join(path);
    }

    let Ok(meta) = tokio::fs::metadata(&path).await else {
        return Json(GitCommitTemplateResponse {
            configured: true,
            path: Some(path.to_string_lossy().into_owned()),
            template: None,
        })
        .into_response();
    };
    if !meta.is_file() || meta.len() > 64 * 1024 {
        return Json(GitCommitTemplateResponse {
            configured: true,
            path: Some(path.to_string_lossy().into_owned()),
            template: None,
        })
        .into_response();
    }

    let template = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    let t = template.trim_end().to_string();
    Json(GitCommitTemplateResponse {
        configured: true,
        path: Some(path.to_string_lossy().into_owned()),
        template: Some(t),
    })
    .into_response()
}

fn parse_commit_hash(stdout: &str) -> String {
    // Capture last commit hash.
    stdout.trim().to_string()
}

fn parse_shortstat(lines: &[&str]) -> (i32, i32, i32) {
    // " 2 files changed, 10 insertions(+), 1 deletion(-)"
    let mut files = 0;
    let mut ins = 0;
    let mut del = 0;
    for line in lines {
        if let Some(pos) = line.find("files changed") {
            let num = line[..pos].split_whitespace().last().unwrap_or("0");
            files = num.parse::<i32>().unwrap_or(0);
        }
        if let Some(pos) = line.find("insertions") {
            let num = line[..pos].split_whitespace().last().unwrap_or("0");
            ins = num.parse::<i32>().unwrap_or(0);
        }
        if let Some(pos) = line.find("deletions") {
            let num = line[..pos].split_whitespace().last().unwrap_or("0");
            del = num.parse::<i32>().unwrap_or(0);
        }
    }
    (files, ins, del)
}

pub async fn git_commit(
    State(state): State<Arc<crate::AppState>>,
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitCommitBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let Some(message) = body
        .message
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "message is required", "code": "missing_message"})),
        )
            .into_response();
    };

    let add_all = body.add_all.unwrap_or(false);
    let files = body.files.unwrap_or_default();

    if body.no_verify.unwrap_or(false) && !git_allow_no_verify_commit(&state).await {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Commits without verification are disabled by policy",
                "code": "git_no_verify_not_allowed",
                "hint": "Enable gitAllowNoVerifyCommit in settings if this is intentional.",
            })),
        )
            .into_response();
    }

    if git_enforce_branch_protection(&state).await {
        if let Some(branch) = super::remote::git_current_branch(&dir).await
            && let Some(prompt_mode) = git_branch_protection_for_branch(&state, &branch).await
            && prompt_mode == GitBranchProtectionPrompt::AlwaysCommitToNewBranch
        {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "error": format!("Branch '{branch}' is protected; commit on a new branch instead."),
                    "code": "git_branch_protected",
                    "branch": branch,
                    "promptMode": prompt_mode.as_str(),
                    "category": "policy",
                    "hint": "Create a new branch and commit there, or change gitBranchProtectionPrompt in settings.",
                })),
            )
                .into_response();
        }
    }

    // If the repo uses GPG signing and the key is passphrase protected, we can't prompt
    // in a server context. Instead, accept an optional passphrase from the UI and
    // preset it into gpg-agent so signing can proceed non-interactively.
    if let Some(pp) = body
        .gpg_passphrase
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let signing_key = git_config_get(Some(&dir), "--local", "user.signingkey").await;
        // First query keys so we can return a more specific error if gpg is unavailable.
        let keys = match super::gpg::gpg_list_keys_for_signing().await {
            Ok(k) => k,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": format!("Failed to query GPG secret keys: {e}"),
                        "code": "gpg_keys_unavailable",
                        "hint": "Ensure gpg is installed and your secret key exists on this machine.",
                    })),
                )
                    .into_response();
            }
        };
        if keys.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "No GPG secret key with keygrip found",
                    "code": "gpg_no_secret_key",
                    "hint": "Import your secret key and/or set user.signingkey in this repository.",
                })),
            )
                .into_response();
        }
        if let Err(e) = super::gpg::gpg_preset_for_signing(signing_key.as_deref(), pp).await {
            let code = if e.to_ascii_lowercase().contains("no gpg secret key") {
                "gpg_no_secret_key"
            } else {
                "gpg_preset_failed"
            };
            let mut body = serde_json::json!({
                "error": format!("Failed to preset GPG passphrase: {e}"),
                "code": code,
            });
            if code == "gpg_preset_failed" {
                body["hint"] = serde_json::Value::String(
                    "Your gpg-agent may not allow presetting passphrases. You can enable allow-preset-passphrase from the UI and retry."
                        .to_string(),
                );
                body["canEnablePreset"] = serde_json::Value::Bool(true);
            }
            return (StatusCode::BAD_REQUEST, Json(body)).into_response();
        }
    }

    if add_all {
        let (c, o, e) =
            run_git(&dir, &["add", "-A"])
                .await
                .unwrap_or((1, "".to_string(), "".to_string()));
        if c != 0 {
            if let Some(resp) = map_git_failure(c, &o, &e) {
                return resp;
            }
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": e.trim(),
                    "stdout": o,
                    "stderr": e,
                    "code": "git_add_failed"
                })),
            )
                .into_response();
        }
    } else if !files.is_empty() {
        let mut args: Vec<&str> = vec!["add", "--"];
        for f in &files {
            args.push(f);
        }
        let (c, o, e) = run_git(&dir, &args)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
        if c != 0 {
            if let Some(resp) = map_git_failure(c, &o, &e) {
                return resp;
            }
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.trim()})),
            )
                .into_response();
        }
    }

    // Commit.
    let mut commit_args: Vec<&str> = vec!["commit"];
    if body.no_verify.unwrap_or(false) {
        commit_args.push("--no-verify");
    }
    if body.signoff.unwrap_or(false) {
        commit_args.push("--signoff");
    }
    if body.amend.unwrap_or(false) {
        commit_args.push("--amend");
    }
    if body.allow_empty.unwrap_or(false) {
        commit_args.push("--allow-empty");
    }
    if body.no_gpg_sign.unwrap_or(false) {
        commit_args.push("--no-gpg-sign");
    }
    commit_args.extend(["-m", message]);
    if !add_all && !files.is_empty() {
        commit_args.push("--");
        for f in &files {
            commit_args.push(f);
        }
    }
    let (c, o, e) =
        run_git(&dir, &commit_args)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if c != 0 {
        if let Some(resp) = map_git_failure(c, &o, &e) {
            return resp;
        }
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": truncate_for_payload(&redact_git_output(&e), 8_000),
                "code": "git_commit_failed",
                "stdout": redact_git_output(&truncate_for_payload(&o, 16_000)),
                "stderr": redact_git_output(&truncate_for_payload(&e, 16_000)),
                "exitCode": c,
            })),
        )
            .into_response();
    }

    // Return commit hash + branch.
    let commit = run_git(&dir, &["rev-parse", "HEAD"])
        .await
        .ok()
        .map(|(_, o, _)| parse_commit_hash(&o))
        .unwrap_or_default();
    let branch = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .ok()
        .map(|(_, o, _)| o.trim().to_string())
        .unwrap_or_default();

    // Best-effort summary from last commit.
    let (files_changed, insertions, deletions) = {
        let (c3, o3, _) = run_git(&dir, &["show", "--shortstat", "--format=", "HEAD"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
        if c3 != 0 {
            (0, 0, 0)
        } else {
            let lines: Vec<&str> = o3.lines().collect();
            parse_shortstat(&lines)
        }
    };

    Json(GitCommitResult {
        success: true,
        commit,
        branch,
        summary: GitCommitSummary {
            changes: files_changed,
            insertions,
            deletions,
        },
    })
    .into_response()
}
