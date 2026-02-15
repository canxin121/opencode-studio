use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::super::remote::git_current_branch;
use super::super::{
    DirectoryQuery, GitAuthInput, GitBranchProtectionPrompt, TempGitAskpass, git_allow_force_push,
    git_branch_protection_for_branch, git_enforce_branch_protection, git_http_auth_env, lock_repo,
    map_git_failure, normalize_http_auth, require_directory, run_git_env,
};

#[derive(Debug, Deserialize)]
pub struct GitPushBody {
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub r#ref: Option<String>,
    #[serde(default)]
    pub tags: Option<bool>,
    #[serde(default, rename = "followTags")]
    pub follow_tags: Option<bool>,
    // "" | "force" | "force-with-lease"
    pub force: Option<String>,
    #[serde(default, rename = "setUpstream")]
    pub set_upstream: Option<bool>,
    #[serde(default)]
    pub auth: Option<GitAuthInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub success: bool,
    pub pushed: Vec<serde_json::Value>,
    pub repo: String,
    #[serde(rename = "ref")]
    pub r#ref: serde_json::Value,
}

fn git_output_suggests_no_upstream(stdout: &str, stderr: &str) -> bool {
    let combined = format!("{}\n{}", stdout, stderr).to_ascii_lowercase();
    combined.contains("has no upstream branch")
        || combined.contains("set the remote as upstream")
        || combined.contains("no upstream configured")
        || combined.contains("set upstream")
}

fn parse_local_branch_from_refspec(spec: &str) -> Option<String> {
    let mut local = spec.trim();
    if local.is_empty() {
        return None;
    }
    if let Some(stripped) = local.strip_prefix('+') {
        local = stripped.trim();
    }
    if let Some((left, _right)) = local.split_once(':') {
        local = left.trim();
    }
    if local.is_empty() || local == "HEAD" {
        return None;
    }
    if let Some(name) = local.strip_prefix("refs/heads/") {
        local = name.trim();
    }
    if local.starts_with("refs/") || local.contains('*') || local.contains(' ') {
        return None;
    }
    Some(local.to_string())
}

pub async fn git_push(
    State(state): State<Arc<crate::AppState>>,
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitPushBody>,
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
    let tags = body.tags.unwrap_or(false);
    let follow_tags = body.follow_tags.unwrap_or(false);
    let force = body
        .force
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    if (force == "force" || force == "force-with-lease") && !git_allow_force_push(&state).await {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Force push is disabled by policy",
                "code": "git_force_push_not_allowed",
                "hint": "Enable gitAllowForcePush in settings to allow force push operations.",
            })),
        )
            .into_response();
    }

    let set_upstream = body.set_upstream.unwrap_or(false);

    // Guard protected branches when policy requires creating a new branch.
    // This complements the client-side prompt and protects direct API usage.
    let branch_for_policy = if tags && !follow_tags && branch.is_none() && rf.is_none() {
        None
    } else {
        let from_spec = rf.or(branch).and_then(parse_local_branch_from_refspec);
        if from_spec.is_some() {
            from_spec
        } else {
            git_current_branch(&dir).await
        }
    };
    if git_enforce_branch_protection(&state).await {
        if let Some(branch_name) = branch_for_policy
            && let Some(prompt_mode) = git_branch_protection_for_branch(&state, &branch_name).await
            && prompt_mode == GitBranchProtectionPrompt::AlwaysCommitToNewBranch
        {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "error": format!("Branch '{branch_name}' is protected; push from a new branch instead."),
                    "code": "git_branch_protected",
                    "branch": branch_name,
                    "promptMode": prompt_mode.as_str(),
                    "category": "policy",
                    "hint": "Create and push a feature branch, or change gitBranchProtectionPrompt in settings.",
                })),
            )
                .into_response();
        }
    }

    let mut auth_opts: Vec<String> = Vec::new();
    let mut extra_env: Vec<(String, String)> = Vec::new();
    let mut _askpass: Option<TempGitAskpass> = None;
    if let Some((u, p)) = body.auth.as_ref().and_then(normalize_http_auth) {
        match git_http_auth_env(&u, &p).await {
            Ok((prefix, env, guard)) => {
                auth_opts = prefix;
                extra_env = env;
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

    if (branch.is_some() || rf.is_some()) && remote.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "remote is required when branch is provided"})),
        )
            .into_response();
    }

    // If caller explicitly asked for -u, we require both remote + branch unless we can infer branch.
    if set_upstream && remote.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "remote is required when setUpstream is true"})),
        )
            .into_response();
    }

    let mut args: Vec<String> = Vec::new();
    if !auth_opts.is_empty() {
        args.extend(auth_opts.clone());
    }
    args.push("push".into());
    if force == "force" {
        args.push("--force".into());
    } else if force == "force-with-lease" {
        args.push("--force-with-lease".into());
    } else if !force.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid force mode", "code": "invalid_force"})),
        )
            .into_response();
    }
    if tags {
        args.push("--tags".into());
    }
    if follow_tags {
        args.push("--follow-tags".into());
    }
    if set_upstream {
        args.push("--set-upstream".into());
    }

    if let Some(r) = remote {
        args.push(r.into());
    }
    if let Some(spec) = rf.or(branch) {
        args.push(spec.into());
    } else if set_upstream {
        // Infer current branch for publish.
        let Some(cur) = git_current_branch(&dir).await else {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Cannot set upstream from a detached HEAD",
                    "code": "git_detached_head",
                })),
            )
                .into_response();
        };
        args.push(cur);
    }

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
        // If git suggests an upstream is missing, try publishing the current branch.
        if branch.is_none() && git_output_suggests_no_upstream(&out, &err) {
            let Some(cur) = git_current_branch(&dir).await else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": "Cannot push from a detached HEAD",
                        "code": "git_detached_head",
                        "hint": "Checkout a branch first, then retry push.",
                    })),
                )
                    .into_response();
            };

            let publish_remote = remote.unwrap_or("origin");
            let mut args2: Vec<String> = Vec::new();
            if !auth_opts.is_empty() {
                args2.extend(auth_opts.clone());
            }
            args2.extend([
                "push".to_string(),
                "--set-upstream".to_string(),
                publish_remote.to_string(),
                cur.to_string(),
            ]);
            let args2_ref: Vec<&str> = args2.iter().map(|s| s.as_str()).collect();
            let env2_ref: Vec<(&str, &str)> = extra_env
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();
            let (c2, o2, e2) = run_git_env(&dir, &args2_ref, &env2_ref).await.unwrap_or((
                1,
                "".to_string(),
                "".to_string(),
            ));
            if c2 != 0 {
                if let Some(resp) = map_git_failure(c2, &o2, &e2) {
                    return resp;
                }
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e2.trim()})),
                )
                    .into_response();
            }

            return Json(GitPushResult {
                success: true,
                pushed: vec![],
                repo: publish_remote.to_string(),
                r#ref: serde_json::Value::Null,
            })
            .into_response();
        }

        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim()})),
        )
            .into_response();
    }

    // If no args were given, the actual remote/refs are determined by git config.
    Json(GitPushResult {
        success: true,
        pushed: vec![],
        repo: remote.unwrap_or("").to_string(),
        r#ref: serde_json::Value::Null,
    })
    .into_response()
}
