use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::utils::git_config_get;
use super::{
    DirectoryQuery, lock_repo, map_git_failure, require_directory, require_directory_raw, run_git,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
    pub protocol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfoResponse {
    pub remotes: Vec<GitRemoteInfo>,
}

fn parse_remote_url(url: &str) -> (String, Option<String>) {
    let u = url.trim();
    if u.starts_with("http://") || u.starts_with("https://") {
        let rest = u.split("//").nth(1).unwrap_or("");
        let host = rest.split('/').next().unwrap_or("").trim();
        return (
            "https".to_string(),
            if host.is_empty() {
                None
            } else {
                Some(host.to_string())
            },
        );
    }
    if u.starts_with("ssh://") {
        // ssh://user@host/...
        let rest = u.trim_start_matches("ssh://");
        let host_part = rest.split('/').next().unwrap_or("");
        let host = host_part.split('@').next_back().unwrap_or(host_part).trim();
        return (
            "ssh".to_string(),
            if host.is_empty() {
                None
            } else {
                Some(host.to_string())
            },
        );
    }
    // scp-like: git@host:owner/repo.git
    if u.contains('@') && u.contains(':') {
        let after_at = u.split('@').nth(1).unwrap_or("");
        let host = after_at.split(':').next().unwrap_or("").trim();
        return (
            "ssh".to_string(),
            if host.is_empty() {
                None
            } else {
                Some(host.to_string())
            },
        );
    }
    if u.starts_with("file://") {
        return ("file".to_string(), None);
    }
    // local path or unknown.
    ("unknown".to_string(), None)
}

pub async fn git_remote_info(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let (code, out, err) =
        run_git(&dir, &["remote", "-v"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_remote_failed"})),
        )
            .into_response();
    }

    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut remotes: Vec<GitRemoteInfo> = Vec::new();
    for line in out.lines() {
        // format: <name> <url> (fetch)
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let name = parts.next().unwrap_or("").trim();
        let url = parts.next().unwrap_or("").trim();
        if name.is_empty() || url.is_empty() {
            continue;
        }
        let key = (name.to_string(), url.to_string());
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        let (protocol, host) = parse_remote_url(url);
        remotes.push(GitRemoteInfo {
            name: name.to_string(),
            url: url.to_string(),
            protocol,
            host,
        });
    }
    remotes.sort_by(|a, b| a.name.cmp(&b.name).then(a.url.cmp(&b.url)));

    Json(GitRemoteInfoResponse { remotes }).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitRemoteAddBody {
    pub name: Option<String>,
    pub url: Option<String>,
}

pub async fn git_remote_add(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitRemoteAddBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(name) = body
        .name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "name is required", "code": "missing_name"})),
        )
            .into_response();
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

    let (code, out, err) = run_git(&dir, &["remote", "add", name, url])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_remote_add_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteRenameBody {
    pub name: Option<String>,
    pub new_name: Option<String>,
}

pub async fn git_remote_rename(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitRemoteRenameBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(name) = body
        .name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "name is required", "code": "missing_name"})),
        )
            .into_response();
    };
    let Some(new_name) = body
        .new_name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "newName is required", "code": "missing_new_name"})),
        )
            .into_response();
    };

    let (code, out, err) = run_git(&dir, &["remote", "rename", name, new_name])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_remote_rename_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitRemoteSetUrlBody {
    pub name: Option<String>,
    pub url: Option<String>,
}

pub async fn git_remote_set_url(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitRemoteSetUrlBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(name) = body
        .name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "name is required", "code": "missing_name"})),
        )
            .into_response();
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

    let (code, out, err) = run_git(&dir, &["remote", "set-url", name, url])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_remote_set_url_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitRemoteRemoveBody {
    pub name: Option<String>,
}

