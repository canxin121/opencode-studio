use std::path::Component;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use tokio::process::Command;

use crate::git2_utils;

#[derive(Debug, Clone, Copy)]
pub(crate) struct GitFailureTelemetry {
    pub code: &'static str,
    pub category: &'static str,
    pub retryable: bool,
}

pub(crate) fn truncate_for_payload(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.len() <= max {
        return t.to_string();
    }
    format!("{}\n...(truncated)", &t[..max])
}

pub(crate) fn redact_git_output(s: &str) -> String {
    // Best-effort redaction for URLs that embed credentials, e.g.
    // https://user:token@github.com/org/repo.git
    let mut out = s.to_string();
    let mut search_from = 0usize;
    while let Some(proto_idx) = out[search_from..].find("://") {
        let proto_idx = search_from + proto_idx;
        let after = proto_idx + 3;
        let rest = &out[after..];
        let at_rel = rest.find('@');
        let end_rel = rest.find(|c: char| c.is_whitespace()).unwrap_or(rest.len());
        if let Some(at_rel) = at_rel
            && at_rel < end_rel
        {
            let start = after;
            let end = after + at_rel;
            out.replace_range(start..end, "***");
            // Continue after the '@' to avoid reprocessing.
            search_from = (after + at_rel + 1).min(out.len());
        } else {
            search_from = (after + end_rel).min(out.len());
        }
    }
    out
}

fn is_not_git_repo(stderr: &str, stdout: &str) -> bool {
    let combined = format!("{}\n{}", stdout, stderr).to_ascii_lowercase();
    combined.contains("not a git repository")
        || combined.contains("must be run in a work tree")
        || combined.contains("this operation must be run in a work tree")
}

