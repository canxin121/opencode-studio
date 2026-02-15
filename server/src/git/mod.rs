use std::path::PathBuf;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

mod auth;
mod blame;
mod branches;
mod commit;
mod diff;
mod exec;
mod gpg;
mod history;
mod ignore;
mod lfs;
mod ops;
mod policy;
mod remote;
mod repos;
mod status;
mod submodule;
mod utils;
mod worktrees;

#[cfg(test)]
mod regression_tests;

pub(crate) const MAX_BLOB_BYTES: usize = 50 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct DirectoryQuery {
    pub directory: Option<String>,
}

pub(crate) fn require_directory_raw(dir: Option<&str>) -> Result<PathBuf, Box<Response>> {
    let Some(dir) = dir.map(|s| s.trim()).filter(|s| !s.is_empty()) else {
        return Err(Box::new(
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "directory parameter is required",
                    "code": "missing_directory",
                })),
            )
                .into_response(),
        ));
    };
    Ok(abs_path(dir))
}

pub(crate) fn require_directory(q: &DirectoryQuery) -> Result<PathBuf, Box<Response>> {
    require_directory_raw(q.directory.as_deref())
}

// Shared helpers/types re-exported for submodules.
pub use auth::GitAuthInput;
pub(crate) use auth::{TempGitAskpass, git_http_auth_env, normalize_http_auth};
pub use blame::*;

pub(crate) use exec::{lock_repo, run_git, run_git_env, run_git_with_input};
pub(crate) use policy::{
    GitBranchProtectionPrompt, git_allow_force_push, git_allow_no_verify_commit,
    git_branch_protection_for_branch, git_enforce_branch_protection, git_strict_patch_validation,
};

pub(crate) use utils::{
    abs_path, git_config_get, git2_open_error_response, is_safe_repo_rel_path, map_git_failure,
    path_slash, redact_git_output, rel_path_slash, truncate_for_payload,
};

// Public HTTP handlers.
pub use branches::*;
pub use commit::*;
pub use diff::*;
pub use gpg::*;
pub use history::*;
pub use ignore::*;
pub use lfs::*;
pub use ops::*;
pub use remote::*;
pub use repos::*;
pub use status::*;
pub use submodule::*;
pub use worktrees::*;
