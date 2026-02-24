use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::super::remote::git_current_branch;
use super::super::{DirectoryQuery, lock_repo, map_git_failure, require_directory, run_git};

const GH_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Deserialize)]
pub struct GitCreateGithubRepoAndPushBody {
    pub name: Option<String>,
    pub remote: Option<String>,
    #[serde(rename = "private")]
    pub private_repo: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCreateGithubRepoAndPushResult {
    pub success: bool,
    pub owner: String,
    pub repo: String,
    pub full_name: String,
    pub remote: String,
    pub branch: String,
    pub clone_url: String,
    pub html_url: String,
}

#[derive(Debug, Deserialize)]
struct GhUserResponse {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GhCreateRepoResponse {
    full_name: String,
    clone_url: String,
    html_url: String,
}

enum GhRunError {
    Spawn(std::io::Error),
    Timeout,
}

async fn run_gh(directory: &Path, args: &[&str]) -> Result<(i32, String, String), GhRunError> {
    let mut cmd = Command::new("gh");
    cmd.args(args)
        .current_dir(directory)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0");

    let out = match tokio::time::timeout(GH_TIMEOUT, cmd.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => return Err(GhRunError::Spawn(err)),
        Err(_) => return Err(GhRunError::Timeout),
    };

    Ok((
        out.status.code().unwrap_or(1),
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
    ))
}

fn derive_repo_name(directory: &Path, requested: Option<&str>) -> Option<String> {
    let base = requested
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            directory
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.trim().to_string())
        })?;

    let mut out = String::new();
    let mut last_dash = false;
    for ch in base.chars() {
        let keep = ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.';
        if keep {
            out.push(ch);
            last_dash = false;
            continue;
        }
        if (ch.is_ascii_whitespace() || ch == '/') && !last_dash {
            out.push('-');
            last_dash = true;
        }
    }

    let trimmed = out.trim_matches(['-', '.']).to_string();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(100).collect())
}

fn validate_remote_name(input: Option<&str>) -> Option<String> {
    let remote = input
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("origin");
    if remote
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.')
    {
        Some(remote.to_string())
    } else {
        None
    }
}

fn gh_cli_missing_response() -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": "GitHub CLI (gh) is not installed or not available in PATH",
            "code": "gh_cli_missing",
            "hint": "Install gh from https://cli.github.com/ and run `gh auth login`, then retry.",
        })),
    )
        .into_response()
}

