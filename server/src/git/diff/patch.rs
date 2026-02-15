use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::sync::Arc;

use super::super::{
    DirectoryQuery, abs_path, git_strict_patch_validation, is_safe_repo_rel_path, lock_repo,
    map_git_failure, require_directory, run_git, run_git_with_input,
};
use super::unified::{
    PatchSummary, parse_unified_diff_meta, patch_paths_are_safe, validate_unified_patch_hunks,
};

#[derive(Debug, Deserialize)]
pub struct GitDiffQuery {
    pub directory: Option<String>,
    pub path: Option<String>,
    pub staged: Option<String>,
    #[serde(rename = "contextLines")]
    pub context_lines: Option<String>,
    #[serde(rename = "includeMeta")]
    pub include_meta: Option<String>,
}

pub async fn git_diff(Query(q): Query<GitDiffQuery>) -> Response {
    let Some(dir_raw) = q.directory.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "directory parameter is required"})),
        )
            .into_response();
    };
    let dir = abs_path(dir_raw);
    let Some(path) = q
        .path
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "path parameter is required"})),
        )
            .into_response();
    };

    if !is_safe_repo_rel_path(path) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
        )
            .into_response();
    }

    let staged = q.staged.as_deref().map(|v| v == "true").unwrap_or(false);
    let context = q
        .context_lines
        .as_deref()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(3)
        .clamp(0, 500) as u32;

    // Use the git CLI for patch output so the result is a valid unified diff.
    // (libgit2's line callbacks do not include +/-/space prefixes in `content()`.)
    let mut untracked = false;
    if !staged {
        let (c, o, _e) = run_git(
            &dir,
            &["ls-files", "--others", "--exclude-standard", "--", path],
        )
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
        if c == 0 {
            let listed = o
                .lines()
                .map(|l| l.trim())
                .any(|l| !l.is_empty() && l == path);
            untracked = listed;
        }
    }

    let mut args: Vec<String> = Vec::new();
    args.push("diff".into());
    if staged {
        args.push("--cached".into());
    }
    args.push(format!("-U{}", context));
    if untracked {
        // `git diff` does not show content for untracked files; use --no-index to render
        // a patch against /dev/null.
        args.push("--no-index".into());
        args.push("--".into());
        args.push("/dev/null".into());
        args.push(path.to_string());
    } else {
        args.push("--".into());
        args.push(path.to_string());
    }
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let (code, out, err) =
        run_git(&dir, &args_ref)
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));

    // `git diff --no-index` returns 1 when differences exist. Treat that as success.
    let ok = if untracked {
        code == 0 || code == 1
    } else {
        code == 0
    };
    if !ok {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_diff_failed"})),
        )
            .into_response();
    }

    let include_meta = q
        .include_meta
        .as_deref()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false);

    if include_meta {
        let meta = parse_unified_diff_meta(&out);
        return Json(serde_json::json!({"diff": out, "meta": meta})).into_response();
    }

    Json(serde_json::json!({"diff": out})).into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitApplyPatchBody {
    pub patch: Option<String>,
    pub mode: Option<String>,
    // Optional granularity hint from the client: "file" | "hunk" | "selected"
    pub target: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PatchTarget {
    File,
    Hunk,
    Selected,
}

#[derive(Debug, Clone, Copy)]
struct PatchMode {
    cached: bool,
    reverse: bool,
    three_way: bool,
    default_target: Option<PatchTarget>,
    strict_hunk_validation: bool,
}

fn parse_patch_target(value: Option<&str>) -> Result<Option<PatchTarget>, &'static str> {
    let Some(raw) = value.map(|v| v.trim()).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let t = raw.to_ascii_lowercase();
    let parsed = match t.as_str() {
        "file" => PatchTarget::File,
        "hunk" => PatchTarget::Hunk,
        "selected" | "range" | "selection" => PatchTarget::Selected,
        _ => return Err("invalid_patch_target"),
    };
    Ok(Some(parsed))
}

fn parse_patch_mode(mode: &str) -> Option<PatchMode> {
    let normalized = mode.trim().to_ascii_lowercase().replace('_', "-");
    match normalized.as_str() {
        "stage" => Some(PatchMode {
            cached: true,
            reverse: false,
            three_way: false,
            default_target: None,
            strict_hunk_validation: true,
        }),
        "stage-hunk" => Some(PatchMode {
            cached: true,
            reverse: false,
            three_way: false,
            default_target: Some(PatchTarget::Hunk),
            strict_hunk_validation: true,
        }),
        "stage-selected" | "stage-selection" | "stage-range" => Some(PatchMode {
            cached: true,
            reverse: false,
            three_way: false,
            default_target: Some(PatchTarget::Selected),
            strict_hunk_validation: true,
        }),
        "unstage" => Some(PatchMode {
            cached: true,
            reverse: true,
            three_way: false,
            default_target: None,
            strict_hunk_validation: true,
        }),
        "unstage-hunk" => Some(PatchMode {
            cached: true,
            reverse: true,
            three_way: false,
            default_target: Some(PatchTarget::Hunk),
            strict_hunk_validation: true,
        }),
        "unstage-selected" | "unstage-selection" | "unstage-range" => Some(PatchMode {
            cached: true,
            reverse: true,
            three_way: false,
            default_target: Some(PatchTarget::Selected),
            strict_hunk_validation: true,
        }),
        "discard" => Some(PatchMode {
            cached: false,
            reverse: true,
            three_way: false,
            default_target: None,
            strict_hunk_validation: true,
        }),
        "discard-hunk" => Some(PatchMode {
            cached: false,
            reverse: true,
            three_way: false,
            default_target: Some(PatchTarget::Hunk),
            strict_hunk_validation: true,
        }),
        "discard-selected" | "discard-selection" | "discard-range" => Some(PatchMode {
            cached: false,
            reverse: true,
            three_way: false,
            default_target: Some(PatchTarget::Selected),
            strict_hunk_validation: true,
        }),
        "apply" => Some(PatchMode {
            cached: false,
            reverse: false,
            three_way: false,
            default_target: None,
            strict_hunk_validation: false,
        }),
        "apply-3way" | "apply-three-way" | "apply3way" => Some(PatchMode {
            cached: false,
            reverse: false,
            three_way: true,
            default_target: None,
            strict_hunk_validation: false,
        }),
        _ => None,
    }
}