fn extract_dubious_repo_path(stderr: &str, stdout: &str) -> Option<String> {
    let combined = format!("{}\n{}", stdout, stderr);
    let marker = "detected dubious ownership in repository at '";
    let start = combined.find(marker)? + marker.len();
    let rest = &combined[start..];
    let end = rest.find('\'')?;
    let path = rest[..end].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

pub(crate) fn git_not_repo_response() -> Response {
    (
        StatusCode::CONFLICT,
        Json(serde_json::json!({
            "error": "Not a git repository",
            "code": "not_git_repo"
        })),
    )
        .into_response()
}

pub(crate) fn git2_open_error_response(e: git2_utils::Git2OpenError) -> Response {
    match e {
        git2_utils::Git2OpenError::NotARepository => git_not_repo_response(),
        other => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": other.message(), "code": other.code()})),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod git2_error_tests {
    use super::*;

    #[test]
    fn maps_not_repo_to_conflict() {
        let resp = git2_open_error_response(git2_utils::Git2OpenError::NotARepository);
        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }
}

pub(crate) fn map_git_failure(code: i32, stdout: &str, stderr: &str) -> Option<Response> {
    if code == 0 {
        return None;
    }
    if is_not_git_repo(stderr, stdout) {
        return Some(git_not_repo_response());
    }

    let out = redact_git_output(&truncate_for_payload(stdout, 16_000));
    let err = redact_git_output(&truncate_for_payload(stderr, 16_000));
    let combined = format!("{}\n{}", out, err).to_ascii_lowercase();

    let mut status = StatusCode::INTERNAL_SERVER_ERROR;
    let mut kind = "git_failed";
    let mut msg = if !err.is_empty() {
        err.clone()
    } else if !out.is_empty() {
        out.clone()
    } else {
        "Git command failed".to_string()
    };
    let mut hint: Option<&'static str> = None;
    let mut unsafe_path: Option<String> = None;
    let mut category = "unknown";
    let mut retryable = false;

    if code == 124 {
        status = StatusCode::REQUEST_TIMEOUT;
        kind = "git_timeout";
        msg = "Git command timed out".to_string();
        category = "timeout";
        retryable = true;
        hint = Some(
            "If this needs a password/passphrase prompt, use the interactive Git terminal modal.",
        );
    }

    // Common UX-focused classifications.
    if combined.contains("nothing to commit") {
        status = StatusCode::BAD_REQUEST;
        kind = "nothing_to_commit";
        msg = "Nothing to commit".to_string();
        category = "validation";
    } else if combined.contains("patch failed")
        || combined.contains("patch does not apply")
        || combined.contains("failed to apply")
    {
        status = StatusCode::CONFLICT;
        kind = "git_patch_conflict";
        msg = "Patch does not apply cleanly".to_string();
        category = "conflict";
        hint = Some("Refresh the diff and retry, or stage/discard the file directly.");
    } else if combined.contains("corrupt patch")
        || combined.contains("malformed patch")
        || combined.contains("unrecognized input") && combined.contains("patch")
    {
        status = StatusCode::BAD_REQUEST;
        kind = "git_patch_invalid";
        msg = "Patch format is invalid".to_string();
        category = "validation";
        hint = Some("Regenerate the patch from the current diff and retry.");
    } else if combined.contains("another git process seems to be running")
        || combined.contains("index.lock")
        || combined.contains("unable to create '") && combined.contains(".lock")
    {
        status = StatusCode::CONFLICT;
        kind = "git_lock";
        msg = "Repository is locked by another git process".to_string();
        category = "conflict";
        retryable = true;
        hint =
            Some("Close other git clients/IDEs and retry. If it persists, remove .git/index.lock.");
    } else if combined.contains("merge_head")
        || combined.contains("you have not concluded your merge")
        || combined.contains("merging is not possible")
        || combined.contains("unmerged files")
    {
        status = StatusCode::CONFLICT;
        kind = "merge_in_progress";
        msg = "Merge in progress / conflicts present".to_string();
        category = "conflict";
        hint = Some("Resolve conflicts and commit, or abort the merge in a terminal.");
    } else if combined.contains("waiting for your editor to close")
        || combined.contains("terminal is dumb")
        || (combined.contains("error") && combined.contains("editor"))
        || combined.contains("could not launch editor")
        || combined.contains("please supply the message")
    {
        status = StatusCode::BAD_REQUEST;
        kind = "git_interactive_required";
        msg = "This operation requires an interactive editor/terminal".to_string();
        category = "interactive";
        hint = Some(
            "Use the Terminal action to complete this operation (e.g. to edit a commit message). You can also configure GIT_EDITOR globally.",
        );
    } else if combined.contains("hook")
        && (combined.contains("pre-commit")
            || combined.contains("commit-msg")
            || combined.contains("prepare-commit-msg")
            || combined.contains("post-commit")
            || combined.contains("pre-push"))
        && (combined.contains("failed")
            || combined.contains("exit code")
            || combined.contains("returned")
            || combined.contains("hook declined")
            || combined.contains("aborted"))
    {
        status = StatusCode::BAD_REQUEST;
        kind = "git_hook_failed";
        msg = "Git hook failed".to_string();
        category = "validation";
        hint = Some(
            "Check hook output in the UI, fix the issue, then retry. You can also run the commit in the Terminal.",
        );
    } else if (combined.contains("ssh-keygen") && combined.contains("enter passphrase"))
        || (combined.contains("load key") && combined.contains("enter passphrase"))
        || combined.contains("signing failed: agent refused operation")
        || (combined.contains("error")
            && combined.contains("signing")
            && combined.contains("key")
            && combined.contains("passphrase"))
    {
        status = StatusCode::BAD_REQUEST;
        kind = "git_signing_interactive_required";
        msg = "Commit signing requires interactive authentication".to_string();
        category = "interactive";
        hint = Some(
            "Use the Terminal to enter your key passphrase, or configure ssh-agent/gpg-agent so signing can proceed non-interactively.",
        );
    } else if combined.contains("gpg failed to sign the data")
        || combined.contains("error: gpg failed to sign")
        || (combined.contains("signing") && combined.contains("failed"))
    {
        status = StatusCode::BAD_REQUEST;
        kind = "gpg_sign_failed";
        msg = "GPG signing failed".to_string();
        category = "auth";
        hint = Some("Enter your GPG key passphrase in the UI and retry the commit.");
    } else if combined.contains("no pinentry")
        || combined.contains("pinentry") && combined.contains("not found")
        || combined.contains("inappropriate ioctl for device")
    {
        status = StatusCode::BAD_REQUEST;
        kind = "gpg_pinentry";
        msg = "GPG pinentry is unavailable in server mode".to_string();
        category = "interactive";
        hint = Some(
            "Enter your GPG key passphrase in the UI so the server can preset it into gpg-agent.",
        );
    } else if combined.contains("no secret key") {
        status = StatusCode::BAD_REQUEST;
        kind = "gpg_no_secret_key";
        msg = "GPG signing key not available".to_string();
        category = "auth";
        hint = Some("Configure user.signingkey and ensure the secret key exists on this machine.");
    } else if combined.contains("authentication failed")
        || combined.contains("http basic: access denied")
        || combined.contains("could not read username")
        || combined.contains("could not read password")
        || combined.contains("terminal prompts disabled")
        || combined.contains("fatal: could not") && combined.contains("username")
        || combined.contains("fatal: could not") && combined.contains("password")
        || combined.contains("support for password authentication was removed")
        || (combined.contains("remote:") && combined.contains("password authentication"))
        || (combined.contains("remote:") && combined.contains("invalid username or password"))
        || (combined.contains("remote:") && combined.contains("two-factor"))
    {
        status = StatusCode::UNAUTHORIZED;
        kind = "git_auth_required";
        msg = "Authentication required".to_string();
        category = "auth";
        hint = Some(
            "Use SSH or a token (PAT) for HTTPS. For GitHub, enter a token as the password with username 'x-access-token'.",
        );
    } else if combined.contains("saml")
        || (combined.contains("sso") && combined.contains("organization"))
        || combined.contains("resource protected")
        || combined.contains("must authorize")
        || (combined.contains("remote:") && combined.contains("sso"))
    {
        status = StatusCode::FORBIDDEN;
        kind = "git_auth_sso_required";
        msg = "Additional authorization required (SSO)".to_string();
        category = "auth";
        hint = Some(
            "Your organization enforces SSO. Authorize your token in the browser or run the operation in a terminal after completing SSO.",
        );
    } else if combined.contains("permission denied (publickey") {
        status = StatusCode::UNAUTHORIZED;
        kind = "git_ssh_auth_failed";
        msg = "SSH authentication failed".to_string();
        category = "auth";
        hint = Some("Ensure your SSH key is loaded and the remote allows this key.");
    } else if combined.contains("could not resolve host")
        || combined.contains("failed to connect")
        || combined.contains("connection timed out")
        || combined.contains("network is unreachable")
        || combined.contains("name or service not known")
    {
        status = StatusCode::BAD_GATEWAY;
        kind = "git_network_error";
        msg = "Network error while contacting remote".to_string();
        category = "network";
        retryable = true;
        hint = Some(
            "Check your network/VPN/proxy and retry. If authentication uses SSO, you may need to run the operation in a terminal.",
        );
    } else if combined.contains("ssl certificate problem")
        || combined.contains("server certificate verification failed")
        || (combined.contains("certificate")
            && combined.contains("verify")
            && combined.contains("failed"))
    {
        status = StatusCode::BAD_GATEWAY;
        kind = "git_tls_error";
        msg = "TLS/SSL certificate error".to_string();
        category = "network";
        hint = Some("Verify your system certificate store or corporate proxy configuration.");
    } else if combined.contains("has no upstream branch")
        || combined.contains("set the remote as upstream")
        || combined.contains("no upstream configured")
        || (combined.contains("set-upstream") && combined.contains("fatal"))
    {
        status = StatusCode::BAD_REQUEST;
        kind = "git_no_upstream";
        msg = "No upstream branch configured".to_string();
        category = "validation";
        hint = Some("Publish the branch (push with -u) or set an upstream in a terminal.");
    } else if combined.contains("no such remote")
        || (combined.contains("does not appear to be a git repository")
            && combined.contains("fatal"))
        || combined.contains("could not find remote ref")
    {
        status = StatusCode::BAD_REQUEST;
        kind = "git_remote_not_found";
        msg = "Remote not found".to_string();
        category = "not_found";
        hint = Some(
            "Check that the remote exists (e.g. origin) and that the repository has remotes configured.",
        );
    } else if combined.contains("non-fast-forward")
        || (combined.contains("rejected") && combined.contains("fetch first"))
        || (combined.contains("rejected") && combined.contains("non-fast-forward"))
        || (combined.contains("failed to push") && combined.contains("updates were rejected"))
    {
        status = StatusCode::CONFLICT;
        kind = "git_push_rejected";
        msg = "Push rejected by remote".to_string();
        category = "conflict";
        hint = Some("Pull/rebase to incorporate remote changes, then retry push.");
    } else if combined.contains("repository not found") {
        status = StatusCode::NOT_FOUND;
        kind = "git_repo_not_found";
        msg = "Remote repository not found".to_string();
        category = "not_found";
    } else if combined.contains("detected dubious ownership in repository at")
        || (combined.contains("safe.directory") && combined.contains("git config --global"))
    {
        status = StatusCode::FORBIDDEN;
        kind = "git_unsafe_repository";
        msg = "Repository is not trusted on this machine".to_string();
        category = "safety";
        hint = Some(
            "Mark this repository as safe (git config --global --add safe.directory <path>) and retry.",
        );
        unsafe_path = extract_dubious_repo_path(stderr, stdout);
    }

    Some(
        (
            status,
            Json(serde_json::json!({
                "error": msg,
                "code": kind,
                "exitCode": code,
                "stdout": out,
                "stderr": err,
                "hint": hint,
                "path": unsafe_path,
                "category": category,
                "retryable": retryable,
            })),
        )
            .into_response(),
    )
}

pub(crate) fn classify_git_failure(
    code: i32,
    stdout: &str,
    stderr: &str,
) -> Option<GitFailureTelemetry> {
    if code == 0 {
        return None;
    }
    if is_not_git_repo(stderr, stdout) {
        return Some(GitFailureTelemetry {
            code: "not_git_repo",
            category: "not_found",
            retryable: false,
        });
    }

    let out = redact_git_output(&truncate_for_payload(stdout, 16_000));
    let err = redact_git_output(&truncate_for_payload(stderr, 16_000));
    let combined = format!("{}\n{}", out, err).to_ascii_lowercase();

    let mut telemetry = GitFailureTelemetry {
        code: "git_failed",
        category: "unknown",
        retryable: false,
    };

    if code == 124 {
        telemetry.code = "git_timeout";
        telemetry.category = "timeout";
        telemetry.retryable = true;
        return Some(telemetry);
    }

    if combined.contains("nothing to commit") {
        telemetry.code = "nothing_to_commit";
        telemetry.category = "validation";
    } else if combined.contains("patch failed")
        || combined.contains("patch does not apply")
        || combined.contains("failed to apply")
    {
        telemetry.code = "git_patch_conflict";
        telemetry.category = "conflict";
    } else if combined.contains("corrupt patch")
        || combined.contains("malformed patch")
        || combined.contains("unrecognized input") && combined.contains("patch")
    {
        telemetry.code = "git_patch_invalid";
        telemetry.category = "validation";
    } else if combined.contains("another git process seems to be running")
        || combined.contains("index.lock")
        || combined.contains("unable to create '") && combined.contains(".lock")
    {
        telemetry.code = "git_lock";
        telemetry.category = "conflict";
        telemetry.retryable = true;
    } else if combined.contains("merge_head")
        || combined.contains("you have not concluded your merge")
        || combined.contains("merging is not possible")
        || combined.contains("unmerged files")
    {
        telemetry.code = "merge_in_progress";
        telemetry.category = "conflict";
    } else if combined.contains("waiting for your editor to close")
        || combined.contains("terminal is dumb")
        || (combined.contains("error") && combined.contains("editor"))
        || combined.contains("could not launch editor")
        || combined.contains("please supply the message")
    {
        telemetry.code = "git_interactive_required";
        telemetry.category = "interactive";
    } else if combined.contains("hook")
        && (combined.contains("pre-commit")
            || combined.contains("commit-msg")
            || combined.contains("prepare-commit-msg")
            || combined.contains("post-commit")
            || combined.contains("pre-push"))
        && (combined.contains("failed")
            || combined.contains("exit code")
            || combined.contains("returned")
            || combined.contains("hook declined")
            || combined.contains("aborted"))
    {
        telemetry.code = "git_hook_failed";
        telemetry.category = "validation";
    } else if (combined.contains("ssh-keygen") && combined.contains("enter passphrase"))
        || (combined.contains("load key") && combined.contains("enter passphrase"))
        || combined.contains("signing failed: agent refused operation")
        || (combined.contains("error")
            && combined.contains("signing")
            && combined.contains("key")
            && combined.contains("passphrase"))
    {
        telemetry.code = "git_signing_interactive_required";
        telemetry.category = "interactive";
    } else if combined.contains("gpg failed to sign the data")
        || combined.contains("error: gpg failed to sign")
        || (combined.contains("signing") && combined.contains("failed"))
    {
        telemetry.code = "gpg_sign_failed";
        telemetry.category = "auth";
    } else if combined.contains("no pinentry")
        || combined.contains("pinentry") && combined.contains("not found")
        || combined.contains("inappropriate ioctl for device")
    {
        telemetry.code = "gpg_pinentry";
        telemetry.category = "interactive";
    } else if combined.contains("no secret key") {
        telemetry.code = "gpg_no_secret_key";
        telemetry.category = "auth";
    } else if combined.contains("authentication failed")
        || combined.contains("http basic: access denied")
        || combined.contains("could not read username")
        || combined.contains("could not read password")
        || combined.contains("terminal prompts disabled")
        || combined.contains("fatal: could not") && combined.contains("username")
        || combined.contains("fatal: could not") && combined.contains("password")
        || combined.contains("support for password authentication was removed")
        || (combined.contains("remote:") && combined.contains("password authentication"))
        || (combined.contains("remote:") && combined.contains("invalid username or password"))
        || (combined.contains("remote:") && combined.contains("two-factor"))
    {
        telemetry.code = "git_auth_required";
        telemetry.category = "auth";
    } else if combined.contains("saml")
        || (combined.contains("sso") && combined.contains("organization"))
        || combined.contains("resource protected")
        || combined.contains("must authorize")
        || (combined.contains("remote:") && combined.contains("sso"))
    {
        telemetry.code = "git_auth_sso_required";
        telemetry.category = "auth";
    } else if combined.contains("permission denied (publickey") {
        telemetry.code = "git_ssh_auth_failed";
        telemetry.category = "auth";
    } else if combined.contains("could not resolve host")
        || combined.contains("failed to connect")
        || combined.contains("connection timed out")
        || combined.contains("network is unreachable")
        || combined.contains("name or service not known")
    {
        telemetry.code = "git_network_error";
        telemetry.category = "network";
        telemetry.retryable = true;
    } else if combined.contains("ssl certificate problem")
        || combined.contains("server certificate verification failed")
        || (combined.contains("certificate")
            && combined.contains("verify")
            && combined.contains("failed"))
    {
        telemetry.code = "git_tls_error";
        telemetry.category = "network";
    } else if combined.contains("has no upstream branch")
        || combined.contains("set the remote as upstream")
        || combined.contains("no upstream configured")
        || (combined.contains("set-upstream") && combined.contains("fatal"))
    {
        telemetry.code = "git_no_upstream";
        telemetry.category = "validation";
    } else if combined.contains("no such remote")
        || (combined.contains("does not appear to be a git repository")
            && combined.contains("fatal"))
        || combined.contains("could not find remote ref")
    {
        telemetry.code = "git_remote_not_found";
        telemetry.category = "not_found";
    } else if combined.contains("non-fast-forward")
        || (combined.contains("rejected") && combined.contains("fetch first"))
        || (combined.contains("rejected") && combined.contains("non-fast-forward"))
        || (combined.contains("failed to push") && combined.contains("updates were rejected"))
    {
        telemetry.code = "git_push_rejected";
        telemetry.category = "conflict";
    } else if combined.contains("repository not found") {
        telemetry.code = "git_repo_not_found";
        telemetry.category = "not_found";
    } else if combined.contains("detected dubious ownership in repository at")
        || (combined.contains("safe.directory") && combined.contains("git config --global"))
    {
        telemetry.code = "git_unsafe_repository";
        telemetry.category = "safety";
    }

    Some(telemetry)
}

pub(crate) fn normalize_directory_path(value: &str) -> String {
    crate::path_utils::normalize_directory_path(value)
}

pub(crate) fn abs_path(value: &str) -> PathBuf {
    let p = PathBuf::from(normalize_directory_path(value));
    if p.is_absolute() {
        p
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(p)
    }
}

pub(crate) fn is_safe_repo_rel_path(p: &str) -> bool {
    let p = p.trim();
    if p.is_empty() {
        return false;
    }
    let path = Path::new(p);
    if path.is_absolute() {
        return false;
    }
    for c in path.components() {
        match c {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return false,
            _ => {}
        }
    }
    true
}

pub(crate) fn path_slash(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

pub(crate) fn rel_path_slash(base: &Path, child: &Path) -> String {
    if let Ok(r) = child.strip_prefix(base) {
        let s = path_slash(r);
        let trimmed = s.trim_matches('/');
        if trimmed.is_empty() {
            return ".".to_string();
        }
        return trimmed.to_string();
    }
    path_slash(child)
}

pub(crate) async fn git_config_get(
    directory: Option<&Path>,
    scope: &str,
    key: &str,
) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("config");
    cmd.arg(scope);
    cmd.arg("--get");
    cmd.arg(key);
    if let Some(dir) = directory {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());
    let out = cmd.output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.is_empty() { None } else { Some(v) }
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn normalize_directory_path_expands_home() {
        let old = std::env::var_os("HOME");
        // Modifying env vars is process-global; Rust marks it unsafe in newer toolchains.
        unsafe {
            std::env::set_var("HOME", "/tmp");
        }

        assert_eq!(normalize_directory_path("~"), "/tmp");
        assert_eq!(normalize_directory_path("~/x"), "/tmp/x");

        unsafe {
            if let Some(v) = old {
                std::env::set_var("HOME", v);
            } else {
                std::env::remove_var("HOME");
            }
        }
    }
}
