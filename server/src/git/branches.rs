use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use super::{
    DirectoryQuery, GitAuthInput, TempGitAskpass, git_http_auth_env, lock_repo, map_git_failure,
    normalize_http_auth, require_directory, run_git, run_git_env,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchDetails {
    pub current: bool,
    pub name: String,
    pub commit: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct GitBranchesResponse {
    pub all: Vec<String>,
    pub current: String,
    pub branches: BTreeMap<String, GitBranchDetails>,
}

fn parse_track_counts(track: &str) -> (Option<i32>, Option<i32>) {
    // trackshort examples: "ahead 1" or "behind 2" or "ahead 1, behind 2" or "="
    if track.trim() == "=" {
        return (Some(0), Some(0));
    }
    let mut a = None;
    let mut b = None;
    let inside = track
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    for part in inside.split(',').map(|s| s.trim()) {
        if let Some(v) = part.strip_prefix("ahead ") {
            a = v.parse::<i32>().ok();
        }
        if let Some(v) = part.strip_prefix("behind ") {
            b = v.parse::<i32>().ok();
        }
    }
    (a, b)
}

async fn list_remote_heads(dir: &Path, remote: &str) -> Option<HashSet<String>> {
    let (code, out, _) = run_git(dir, &["ls-remote", "--heads", remote]).await.ok()?;
    if code != 0 {
        return None;
    }
    let mut set = HashSet::new();
    for line in out.lines() {
        if let Some((_, r)) = line.split_once("\trefs/heads/") {
            let name = r.trim();
            if !name.is_empty() {
                set.insert(name.to_string());
            }
        }
    }
    Some(set)
}

fn parse_remote_branch(name: &str) -> Option<(String, String)> {
    let rest = name.strip_prefix("remotes/")?;
    let (remote, branch) = rest.split_once('/')?;
    let remote = remote.trim();
    let branch = branch.trim();
    if remote.is_empty() || branch.is_empty() {
        return None;
    }
    Some((remote.to_string(), branch.to_string()))
}

async fn local_branch_exists(dir: &Path, name: &str) -> bool {
    let refname = format!("refs/heads/{name}");
    let (code, _out, _err) = run_git(dir, &["show-ref", "--verify", "--quiet", &refname])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    code == 0
}

pub async fn git_branches(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    // Determine current branch.
    let current = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .ok()
        .map(|(c, out, _)| {
            if c == 0 {
                out.trim().to_string()
            } else {
                "".to_string()
            }
        })
        .unwrap_or_default();

    // Collect list like `git branch -a` provides (including remotes/ prefix).
    let (code, out, err) = match run_git(&dir, &["branch", "-a"]).await {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e})),
            )
                .into_response();
        }
    };
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to get branches"})),
        )
            .into_response();
    }

    let mut all: Vec<String> = out
        .lines()
        .map(|l| l.trim_start_matches('*').trim())
        .map(|l| l.to_string())
        .filter(|l| !l.is_empty())
        .collect();

    // Filter remote branches to ones that actually exist on origin when possible.
    let remote_heads = list_remote_heads(&dir, "origin").await;
    if let Some(active) = remote_heads {
        all.retain(|b| {
            if let Some(rest) = b.strip_prefix("remotes/") {
                // rest looks like origin/foo
                if let Some((remote, name)) = rest.split_once('/')
                    && remote == "origin"
                {
                    return active.contains(name);
                }
            }
            true
        });
    }

    // Build branch details for local + remote refs.
    // Use for-each-ref for stable fields.
    let fmt = "%(*refname:short)\t%(refname:short)\t%(objectname)\t%(HEAD)\t%(upstream:short)\t%(upstream:track)\t%(subject)";
    let (code, out, _) = run_git(
        &dir,
        &[
            "for-each-ref",
            "--format",
            fmt,
            "refs/heads",
            "refs/remotes",
        ],
    )
    .await
    .unwrap_or((1, "".to_string(), "".to_string()));
    let mut branches: BTreeMap<String, GitBranchDetails> = BTreeMap::new();
    if code == 0 {
        for line in out.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 7 {
                continue;
            }
            let short = parts[1];
            let commit = parts[2];
            let head_flag = parts[3];
            let upstream = parts[4];
            let track = parts[5];
            let subject = parts[6];

            // Match simple-git naming: remotes/origin/foo
            let name = if short.starts_with("origin/") || short.starts_with("upstream/") {
                format!("remotes/{short}")
            } else {
                short.to_string()
            };

            let (ahead, behind) = parse_track_counts(track);
            let tracking = if upstream.trim().is_empty() {
                None
            } else {
                Some(upstream.to_string())
            };
            let label = if let Some(ref trk) = tracking {
                format!("{} [{}] {}", &commit[..commit.len().min(7)], trk, subject)
            } else {
                format!("{} {}", &commit[..commit.len().min(7)], subject)
            };

            branches.insert(
                name.clone(),
                GitBranchDetails {
                    current: head_flag == "*" || name == current,
                    name,
                    commit: commit.to_string(),
                    label,
                    tracking,
                    ahead,
                    behind,
                },
            );
        }
    }

    Json(GitBranchesResponse {
        all,
        current,
        branches,
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct CreateBranchBody {
    pub name: Option<String>,
    #[serde(rename = "startPoint")]
    pub start_point: Option<String>,
}

pub async fn git_create_branch(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<CreateBranchBody>,
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
    let start = body
        .start_point
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("HEAD");
    let (code, out, err) = run_git(&dir, &["checkout", "-b", name, start])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "create_branch_failed"})),
        )
            .into_response();
    }
    Json(serde_json::json!({"success": true, "branch": name})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct DeleteBranchBody {
    pub branch: Option<String>,
    pub force: Option<bool>,
}

pub async fn git_delete_branch(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<DeleteBranchBody>,
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
    let branch = branch.strip_prefix("refs/heads/").unwrap_or(branch);
    let flag = if body.force.unwrap_or(false) {
        "-D"
    } else {
        "-d"
    };
    let (code, out, err) = run_git(&dir, &["branch", flag, branch]).await.unwrap_or((
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
            Json(serde_json::json!({"error": err.trim(), "code": "delete_branch_failed"})),
        )
            .into_response();
    }
    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct RenameBranchBody {
    pub from: Option<String>,
    pub to: Option<String>,
    pub force: Option<bool>,
}

pub async fn git_rename_branch(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<RenameBranchBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(from) = body
        .from
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "from is required", "code": "missing_from"})),
        )
            .into_response();
    };
    let Some(to) = body
        .to
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "to is required", "code": "missing_to"})),
        )
            .into_response();
    };

    let from = from.strip_prefix("refs/heads/").unwrap_or(from);
    let to = to.strip_prefix("refs/heads/").unwrap_or(to);
    if from.starts_with("remotes/") || to.starts_with("remotes/") {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Remote branches cannot be renamed", "code": "invalid_branch"})),
        )
            .into_response();
    }
    if from == to {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Branch name unchanged", "code": "no_change"})),
        )
            .into_response();
    }

    let flag = if body.force.unwrap_or(false) {
        "-M"
    } else {
        "-m"
    };
    let (code, out, err) = run_git(&dir, &["branch", flag, from, to]).await.unwrap_or((
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
            Json(serde_json::json!({"error": err.trim(), "code": "rename_branch_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true, "from": from, "to": to})).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRemoteBranchBody {
    pub name: Option<String>,
    pub remote: Option<String>,
    pub branch: Option<String>,
}

pub async fn git_delete_remote_branch(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<DeleteRemoteBranchBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let mut remote: Option<String> = None;
    let mut branch: Option<String> = None;
    if let Some(raw) = body.name.as_deref() {
        if let Some((r, b)) = parse_remote_branch(raw.trim()) {
            remote = Some(r);
            branch = Some(b);
        }
    }

    if remote.is_none() || branch.is_none() {
        if let (Some(r), Some(b)) = (body.remote.as_deref(), body.branch.as_deref()) {
            let r = r.trim();
            let b = b.trim();
            if !r.is_empty() && !b.is_empty() {
                remote = Some(r.to_string());
                branch = Some(b.to_string());
            }
        }
    }

    let Some(remote) = remote.filter(|s| !s.trim().is_empty()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "remote is required", "code": "missing_remote"})),
        )
            .into_response();
    };
    let Some(branch) = branch.filter(|s| !s.trim().is_empty()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "branch is required", "code": "missing_branch"})),
        )
            .into_response();
    };

    let (code, out, err) = run_git(&dir, &["push", &remote, "--delete", &branch])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "delete_remote_branch_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct CheckoutBody {
    pub branch: Option<String>,
}

