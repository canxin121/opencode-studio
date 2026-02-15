use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use super::{DirectoryQuery, lock_repo, map_git_failure, require_directory, run_git};

fn is_lfs_missing(out: &str, err: &str) -> bool {
    let combined = format!("{}\n{}", out, err).to_ascii_lowercase();
    combined.contains("git: 'lfs' is not a git command")
        || combined.contains("not a git command") && combined.contains("lfs")
        || combined.contains("git-lfs") && combined.contains("not found")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLfsStatusResponse {
    pub installed: bool,
    pub version: Option<String>,
    pub tracked: Vec<String>,
}

fn parse_lfs_version(out: &str) -> Option<String> {
    let line = out.lines().next()?.trim();
    if line.is_empty() {
        None
    } else {
        Some(line.to_string())
    }
}

fn parse_lfs_tracked(out: &str) -> Vec<String> {
    let mut patterns = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty()
            || line
                .to_ascii_lowercase()
                .contains("listing tracked patterns")
        {
            continue;
        }
        let pattern = line
            .split_once(" (")
            .map(|(p, _)| p.trim())
            .unwrap_or_else(|| line.split_whitespace().next().unwrap_or(""));
        if !pattern.is_empty() {
            patterns.push(pattern.to_string());
        }
    }
    patterns
}

pub async fn git_lfs_status(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let (code, out, err) =
        run_git(&dir, &["lfs", "version"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if is_lfs_missing(&out, &err) {
            return Json(GitLfsStatusResponse {
                installed: false,
                version: None,
                tracked: vec![],
            })
            .into_response();
        }
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_lfs_failed"})),
        )
            .into_response();
    }

    let version = parse_lfs_version(&out);
    let tracked = run_git(&dir, &["lfs", "track", "-l"])
        .await
        .ok()
        .map(|(c, out, _)| {
            if c == 0 {
                parse_lfs_tracked(&out)
            } else {
                vec![]
            }
        })
        .unwrap_or_default();

    Json(GitLfsStatusResponse {
        installed: true,
        version,
        tracked,
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitLfsInstallBody {
    pub force: Option<bool>,
}

pub async fn git_lfs_install(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitLfsInstallBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };
    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let mut args: Vec<&str> = vec!["lfs", "install", "--local"];
    if body.force.unwrap_or(false) {
        args.push("--force");
    }

    let (code, out, err) =
        run_git(&dir, &args)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if is_lfs_missing(&out, &err) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "git-lfs not installed", "code": "lfs_missing"})),
            )
                .into_response();
        }
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_lfs_install_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitLfsTrackBody {
    pub pattern: Option<String>,
}

pub async fn git_lfs_track(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitLfsTrackBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };
    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(pattern) = body
        .pattern
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "pattern is required", "code": "missing_pattern"})),
        )
            .into_response();
    };

    let (code, out, err) = run_git(&dir, &["lfs", "track", pattern]).await.unwrap_or((
        1,
        "".to_string(),
        "".to_string(),
    ));
    if code != 0 {
        if is_lfs_missing(&out, &err) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "git-lfs not installed", "code": "lfs_missing"})),
            )
                .into_response();
        }
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_lfs_track_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLfsLockInfo {
    pub id: String,
    pub path: String,
    pub owner: Option<String>,
    pub locked_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GitLfsLocksResponse {
    pub locks: Vec<GitLfsLockInfo>,
}

#[derive(Debug, Deserialize)]
struct GitLfsLocksJson {
    locks: Vec<GitLfsLocksJsonItem>,
}

#[derive(Debug, Deserialize)]
struct GitLfsLocksJsonItem {
    id: Option<String>,
    path: Option<String>,
    locked_at: Option<String>,
    owner: Option<GitLfsLocksOwner>,
}

#[derive(Debug, Deserialize)]
struct GitLfsLocksOwner {
    name: Option<String>,
}

pub async fn git_lfs_locks(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let (code, out, err) = run_git(&dir, &["lfs", "locks", "--json"]).await.unwrap_or((
        1,
        "".to_string(),
        "".to_string(),
    ));
    if code != 0 {
        if is_lfs_missing(&out, &err) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "git-lfs not installed", "code": "lfs_missing"})),
            )
                .into_response();
        }
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_lfs_locks_failed"})),
        )
            .into_response();
    }

    let parsed: GitLfsLocksJson =
        serde_json::from_str(&out).unwrap_or(GitLfsLocksJson { locks: vec![] });
    let locks = parsed
        .locks
        .into_iter()
        .filter_map(|l| {
            let path = l.path?.trim().to_string();
            if path.is_empty() {
                return None;
            }
            Some(GitLfsLockInfo {
                id: l.id.unwrap_or_default(),
                path,
                owner: l.owner.and_then(|o| o.name),
                locked_at: l.locked_at,
            })
        })
        .collect::<Vec<_>>();

    Json(GitLfsLocksResponse { locks }).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitLfsLockBody {
    pub path: Option<String>,
}

pub async fn git_lfs_lock(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitLfsLockBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };
    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(path) = body
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

    let (code, out, err) =
        run_git(&dir, &["lfs", "lock", path])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if is_lfs_missing(&out, &err) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "git-lfs not installed", "code": "lfs_missing"})),
            )
                .into_response();
        }
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_lfs_lock_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitLfsUnlockBody {
    pub path: Option<String>,
    pub force: Option<bool>,
}

pub async fn git_lfs_unlock(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitLfsUnlockBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };
    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(path) = body
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

    let mut args: Vec<&str> = vec!["lfs", "unlock"];
    if body.force.unwrap_or(false) {
        args.push("--force");
    }
    args.push(path);

    let (code, out, err) =
        run_git(&dir, &args)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if is_lfs_missing(&out, &err) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "git-lfs not installed", "code": "lfs_missing"})),
            )
                .into_response();
        }
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_lfs_unlock_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}
