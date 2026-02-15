use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use super::super::{
    DirectoryQuery, GitAuthInput, TempGitAskpass, git_http_auth_env, lock_repo, map_git_failure,
    normalize_http_auth, require_directory, run_git_env,
};

#[derive(Debug, Deserialize)]
pub struct GitPullBody {
    pub remote: Option<String>,
    pub branch: Option<String>,
    // git pull --rebase
    #[serde(default)]
    pub rebase: Option<bool>,
    // Alias for refspec.
    pub r#ref: Option<String>,
    #[serde(default)]
    pub auth: Option<GitAuthInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub changes: i32,
    pub insertions: i32,
    pub deletions: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullResult {
    pub success: bool,
    pub summary: GitCommitSummary,
    pub files: Vec<String>,
    pub insertions: i32,
    pub deletions: i32,
}

fn parse_pull_stat(stdout: &str) -> (Vec<String>, i32, i32) {
    // Parse lines like:
    //  file.txt | 2 +-
    //  2 files changed, 10 insertions(+), 1 deletion(-)
    let mut files = Vec::new();
    for line in stdout.lines() {
        if line.contains('|') {
            let name = line.split('|').next().unwrap_or("").trim();
            if !name.is_empty() {
                files.push(name.to_string());
            }
        }
    }
    let mut ins = 0;
    let mut del = 0;
    for line in stdout.lines() {
        if line.contains("insertions")
            && let Some(n) = line.split_whitespace().next()
        {
            ins = n.parse::<i32>().unwrap_or(0);
        }
        if line.contains("deletions") {
            // line: "..., 1 deletion(-)"
            if let Some(part) = line
                .split(',')
                .map(|s| s.trim())
                .find(|p| p.contains("deletion"))
                && let Some(n) = part.split_whitespace().next()
            {
                del = n.parse::<i32>().unwrap_or(0);
            }
        }
    }
    (files, ins, del)
}

pub async fn git_pull(Query(q): Query<DirectoryQuery>, Json(body): Json<GitPullBody>) -> Response {
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
        .filter(|s| !s.is_empty());
    let branch = body
        .branch
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let rf = body
        .r#ref
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let rebase = body.rebase.unwrap_or(false);

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
    args.push("pull".into());
    if rebase {
        args.push("--rebase".into());
    }
    let spec = branch.or(rf);
    if let Some(b) = spec {
        let Some(r) = remote else {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "remote is required when branch is provided"})),
            )
                .into_response();
        };
        args.push(r.into());
        args.push(b.into());
    }
    // Get a stat summary in stdout.
    args.push("--stat".into());

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
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim()})),
        )
            .into_response();
    }

    let (files, insertions, deletions) = parse_pull_stat(&out);
    let summary = GitCommitSummary {
        changes: files.len() as i32,
        insertions,
        deletions,
    };
    Json(GitPullResult {
        success: true,
        summary,
        files: files.clone(),
        insertions,
        deletions,
    })
    .into_response()
}