fn invalid_patch_response(
    code: &'static str,
    error: &'static str,
    hint: Option<&'static str>,
) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": error,
            "code": code,
            "hint": hint,
            "category": "validation",
        })),
    )
        .into_response()
}

pub async fn git_apply_patch(
    State(state): State<Arc<crate::AppState>>,
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitApplyPatchBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let Some(raw) = body
        .patch
        .as_deref()
        .map(|s| s.trim_end())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "patch is required", "code": "missing_patch"})),
        )
            .into_response();
    };

    const MAX_PATCH_BYTES: usize = 1024 * 1024;
    if raw.len() > MAX_PATCH_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({"error": "Patch too large", "code": "patch_too_large"})),
        )
            .into_response();
    }

    if !patch_paths_are_safe(raw) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid patch paths", "code": "invalid_patch"})),
        )
            .into_response();
    }

    let mode_raw = body.mode.as_deref().unwrap_or("stage").trim().to_string();
    let Some(mode) = parse_patch_mode(&mode_raw) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid mode", "code": "invalid_mode"})),
        )
            .into_response();
    };

    let explicit_target = match parse_patch_target(body.target.as_deref()) {
        Ok(v) => v,
        Err(_) => {
            return invalid_patch_response(
                "invalid_patch_target",
                "Invalid patch target",
                Some("Use one of: file, hunk, selected."),
            );
        }
    };
    let target = if let Some(default_target) = mode.default_target {
        if let Some(explicit) = explicit_target
            && explicit != default_target
        {
            return invalid_patch_response(
                "patch_mode_target_mismatch",
                "Patch mode and target are inconsistent",
                Some("Use a matching mode/target pair (for example stage-selected + selected)."),
            );
        }
        default_target
    } else {
        explicit_target.unwrap_or(PatchTarget::File)
    };

    if mode.strict_hunk_validation && git_strict_patch_validation(&state).await {
        let summary = match validate_unified_patch_hunks(raw) {
            Ok(s) => s,
            Err("invalid_patch_hunk_counts") => {
                return invalid_patch_response(
                    "invalid_patch_hunk_counts",
                    "Patch hunk headers do not match patch content",
                    Some("Refresh the diff and retry; stale patches can fail after file changes."),
                );
            }
            Err("invalid_patch_hunk_line") => {
                return invalid_patch_response(
                    "invalid_patch_hunk_line",
                    "Patch contains invalid hunk lines",
                    Some("Only unified diff lines (+, -, and context) are allowed inside hunks."),
                );
            }
            Err(code) => {
                return invalid_patch_response(
                    code,
                    "Patch is not a valid unified diff",
                    Some("Generate the patch from the current diff and retry."),
                );
            }
        };

        if summary.files != 1 {
            return invalid_patch_response(
                "patch_requires_single_file",
                "Patch must target exactly one file",
                Some("Split multi-file patches into one request per file."),
            );
        }
        if matches!(target, PatchTarget::Hunk | PatchTarget::Selected) && summary.hunks != 1 {
            return invalid_patch_response(
                "patch_requires_single_hunk",
                "Patch must target exactly one hunk",
                Some("Split multi-hunk patches into separate requests."),
            );
        }
    }

    let mut args: Vec<&str> = vec!["apply", "--whitespace=nowarn"];
    if mode.cached {
        args.push("--cached");
    }
    if mode.reverse {
        args.push("--reverse");
    }
    if mode.three_way {
        args.push("--3way");
    }

    let patch = if raw.ends_with('\n') {
        raw.to_string()
    } else {
        format!("{}\n", raw)
    };

    let (code, out, err) = run_git_with_input(&dir, &args, &patch).await.unwrap_or((
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
            Json(serde_json::json!({"error": err.trim(), "code": "git_apply_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_PATCH: &str = "diff --git a/a.txt b/a.txt\nindex 1111111..2222222 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-old\n+new\n keep\n";

    #[test]
    fn validates_hunk_counts() {
        let summary = validate_unified_patch_hunks(SAMPLE_PATCH).expect("valid patch");
        assert_eq!(summary.files, 1);
        assert_eq!(summary.hunks, 1);
        assert_eq!(summary.changed_lines, 2);
    }

    #[test]
    fn rejects_bad_hunk_counts() {
        let bad = SAMPLE_PATCH.replace("@@ -1,2 +1,2 @@", "@@ -1,1 +1,1 @@");
        assert_eq!(
            validate_unified_patch_hunks(&bad).err(),
            Some("invalid_patch_hunk_counts")
        );
    }

    #[test]
    fn parses_selected_mode() {
        let m = parse_patch_mode("stage-selected").expect("mode");
        assert!(m.cached);
        assert!(!m.reverse);
        assert_eq!(m.default_target, Some(PatchTarget::Selected));
    }
}