pub async fn git_remote_remove(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitRemoteRemoveBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(name) = body
        .name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "name is required", "code": "missing_name"})),
        )
            .into_response();
    };

    let (code, out, err) = run_git(&dir, &["remote", "remove", name]).await.unwrap_or((
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
            Json(serde_json::json!({"error": err.trim(), "code": "git_remote_remove_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSigningInfoResponse {
    pub commit_gpgsign: bool,
    pub gpg_format: String,
    pub signing_key: Option<String>,
    pub gpg_program: Option<String>,

    // SSH signing (when gpg.format=ssh).
    pub ssh_signing_key: Option<String>,
    pub ssh_auth_sock_present: bool,
    pub ssh_agent_has_keys: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_agent_error: Option<String>,
}

pub async fn git_signing_info(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let global_commit_gpgsign = git_config_get(None, "--global", "commit.gpgsign").await;
    let raw_commit_gpgsign = git_config_get(Some(&dir), "--local", "commit.gpgsign")
        .await
        .or(global_commit_gpgsign)
        .unwrap_or_else(|| "false".to_string())
        .to_ascii_lowercase();

    let commit_gpgsign =
        raw_commit_gpgsign == "true" || raw_commit_gpgsign == "1" || raw_commit_gpgsign == "yes";

    let global_gpg_format = git_config_get(None, "--global", "gpg.format").await;
    let gpg_format = git_config_get(Some(&dir), "--local", "gpg.format")
        .await
        .or(global_gpg_format)
        .unwrap_or_else(|| "openpgp".to_string());

    let global_signing_key = git_config_get(None, "--global", "user.signingkey").await;
    let signing_key = git_config_get(Some(&dir), "--local", "user.signingkey")
        .await
        .or(global_signing_key);

    let global_gpg_program = git_config_get(None, "--global", "gpg.program").await;
    let gpg_program = git_config_get(Some(&dir), "--local", "gpg.program")
        .await
        .or(global_gpg_program);

    let global_ssh_signing_key = git_config_get(None, "--global", "ssh.signingkey").await;
    let ssh_signing_key = git_config_get(Some(&dir), "--local", "ssh.signingkey")
        .await
        .or(global_ssh_signing_key);

    let (ssh_auth_sock_present, ssh_agent_has_keys, ssh_agent_error) = ssh_agent_probe().await;

    Json(GitSigningInfoResponse {
        commit_gpgsign,
        gpg_format: gpg_format.trim().to_string(),
        signing_key,
        gpg_program,
        ssh_signing_key,
        ssh_auth_sock_present,
        ssh_agent_has_keys,
        ssh_agent_error,
    })
    .into_response()
}

async fn ssh_agent_probe() -> (bool, bool, Option<String>) {
    // Heuristic only: VS Code delegates to environment/agent. We do the same and
    // return enough info for the UI to guide users.
    let sock = std::env::var("SSH_AUTH_SOCK").unwrap_or_default();
    if sock.trim().is_empty() {
        return (false, false, None);
    }

    // `ssh-add -L` prints public keys; it should not require interaction.
    let mut cmd = Command::new("ssh-add");
    cmd.args(["-L"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let out = tokio::time::timeout(Duration::from_secs(2), cmd.output()).await;
    let Ok(Ok(output)) = out else {
        return (
            true,
            false,
            Some("ssh-add probe timed out or failed".to_string()),
        );
    };

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if err.is_empty() {
            return (true, false, Some("ssh-add returned an error".to_string()));
        }
        return (true, false, Some(err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let has_keys = stdout.lines().any(|l| !l.trim().is_empty());
    (true, has_keys, None)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoStateResponse {
    pub current_branch: Option<String>,
    pub upstream: Option<String>,
    pub merge_in_progress: bool,
    pub rebase_in_progress: bool,
    pub cherry_pick_in_progress: bool,
    pub revert_in_progress: bool,
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

pub async fn git_state(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let current_branch = git_current_branch(&dir).await;
    let upstream = git_upstream_ref(&dir).await;

    let merge_in_progress = git_path_exists(&dir, "MERGE_HEAD").await;
    let cherry_pick_in_progress = git_path_exists(&dir, "CHERRY_PICK_HEAD").await;
    let revert_in_progress = git_path_exists(&dir, "REVERT_HEAD").await;
    let rebase_in_progress =
        git_path_exists(&dir, "rebase-apply").await || git_path_exists(&dir, "rebase-merge").await;

    Json(GitRepoStateResponse {
        current_branch,
        upstream,
        merge_in_progress,
        rebase_in_progress,
        cherry_pick_in_progress,
        revert_in_progress,
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitRemoteBranchesQuery {
    pub directory: Option<String>,
    pub remote: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteBranchListResponse {
    pub remote: String,
    pub branches: Vec<String>,
}

pub async fn git_remote_branches_list(Query(q): Query<GitRemoteBranchesQuery>) -> Response {
    let dir = match require_directory_raw(q.directory.as_deref()) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };
    let remote = q
        .remote
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("origin");

    // Use ls-remote for remote heads without fetching.
    let (code, out, err) = run_git(&dir, &["ls-remote", "--heads", remote])
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

    let mut branches: Vec<String> = Vec::new();
    for line in out.lines() {
        // <hash>\trefs/heads/<name>
        let Some((_hash, r)) = line.split_once('\t') else {
            continue;
        };
        let r = r.trim();
        if let Some(name) = r.strip_prefix("refs/heads/") {
            let n = name.trim();
            if !n.is_empty() {
                branches.push(n.to_string());
            }
        }
    }
    branches.sort();
    branches.dedup();

    Json(GitRemoteBranchListResponse {
        remote: remote.to_string(),
        branches,
    })
    .into_response()
}

pub(crate) async fn git_current_branch(dir: &Path) -> Option<String> {
    // `symbolic-ref` returns a stable answer and fails on detached HEAD.
    let (code, out, _) = run_git(dir, &["symbolic-ref", "--short", "HEAD"])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        return None;
    }
    let b = out.trim();
    if b.is_empty() {
        None
    } else {
        Some(b.to_string())
    }
}

pub(crate) async fn git_upstream_ref(dir: &Path) -> Option<String> {
    // Examples: "origin/main". Fails if no upstream is configured.
    let (code, out, _) = run_git(
        dir,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .await
    .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        return None;
    }
    let s = out.trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}