pub async fn git_checkout(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<CheckoutBody>,
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

    if let Some((remote, name)) = parse_remote_branch(branch) {
        if local_branch_exists(&dir, &name).await {
            let (code, out, err) = run_git(&dir, &["checkout", &name]).await.unwrap_or((
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
            return Json(serde_json::json!({"success": true, "branch": name})).into_response();
        }

        let remote_ref = format!("{remote}/{name}");
        let (code, out, err) = run_git(&dir, &["checkout", "--track", &remote_ref])
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

        return Json(serde_json::json!({"success": true, "branch": name})).into_response();
    }

    let (code, out, err) =
        run_git(&dir, &["checkout", branch])
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
    Json(serde_json::json!({"success": true, "branch": branch})).into_response()
}

async fn git_check_ref_format(dir: &Path, full_ref: &str, allow_onelevel: bool) -> bool {
    let mut args: Vec<&str> = vec!["check-ref-format"];
    if allow_onelevel {
        args.push("--allow-onelevel");
    }
    args.push(full_ref);
    let (c, _o, _e) = run_git(dir, &args)
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    c == 0
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTagInfo {
    pub name: String,
    pub object: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTagsListResponse {
    pub tags: Vec<GitTagInfo>,
}

pub async fn git_tags_list(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let (code, out, err) = run_git(
        &dir,
        &[
            "for-each-ref",
            "refs/tags",
            "--sort=-creatordate",
            "--format=%(refname:strip=2)\t%(objectname)\t%(creatordate:iso8601)\t%(subject)",
        ],
    )
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

    let mut tags: Vec<GitTagInfo> = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let name = parts[0].trim();
        let object = parts[1].trim();
        if name.is_empty() || object.is_empty() {
            continue;
        }
        let date = parts
            .get(2)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let subj = parts
            .get(3)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        tags.push(GitTagInfo {
            name: name.to_string(),
            object: object.to_string(),
            creator_date: date,
            subject: subj,
        });
    }
    Json(GitTagsListResponse { tags }).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTagCreateBody {
    pub name: Option<String>,
    pub r#ref: Option<String>,
    pub message: Option<String>,
}

pub async fn git_tags_create(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitTagCreateBody>,
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
    let full_ref = format!("refs/tags/{name}");
    if !git_check_ref_format(&dir, &full_ref, true).await {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid tag name", "code": "invalid_tag"})),
        )
            .into_response();
    }

    let target = body
        .r#ref
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let msg = body
        .message
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let mut args: Vec<String> = vec!["tag".into()];
    if let Some(m) = msg {
        args.push("-a".into());
        args.push(name.to_string());
        args.push("-m".into());
        args.push(m.to_string());
    } else {
        args.push(name.to_string());
    }
    if let Some(t) = target {
        args.push(t.to_string());
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
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": err.trim(), "code": "tag_create_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true, "name": name})).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTagDeleteBody {
    pub name: Option<String>,
}

pub async fn git_tags_delete(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitTagDeleteBody>,
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
    let (code, out, err) =
        run_git(&dir, &["tag", "-d", name])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": err.trim(), "code": "tag_delete_failed"})),
        )
            .into_response();
    }
    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTagDeleteRemoteBody {
    pub remote: Option<String>,
    pub name: Option<String>,
    #[serde(default)]
    pub auth: Option<GitAuthInput>,
}

pub async fn git_tags_delete_remote(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitTagDeleteRemoteBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let remote = body
        .remote
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("origin");
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

    let mut args: Vec<String> = Vec::new();
    let mut extra_env: Vec<(String, String)> = Vec::new();
    let mut _askpass: Option<TempGitAskpass> = None;
    if let Some((u, p)) = body.auth.as_ref().and_then(normalize_http_auth) {
        match git_http_auth_env(&u, &p).await {
            Ok((prefix, env, guard)) => {
                args.extend(prefix);
                extra_env.extend(env);
                _askpass = Some(guard);
            }
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": e, "code": "git_auth_setup_failed"})),
                )
                    .into_response();
            }
        }
    }
    args.push("push".into());
    args.push(remote.to_string());
    args.push(format!(":refs/tags/{name}"));

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let env_ref: Vec<(&str, &str)> = extra_env
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let (code, out, err) =
        run_git_env(&dir, &args_ref, &env_ref)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": err.trim(), "code": "tag_delete_remote_failed"})),
        )
            .into_response();
    }
    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutDetachedBody {
    pub r#ref: Option<String>,
}

pub async fn git_checkout_detached(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitCheckoutDetachedBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let Some(rf) = body
        .r#ref
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "ref is required", "code": "missing_ref"})),
        )
            .into_response();
    };
    let (code, out, err) = run_git(&dir, &["checkout", "--detach", rf])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": err.trim(), "code": "checkout_detached_failed"})),
        )
            .into_response();
    }
    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCreateBranchFromBody {
    pub name: Option<String>,
    pub start_point: Option<String>,
    pub checkout: Option<bool>,
}

pub async fn git_create_branch_from(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitCreateBranchFromBody>,
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
    let start = body
        .start_point
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("HEAD");

    let full_ref = format!("refs/heads/{name}");
    if !git_check_ref_format(&dir, &full_ref, true).await {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid branch name", "code": "invalid_branch"})),
        )
            .into_response();
    }

    let checkout = body.checkout.unwrap_or(false);
    let args: Vec<&str> = if checkout {
        vec!["checkout", "-b", name, start]
    } else {
        vec!["branch", name, start]
    };
    let (code, out, err) =
        run_git(&dir, &args)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": err.trim(), "code": "create_branch_from_failed"})),
        )
            .into_response();
    }
    Json(serde_json::json!({"success": true, "branch": name})).into_response()
}
