use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use super::{DirectoryQuery, lock_repo, map_git_failure, require_directory, run_git, run_git_env};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSubmoduleInfo {
    pub path: String,
    pub url: String,
    pub branch: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GitSubmoduleListResponse {
    pub submodules: Vec<GitSubmoduleInfo>,
}

fn parse_gitmodules(contents: &str) -> Vec<GitSubmoduleInfo> {
    let mut out: Vec<GitSubmoduleInfo> = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_url: Option<String> = None;
    let mut current_branch: Option<String> = None;

    let flush = |out: &mut Vec<GitSubmoduleInfo>,
                 path: &mut Option<String>,
                 url: &mut Option<String>,
                 branch: &mut Option<String>| {
        if let (Some(p), Some(u)) = (path.take(), url.take()) {
            out.push(GitSubmoduleInfo {
                path: p,
                url: u,
                branch: branch.take(),
            });
        } else {
            path.take();
            url.take();
            branch.take();
        }
    };

    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with("[submodule") {
            flush(
                &mut out,
                &mut current_path,
                &mut current_url,
                &mut current_branch,
            );
            continue;
        }
        if let Some(rest) = line.strip_prefix("path =") {
            current_path = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("url =") {
            current_url = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("branch =") {
            current_branch = Some(rest.trim().to_string());
        }
    }

    flush(
        &mut out,
        &mut current_path,
        &mut current_url,
        &mut current_branch,
    );
    out
}

pub async fn git_submodules(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let gitmodules = dir.join(".gitmodules");
    let contents = tokio::fs::read_to_string(&gitmodules)
        .await
        .unwrap_or_default();
    let mut submodules = parse_gitmodules(&contents);
    submodules.sort_by(|a, b| a.path.cmp(&b.path));

    Json(GitSubmoduleListResponse { submodules }).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSubmoduleAddBody {
    pub url: Option<String>,
    pub path: Option<String>,
    pub branch: Option<String>,
}

pub async fn git_submodule_add(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitSubmoduleAddBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };
    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
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

    let mut args: Vec<&str> = vec!["submodule", "add"];
    if let Some(branch) = body
        .branch
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        args.push("-b");
        args.push(branch);
    }
    args.push(url);
    args.push(path);

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
            Json(serde_json::json!({"error": err.trim(), "code": "git_submodule_add_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitSubmodulePathBody {
    pub path: Option<String>,
}

pub async fn git_submodule_init(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitSubmodulePathBody>,
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

    let (code, out, err) = run_git(&dir, &["submodule", "init", "--", path])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_submodule_init_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSubmoduleUpdateBody {
    pub path: Option<String>,
    pub init: Option<bool>,
    pub recursive: Option<bool>,
}

pub async fn git_submodule_update(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitSubmoduleUpdateBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };
    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let mut args: Vec<&str> = vec!["submodule", "update"];
    if body.init.unwrap_or(false) {
        args.push("--init");
    }
    if body.recursive.unwrap_or(false) {
        args.push("--recursive");
    }
    if let Some(path) = body
        .path
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        args.push("--");
        args.push(path);
    }

    let (code, out, err) =
        run_git_env(&dir, &args, &[])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_submodule_update_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}