pub async fn git_create_github_repo_and_push(
    State(_state): State<Arc<crate::AppState>>,
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitCreateGithubRepoAndPushBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let repo_name = match derive_repo_name(&dir, body.name.as_deref()) {
        Some(name) => name,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Unable to derive a valid repository name",
                    "code": "invalid_repo_name",
                    "hint": "Pass a repository name with letters, numbers, '.', '_' or '-'.",
                })),
            )
                .into_response();
        }
    };

    let remote = match validate_remote_name(body.remote.as_deref()) {
        Some(remote) => remote,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Invalid remote name",
                    "code": "invalid_remote_name",
                    "hint": "Use a simple remote name like origin, upstream, or github.",
                })),
            )
                .into_response();
        }
    };

    let branch = match git_current_branch(&dir).await {
        Some(branch) => branch,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Cannot publish from detached HEAD",
                    "code": "git_detached_head",
                    "hint": "Checkout a branch first, then retry.",
                })),
            )
                .into_response();
        }
    };

    match run_gh(&dir, &["--version"]).await {
        Ok((0, _, _)) => {}
        Ok(_) => return gh_cli_missing_response(),
        Err(GhRunError::Spawn(err)) if err.kind() == std::io::ErrorKind::NotFound => {
            return gh_cli_missing_response();
        }
        Err(GhRunError::Spawn(err)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to run gh CLI: {err}"),
                    "code": "gh_cli_unavailable",
                })),
            )
                .into_response();
        }
        Err(GhRunError::Timeout) => {
            return (
                StatusCode::REQUEST_TIMEOUT,
                Json(serde_json::json!({
                    "error": "Timed out while checking gh CLI",
                    "code": "gh_cli_timeout",
                })),
            )
                .into_response();
        }
    }

    let (auth_code, auth_out, auth_err) = match run_gh(&dir, &["api", "user"]).await {
        Ok(res) => res,
        Err(GhRunError::Spawn(err)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to run gh auth check: {err}"),
                    "code": "gh_auth_check_failed",
                })),
            )
                .into_response();
        }
        Err(GhRunError::Timeout) => {
            return (
                StatusCode::REQUEST_TIMEOUT,
                Json(serde_json::json!({
                    "error": "Timed out while checking gh authentication",
                    "code": "gh_auth_check_timeout",
                })),
            )
                .into_response();
        }
    };

    if auth_code != 0 {
        let auth_msg = if !auth_err.trim().is_empty() {
            auth_err.trim().to_string()
        } else if !auth_out.trim().is_empty() {
            auth_out.trim().to_string()
        } else {
            "GitHub CLI is not authenticated".to_string()
        };
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": auth_msg,
                "code": "gh_auth_required",
                "hint": "Run `gh auth login` for github.com and retry.",
            })),
        )
            .into_response();
    }

    let user = match serde_json::from_str::<GhUserResponse>(&auth_out) {
        Ok(user) if !user.login.trim().is_empty() => user,
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "error": "Unable to read authenticated GitHub user from gh CLI",
                    "code": "gh_auth_required",
                    "hint": "Run `gh auth login` and make sure github.com is selected.",
                })),
            )
                .into_response();
        }
    };

    let remote_check = run_git(&dir, &["remote", "get-url", &remote])
        .await
        .unwrap_or((1, String::new(), String::new()));
    if remote_check.0 == 0 {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": format!("Remote '{remote}' already exists"),
                "code": "git_remote_exists",
                "hint": "Use Push, or choose a different remote name.",
            })),
        )
            .into_response();
    }

    let is_private = body.private_repo.unwrap_or(true);
    let private_value = if is_private { "true" } else { "false" };
    let (create_code, create_out, create_err) = match run_gh(
        &dir,
        &[
            "api",
            "user/repos",
            "--method",
            "POST",
            "-f",
            &format!("name={repo_name}"),
            "-f",
            &format!("private={private_value}"),
        ],
    )
    .await
    {
        Ok(res) => res,
        Err(GhRunError::Spawn(err)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to create GitHub repository via gh: {err}"),
                    "code": "gh_repo_create_failed",
                })),
            )
                .into_response();
        }
        Err(GhRunError::Timeout) => {
            return (
                StatusCode::REQUEST_TIMEOUT,
                Json(serde_json::json!({
                    "error": "Timed out while creating GitHub repository",
                    "code": "gh_repo_create_timeout",
                })),
            )
                .into_response();
        }
    };

    if create_code != 0 {
        let msg = if !create_err.trim().is_empty() {
            create_err.trim().to_string()
        } else if !create_out.trim().is_empty() {
            create_out.trim().to_string()
        } else {
            "Failed to create GitHub repository".to_string()
        };
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": msg,
                "code": "gh_repo_create_failed",
                "hint": "Check repository name/permissions and retry.",
            })),
        )
            .into_response();
    }

    let created = match serde_json::from_str::<GhCreateRepoResponse>(&create_out) {
        Ok(info) => info,
        Err(err) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "error": format!("Could not parse GitHub create-repo response: {err}"),
                    "code": "gh_repo_create_parse_failed",
                })),
            )
                .into_response();
        }
    };

    let (add_code, add_out, add_err) =
        run_git(&dir, &["remote", "add", &remote, &created.clone_url])
            .await
            .unwrap_or((1, String::new(), String::new()));
    if add_code != 0 {
        if let Some(resp) = map_git_failure(add_code, &add_out, &add_err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": add_err.trim(),
                "code": "git_remote_add_failed",
            })),
        )
            .into_response();
    }

    let (push_code, push_out, push_err) =
        run_git(&dir, &["push", "--set-upstream", &remote, &branch])
            .await
            .unwrap_or((1, String::new(), String::new()));
    if push_code != 0 {
        if let Some(resp) = map_git_failure(push_code, &push_out, &push_err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": push_err.trim(),
                "code": "git_push_failed",
            })),
        )
            .into_response();
    }

    Json(GitCreateGithubRepoAndPushResult {
        success: true,
        owner: user.login,
        repo: repo_name,
        full_name: created.full_name,
        remote,
        branch,
        clone_url: created.clone_url,
        html_url: created.html_url,
    })
    .into_response()
}
