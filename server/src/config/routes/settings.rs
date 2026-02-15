use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::Value;

use crate::settings;

use super::super::sanitize::{
    default_chat_activity_filters, default_chat_activity_tool_filters,
    normalize_chat_activity_filters, normalize_chat_activity_tool_filters,
};
use super::utils::{normalize_string_array, resolve_directory_path_no_fs};

const CHAT_ACTIVITY_DEFAULT_EXPANDED_ALLOWED: [&str; 9] = [
    "step-start",
    "step-finish",
    "snapshot",
    "patch",
    "agent",
    "retry",
    "compaction",
    "thinking",
    "justification",
];

fn normalize_chat_activity_default_expanded(v: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(arr)) = v else {
        return Vec::new();
    };

    let mut requested = HashSet::<String>::new();
    for item in arr {
        let Some(s) = item.as_str() else {
            continue;
        };
        let t = s.trim().to_ascii_lowercase();
        if t.is_empty() {
            continue;
        }
        requested.insert(t);
    }

    let mut out = Vec::new();
    for allowed in CHAT_ACTIVITY_DEFAULT_EXPANDED_ALLOWED.iter() {
        if requested.contains(*allowed) {
            out.push((*allowed).to_string());
        }
    }
    out
}

fn sanitize_typography_sizes_partial(input: Option<&Value>) -> Option<Value> {
    let Some(Value::Object(obj)) = input else {
        return None;
    };
    let mut out = serde_json::Map::new();
    let assign = |out: &mut serde_json::Map<String, Value>,
                  obj: &serde_json::Map<String, Value>,
                  key: &str| {
        if let Some(Value::String(s)) = obj.get(key)
            && !s.is_empty()
        {
            out.insert(key.to_string(), Value::String(s.clone()));
        }
    };
    assign(&mut out, obj, "markdown");
    assign(&mut out, obj, "code");
    assign(&mut out, obj, "uiHeader");
    assign(&mut out, obj, "uiLabel");
    assign(&mut out, obj, "meta");
    assign(&mut out, obj, "micro");
    if out.is_empty() {
        None
    } else {
        Some(Value::Object(out))
    }
}

fn sanitize_skill_catalogs(input: Option<&Value>) -> Option<Value> {
    let Some(Value::Array(arr)) = input else {
        return None;
    };
    let mut out: Vec<Value> = Vec::new();
    let mut seen = HashSet::<String>::new();
    for entry in arr {
        let Value::Object(obj) = entry else {
            continue;
        };
        let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
        let label = obj
            .get("label")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let source = obj
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let subpath = obj
            .get("subpath")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let git_identity_id = obj
            .get("gitIdentityId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if id.is_empty() || label.is_empty() || source.is_empty() {
            continue;
        }
        if !seen.insert(id.to_string()) {
            continue;
        }
        let mut next = serde_json::Map::new();
        next.insert("id".to_string(), Value::String(id.to_string()));
        next.insert("label".to_string(), Value::String(label.to_string()));
        next.insert("source".to_string(), Value::String(source.to_string()));
        if !subpath.is_empty() {
            next.insert("subpath".to_string(), Value::String(subpath.to_string()));
        }
        if !git_identity_id.is_empty() {
            next.insert(
                "gitIdentityId".to_string(),
                Value::String(git_identity_id.to_string()),
            );
        }
        out.push(Value::Object(next));
    }
    Some(Value::Array(out))
}

fn sanitize_projects(input: Option<&Value>) -> Option<Value> {
    let Some(Value::Array(arr)) = input else {
        return None;
    };

    let mut out: Vec<Value> = Vec::new();
    let mut seen_ids = HashSet::<String>::new();
    let mut seen_paths = HashSet::<String>::new();

    for entry in arr {
        let Value::Object(obj) = entry else {
            continue;
        };
        let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
        let raw_path = obj
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let Some(normalized_path) = resolve_directory_path_no_fs(raw_path) else {
            continue;
        };

        if id.is_empty() {
            continue;
        }
        if !seen_ids.insert(id.to_string()) {
            continue;
        }
        if !seen_paths.insert(normalized_path.clone()) {
            continue;
        }

        let label = obj
            .get("label")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let added_at = obj
            .get("addedAt")
            .and_then(|v| v.as_i64())
            .filter(|v| *v >= 0);
        let last_opened_at = obj
            .get("lastOpenedAt")
            .and_then(|v| v.as_i64())
            .filter(|v| *v >= 0);

        let mut project = serde_json::Map::new();
        project.insert("id".to_string(), Value::String(id.to_string()));
        project.insert(
            "path".to_string(),
            Value::String(normalized_path.to_string()),
        );
        if !label.is_empty() {
            project.insert("label".to_string(), Value::String(label.to_string()));
        }
        if let Some(v) = added_at {
            project.insert("addedAt".to_string(), Value::Number(v.into()));
        }
        if let Some(v) = last_opened_at {
            project.insert("lastOpenedAt".to_string(), Value::Number(v.into()));
        }

        // Preserve worktreeDefaults (only known keys).
        if let Some(Value::Object(wt)) = obj.get("worktreeDefaults") {
            let mut defaults = serde_json::Map::new();
            if let Some(Value::String(s)) = wt.get("branchPrefix") {
                let t = s.trim();
                if !t.is_empty() {
                    defaults.insert("branchPrefix".to_string(), Value::String(t.to_string()));
                }
            }
            if let Some(Value::String(s)) = wt.get("baseBranch") {
                let t = s.trim();
                if !t.is_empty() {
                    defaults.insert("baseBranch".to_string(), Value::String(t.to_string()));
                }
            }
            if let Some(Value::Bool(b)) = wt.get("autoCreateWorktree") {
                defaults.insert("autoCreateWorktree".to_string(), Value::Bool(*b));
            }
            if !defaults.is_empty() {
                project.insert("worktreeDefaults".to_string(), Value::Object(defaults));
            }
        }

        out.push(Value::Object(project));
    }

    Some(Value::Array(out))
}

fn project_entries_payload<'a>(obj: &'a serde_json::Map<String, Value>) -> Option<&'a Value> {
    if obj.get("directories").is_some() {
        obj.get("directories")
    } else {
        obj.get("projects")
    }
}

fn sanitize_settings_update(payload: &Value) -> Value {
    let Value::Object(obj) = payload else {
        return Value::Object(serde_json::Map::new());
    };

    let mut out = serde_json::Map::new();

    // Strings
    for key in [
        "themeId",
        "lightThemeId",
        "darkThemeId",
        "homeDirectory",
        "uiFont",
        "monoFont",
        "markdownDisplayMode",
    ] {
        if let Some(Value::String(s)) = obj.get(key)
            && !s.is_empty()
        {
            out.insert(key.to_string(), Value::String(s.clone()));
        }
    }

    // Enums
    if let Some(Value::String(v)) = obj.get("themeVariant") {
        let t = v.trim();
        if t == "light" || t == "dark" {
            out.insert("themeVariant".to_string(), Value::String(t.to_string()));
        }
    }
    if let Some(Value::String(v)) = obj.get("toolCallExpansion") {
        let t = v.trim();
        if t == "collapsed" || t == "activity" || t == "detailed" {
            out.insert(
                "toolCallExpansion".to_string(),
                Value::String(t.to_string()),
            );
        }
    }
    if let Some(Value::String(v)) = obj.get("diffLayoutPreference") {
        let t = v.trim();
        if t == "dynamic" || t == "inline" || t == "side-by-side" {
            out.insert(
                "diffLayoutPreference".to_string(),
                Value::String(t.to_string()),
            );
        }
    }
    if let Some(Value::String(v)) = obj.get("diffViewMode") {
        let t = v.trim();
        if t == "single" || t == "stacked" {
            out.insert("diffViewMode".to_string(), Value::String(t.to_string()));
        }
    }
    if let Some(Value::String(v)) = obj.get("gitBranchProtectionPrompt") {
        let t = v.trim();
        if t == "alwaysCommit" || t == "alwaysCommitToNewBranch" || t == "alwaysPrompt" {
            out.insert(
                "gitBranchProtectionPrompt".to_string(),
                Value::String(t.to_string()),
            );
        }
    }
    if let Some(Value::String(v)) = obj.get("gitPostCommitCommand") {
        let t = v.trim();
        if t == "none" || t == "push" || t == "sync" {
            out.insert(
                "gitPostCommitCommand".to_string(),
                Value::String(t.to_string()),
            );
        }
    }

    // Trimmed strings (allow empty -> omit)
    for key in [
        "githubClientId",
        "githubScopes",
        "defaultModel",
        "defaultVariant",
        "defaultAgent",
        "defaultGitIdentityId",
    ] {
        if let Some(Value::String(v)) = obj.get(key) {
            let t = v.trim();
            if !t.is_empty() {
                out.insert(key.to_string(), Value::String(t.to_string()));
            } else {
                out.insert(key.to_string(), Value::Null);
            }
        }
    }

    // Booleans
    for key in [
        "useSystemTheme",
        "showReasoningTraces",
        "showTextJustificationActivity",
        "showChatTimestamps",
        // Chat activity item UX (local UI preferences)
        "chatActivityAutoCollapseOnIdle",
        "autoDeleteEnabled",
        "queueModeEnabled",
        "autoCreateWorktree",
        "gitmojiEnabled",
        "gitAllowForcePush",
        "gitAllowNoVerifyCommit",
        "gitEnforceBranchProtection",
        "gitStrictPatchValidation",
        "directoryShowHidden",
        "filesViewShowGitignored",
    ] {
        if let Some(Value::Bool(b)) = obj.get(key) {
            out.insert(key.to_string(), Value::Bool(*b));
        }
    }

    // Numbers (bounded)
    let clamp_i64 = |v: i64, min: i64, max: i64| v.max(min).min(max);
    let set_bounded = |out: &mut serde_json::Map<String, Value>,
                       obj: &serde_json::Map<String, Value>,
                       key: &str,
                       min: i64,
                       max: i64| {
        if let Some(n) = obj.get(key).and_then(|v| v.as_i64()) {
            out.insert(
                key.to_string(),
                Value::Number(clamp_i64(n, min, max).into()),
            );
        }
    };
    set_bounded(&mut out, obj, "autoDeleteAfterDays", 1, 365);
    set_bounded(&mut out, obj, "fontSize", 50, 200);
    set_bounded(&mut out, obj, "padding", 50, 200);
    set_bounded(&mut out, obj, "cornerRadius", 0, 32);
    set_bounded(&mut out, obj, "inputBarOffset", 0, 100);
    set_bounded(&mut out, obj, "memoryLimitHistorical", 10, 500);
    set_bounded(&mut out, obj, "memoryLimitViewport", 20, 500);
    set_bounded(&mut out, obj, "memoryLimitActiveSession", 30, 1000);

    // Arrays
    if obj.get("approvedDirectories").is_some() {
        out.insert(
            "approvedDirectories".to_string(),
            Value::Array(
                normalize_string_array(obj.get("approvedDirectories"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }
    if obj.get("securityScopedBookmarks").is_some() {
        out.insert(
            "securityScopedBookmarks".to_string(),
            Value::Array(
                normalize_string_array(obj.get("securityScopedBookmarks"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }
    if obj.get("pinnedDirectories").is_some() {
        out.insert(
            "pinnedDirectories".to_string(),
            Value::Array(
                normalize_string_array(obj.get("pinnedDirectories"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }
    if obj.get("gitBranchProtection").is_some() {
        out.insert(
            "gitBranchProtection".to_string(),
            Value::Array(
                normalize_string_array(obj.get("gitBranchProtection"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }
    if obj.get("chatActivityFilters").is_some() {
        out.insert(
            "chatActivityFilters".to_string(),
            Value::Array(
                normalize_chat_activity_filters(obj.get("chatActivityFilters"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }
    if obj.get("chatActivityToolFilters").is_some() {
        out.insert(
            "chatActivityToolFilters".to_string(),
            Value::Array(
                normalize_chat_activity_tool_filters(obj.get("chatActivityToolFilters"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }
    if obj.get("chatActivityDefaultExpanded").is_some() {
        out.insert(
            "chatActivityDefaultExpanded".to_string(),
            Value::Array(
                normalize_chat_activity_default_expanded(obj.get("chatActivityDefaultExpanded"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }
    if obj.get("chatActivityDefaultExpandedToolFilters").is_some() {
        out.insert(
            "chatActivityDefaultExpandedToolFilters".to_string(),
            Value::Array(
                normalize_chat_activity_tool_filters(
                    obj.get("chatActivityDefaultExpandedToolFilters"),
                )
                .into_iter()
                .map(Value::String)
                .collect(),
            ),
        );
    }

    // Typography sizes
    if let Some(v) = sanitize_typography_sizes_partial(obj.get("typographySizes")) {
        out.insert("typographySizes".to_string(), v);
    }

    // Projects/directories alias: keep internal storage key as "projects".
    if let Some(projects) = sanitize_projects(project_entries_payload(obj)) {
        out.insert("projects".to_string(), projects);
    }

    // Skill catalogs
    if let Some(v) = sanitize_skill_catalogs(obj.get("skillCatalogs")) {
        out.insert("skillCatalogs".to_string(), v);
    }

    Value::Object(out)
}

fn merge_persisted_settings(current: &Value, changes: &Value) -> Value {
    let Value::Object(current_obj) = current else {
        return changes.clone();
    };
    let Value::Object(changes_obj) = changes else {
        return current.clone();
    };

    let mut next = current_obj.clone();
    for (k, v) in changes_obj {
        // Match JS behavior: setting a key to null clears it.
        if matches!(v, Value::Null) {
            next.remove(k);
        } else {
            next.insert(k.clone(), v.clone());
        }
    }

    let base_approved = if changes_obj.get("approvedDirectories").is_some() {
        normalize_string_array(changes_obj.get("approvedDirectories"))
    } else {
        normalize_string_array(current_obj.get("approvedDirectories"))
    };

    let mut additional = Vec::new();
    if let Some(Value::String(s)) = changes_obj.get("homeDirectory")
        && let Some(v) = resolve_directory_path_no_fs(s)
    {
        additional.push(v);
    }
    let project_entries = if changes_obj.get("projects").is_some() {
        changes_obj.get("projects")
    } else {
        current_obj.get("projects")
    };
    if let Some(Value::Array(arr)) = project_entries {
        for p in arr {
            if let Some(path) = p.get("path").and_then(|v| v.as_str())
                && let Some(v) = resolve_directory_path_no_fs(path)
            {
                additional.push(v);
            }
        }
    }

    let mut merged_approved = Vec::new();
    let mut seen = HashSet::<String>::new();
    for s in base_approved.into_iter().chain(additional.into_iter()) {
        if !s.is_empty() && seen.insert(s.clone()) {
            merged_approved.push(Value::String(s));
        }
    }
    next.insert(
        "approvedDirectories".to_string(),
        Value::Array(merged_approved),
    );

    let base_bookmarks = if changes_obj.get("securityScopedBookmarks").is_some() {
        normalize_string_array(changes_obj.get("securityScopedBookmarks"))
    } else {
        normalize_string_array(current_obj.get("securityScopedBookmarks"))
    };
    next.insert(
        "securityScopedBookmarks".to_string(),
        Value::Array(base_bookmarks.into_iter().map(Value::String).collect()),
    );

    // typographySizes deep merge
    let next_typography =
        if let Some(Value::Object(changes_typo)) = changes_obj.get("typographySizes") {
            let mut merged = current_obj
                .get("typographySizes")
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default();
            for (k, v) in changes_typo {
                merged.insert(k.clone(), v.clone());
            }
            Value::Object(merged)
        } else {
            current_obj
                .get("typographySizes")
                .cloned()
                .unwrap_or(Value::Null)
        };
    if !matches!(next_typography, Value::Null) {
        next.insert("typographySizes".to_string(), next_typography);
    }

    Value::Object(next)
}

pub(crate) fn format_settings_response(settings_value: &Value) -> Value {
    let sanitized = sanitize_settings_update(settings_value);
    let Value::Object(sanitized_obj) = sanitized else {
        return sanitized;
    };
    let mut out = sanitized_obj;

    // Compatibility alias: expose both keys while keeping persisted schema unchanged.
    if let Some(projects) = out.get("projects").cloned() {
        out.insert("directories".to_string(), projects);
    }

    let approved = normalize_string_array(settings_value.get("approvedDirectories"));
    let bookmarks = normalize_string_array(settings_value.get("securityScopedBookmarks"));

    out.insert(
        "approvedDirectories".to_string(),
        Value::Array(approved.into_iter().map(Value::String).collect()),
    );
    out.insert(
        "securityScopedBookmarks".to_string(),
        Value::Array(bookmarks.into_iter().map(Value::String).collect()),
    );
    let pinned = normalize_string_array(settings_value.get("pinnedDirectories"));
    out.insert(
        "pinnedDirectories".to_string(),
        Value::Array(pinned.into_iter().map(Value::String).collect()),
    );

    out.insert(
        "typographySizes".to_string(),
        sanitize_typography_sizes_partial(settings_value.get("typographySizes"))
            .unwrap_or(Value::Null),
    );

    let show_reasoning_traces = settings_value
        .get("showReasoningTraces")
        .and_then(|v| v.as_bool())
        .or_else(|| out.get("showReasoningTraces").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    out.insert(
        "showReasoningTraces".to_string(),
        Value::Bool(show_reasoning_traces),
    );

    let show_text_justification = settings_value
        .get("showTextJustificationActivity")
        .and_then(|v| v.as_bool())
        .or_else(|| {
            out.get("showTextJustificationActivity")
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(false);
    out.insert(
        "showTextJustificationActivity".to_string(),
        Value::Bool(show_text_justification),
    );

    let git_allow_force_push = settings_value
        .get("gitAllowForcePush")
        .and_then(|v| v.as_bool())
        .or_else(|| out.get("gitAllowForcePush").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    out.insert(
        "gitAllowForcePush".to_string(),
        Value::Bool(git_allow_force_push),
    );

    let git_allow_no_verify_commit = settings_value
        .get("gitAllowNoVerifyCommit")
        .and_then(|v| v.as_bool())
        .or_else(|| out.get("gitAllowNoVerifyCommit").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    out.insert(
        "gitAllowNoVerifyCommit".to_string(),
        Value::Bool(git_allow_no_verify_commit),
    );

    let git_enforce_branch_protection = settings_value
        .get("gitEnforceBranchProtection")
        .and_then(|v| v.as_bool())
        .or_else(|| {
            out.get("gitEnforceBranchProtection")
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(false);
    out.insert(
        "gitEnforceBranchProtection".to_string(),
        Value::Bool(git_enforce_branch_protection),
    );

    let git_strict_patch_validation = settings_value
        .get("gitStrictPatchValidation")
        .and_then(|v| v.as_bool())
        .or_else(|| {
            out.get("gitStrictPatchValidation")
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(false);
    out.insert(
        "gitStrictPatchValidation".to_string(),
        Value::Bool(git_strict_patch_validation),
    );

    let mut git_branch_protection_prompt = settings_value
        .get("gitBranchProtectionPrompt")
        .and_then(|v| v.as_str())
        .or_else(|| {
            out.get("gitBranchProtectionPrompt")
                .and_then(|v| v.as_str())
        })
        .unwrap_or("alwaysPrompt")
        .trim()
        .to_string();
    if git_branch_protection_prompt != "alwaysCommit"
        && git_branch_protection_prompt != "alwaysCommitToNewBranch"
        && git_branch_protection_prompt != "alwaysPrompt"
    {
        git_branch_protection_prompt = "alwaysPrompt".to_string();
    }
    out.insert(
        "gitBranchProtectionPrompt".to_string(),
        Value::String(git_branch_protection_prompt),
    );

    let git_branch_protection = normalize_string_array(settings_value.get("gitBranchProtection"));
    out.insert(
        "gitBranchProtection".to_string(),
        Value::Array(
            git_branch_protection
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );

    let mut git_post_commit_command = settings_value
        .get("gitPostCommitCommand")
        .and_then(|v| v.as_str())
        .or_else(|| out.get("gitPostCommitCommand").and_then(|v| v.as_str()))
        .unwrap_or("none")
        .trim()
        .to_string();
    if git_post_commit_command != "none"
        && git_post_commit_command != "push"
        && git_post_commit_command != "sync"
    {
        git_post_commit_command = "none".to_string();
    }
    out.insert(
        "gitPostCommitCommand".to_string(),
        Value::String(git_post_commit_command),
    );

    let show_chat_timestamps = settings_value
        .get("showChatTimestamps")
        .and_then(|v| v.as_bool())
        .or_else(|| out.get("showChatTimestamps").and_then(|v| v.as_bool()))
        .unwrap_or(true);
    out.insert(
        "showChatTimestamps".to_string(),
        Value::Bool(show_chat_timestamps),
    );

    // Chat activity item UX defaults
    let activity_auto_collapse_on_idle = settings_value
        .get("chatActivityAutoCollapseOnIdle")
        .and_then(|v| v.as_bool())
        .or_else(|| {
            out.get("chatActivityAutoCollapseOnIdle")
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(true);
    out.insert(
        "chatActivityAutoCollapseOnIdle".to_string(),
        Value::Bool(activity_auto_collapse_on_idle),
    );

    let chat_activity_filters = if settings_value.get("chatActivityFilters").is_some() {
        normalize_chat_activity_filters(settings_value.get("chatActivityFilters"))
    } else {
        default_chat_activity_filters()
    };
    out.insert(
        "chatActivityFilters".to_string(),
        Value::Array(
            chat_activity_filters
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );

    let chat_activity_tool_filters = if settings_value.get("chatActivityToolFilters").is_some() {
        normalize_chat_activity_tool_filters(settings_value.get("chatActivityToolFilters"))
    } else {
        default_chat_activity_tool_filters()
    };
    out.insert(
        "chatActivityToolFilters".to_string(),
        Value::Array(
            chat_activity_tool_filters
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );

    if settings_value
        .get("chatActivityDefaultExpandedToolFilters")
        .is_some()
    {
        out.insert(
            "chatActivityDefaultExpandedToolFilters".to_string(),
            Value::Array(
                normalize_chat_activity_tool_filters(
                    settings_value.get("chatActivityDefaultExpandedToolFilters"),
                )
                .into_iter()
                .map(Value::String)
                .collect(),
            ),
        );
    }

    Value::Object(out)
}

async fn validate_project_entries(projects: &[settings::Project]) -> Vec<settings::Project> {
    let mut out = Vec::new();
    for p in projects {
        if p.path.trim().is_empty() {
            continue;
        }
        match tokio::fs::metadata(&p.path).await {
            Ok(meta) => {
                if meta.is_dir() {
                    out.push(p.clone());
                }
            }
            Err(err) => {
                if err.kind() == std::io::ErrorKind::NotFound {
                    continue;
                }
                // Keep project on transient errors.
                out.push(p.clone());
            }
        }
    }
    out
}

pub async fn config_settings_get(State(state): State<Arc<crate::AppState>>) -> Response {
    let current = state.settings.read().await.clone();
    let value = serde_json::to_value(&current).unwrap_or(serde_json::json!({}));
    Json(format_settings_response(&value)).into_response()
}

pub async fn config_settings_put(
    State(state): State<Arc<crate::AppState>>,
    Json(body): Json<Value>,
) -> Response {
    // Serialize through the settings write lock.
    let mut guard = state.settings.write().await;
    let current_value = serde_json::to_value(&*guard).unwrap_or(serde_json::json!({}));
    let sanitized = sanitize_settings_update(&body);
    let merged = merge_persisted_settings(&current_value, &sanitized);

    let mut next_settings =
        serde_json::from_value::<settings::Settings>(merged.clone()).unwrap_or_default();

    // Validate projects.
    if !next_settings.projects.is_empty() {
        next_settings.projects = validate_project_entries(&next_settings.projects).await;
    }

    // Persist.
    *guard = next_settings.clone();
    if let Err(err) = settings::persist_settings(&state.settings_path, &next_settings).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.to_string()})),
        )
            .into_response();
    }

    let out = serde_json::to_value(&next_settings).unwrap_or(serde_json::json!({}));
    let formatted = format_settings_response(&out);
    // Notify connected frontends so they can refresh derived state (projects list, labels, etc.).
    crate::settings_events::publish_settings_replace(formatted.clone()).await;
    Json(formatted).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_settings_response_includes_chat_defaults() {
        let input = serde_json::json!({
            "projects": [],
        });
        let out = format_settings_response(&input);
        let obj = out.as_object().expect("settings object");

        assert_eq!(
            obj.get("showChatTimestamps").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            obj.get("showReasoningTraces").and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            obj.get("showTextJustificationActivity")
                .and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            obj.get("gitAllowForcePush").and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            obj.get("gitAllowNoVerifyCommit").and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            obj.get("gitEnforceBranchProtection")
                .and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            obj.get("gitStrictPatchValidation")
                .and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            obj.get("gitBranchProtectionPrompt")
                .and_then(|v| v.as_str()),
            Some("alwaysPrompt")
        );
        assert_eq!(
            obj.get("gitBranchProtection")
                .and_then(|v| v.as_array())
                .map(|v| v.is_empty()),
            Some(true)
        );
        assert_eq!(
            obj.get("gitPostCommitCommand").and_then(|v| v.as_str()),
            Some("none")
        );
        assert!(obj.get("chatActivityItemsDefaultExpanded").is_none());
        assert_eq!(
            obj.get("chatActivityAutoCollapseOnIdle")
                .and_then(|v| v.as_bool()),
            Some(true)
        );
        let default_filters = default_chat_activity_filters();
        let stored_filters = obj
            .get("chatActivityFilters")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        assert_eq!(stored_filters, default_filters);
        let default_tool_filters = default_chat_activity_tool_filters();
        let stored_tool_filters = obj
            .get("chatActivityToolFilters")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        assert_eq!(stored_tool_filters, default_tool_filters);

        let projects = obj
            .get("projects")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let directories = obj
            .get("directories")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert_eq!(directories, projects);
    }

    #[test]
    fn sanitize_settings_update_accepts_directories_alias() {
        let input = serde_json::json!({
            "directories": [
                {
                    "id": "dir_1",
                    "path": "/tmp/workspace"
                }
            ]
        });
        let out = sanitize_settings_update(&input);
        let obj = out.as_object().expect("sanitized object");
        let projects = obj
            .get("projects")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert_eq!(projects.len(), 1);
        assert_eq!(
            projects[0].get("id").and_then(|v| v.as_str()),
            Some("dir_1")
        );
    }

    #[test]
    fn sanitize_settings_update_prefers_directories_over_projects_when_both_present() {
        let input = serde_json::json!({
            "projects": [
                {
                    "id": "project_key",
                    "path": "/tmp/a"
                }
            ],
            "directories": [
                {
                    "id": "directories_key",
                    "path": "/tmp/b"
                }
            ]
        });
        let out = sanitize_settings_update(&input);
        let obj = out.as_object().expect("sanitized object");
        let projects = obj
            .get("projects")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert_eq!(projects.len(), 1);
        assert_eq!(
            projects[0].get("id").and_then(|v| v.as_str()),
            Some("directories_key")
        );
    }

    #[test]
    fn sanitize_settings_update_accepts_show_chat_timestamps() {
        let input = serde_json::json!({
            "showChatTimestamps": false,
        });
        let out = sanitize_settings_update(&input);
        let obj = out.as_object().expect("sanitized object");
        assert_eq!(
            obj.get("showChatTimestamps").and_then(|v| v.as_bool()),
            Some(false)
        );
    }

    #[test]
    fn sanitize_settings_update_accepts_chat_activity_item_prefs() {
        let input = serde_json::json!({
            "chatActivityAutoCollapseOnIdle": false,
        });
        let out = sanitize_settings_update(&input);
        let obj = out.as_object().expect("sanitized object");
        assert_eq!(
            obj.get("chatActivityAutoCollapseOnIdle")
                .and_then(|v| v.as_bool()),
            Some(false)
        );
    }

    #[test]
    fn sanitize_settings_update_accepts_chat_activity_default_expanded() {
        let input = serde_json::json!({
            "chatActivityDefaultExpanded": ["justification", "tool", "invalid", "thinking", "TOOL"],
        });
        let out = sanitize_settings_update(&input);
        let obj = out.as_object().expect("sanitized object");
        let expanded = obj
            .get("chatActivityDefaultExpanded")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        assert_eq!(
            expanded,
            vec!["thinking".to_string(), "justification".to_string()]
        );
    }

    #[test]
    fn sanitize_settings_update_accepts_chat_activity_default_expanded_tool_filters() {
        let input = serde_json::json!({
            "chatActivityDefaultExpandedToolFilters": ["read", "bash", "invalid", "unknown", "READ"],
        });
        let out = sanitize_settings_update(&input);
        let obj = out.as_object().expect("sanitized object");
        let filters = obj
            .get("chatActivityDefaultExpandedToolFilters")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        assert_eq!(
            filters,
            vec![
                "read".to_string(),
                "bash".to_string(),
                "unknown".to_string()
            ]
        );
    }

    #[test]
    fn sanitize_settings_update_accepts_chat_activity_filters() {
        let input = serde_json::json!({
            "chatActivityFilters": ["tool", "patch", "unknown"],
        });
        let out = sanitize_settings_update(&input);
        let obj = out.as_object().expect("sanitized object");
        let filters = obj
            .get("chatActivityFilters")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        assert_eq!(filters, vec!["tool".to_string(), "patch".to_string()]);
    }

    #[test]
    fn sanitize_settings_update_accepts_chat_activity_tool_filters() {
        let input = serde_json::json!({
            "chatActivityToolFilters": ["read", "bash", "custom_tool"],
        });
        let out = sanitize_settings_update(&input);
        let obj = out.as_object().expect("sanitized object");
        let filters = obj
            .get("chatActivityToolFilters")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        assert_eq!(
            filters,
            vec![
                "read".to_string(),
                "bash".to_string(),
                "custom_tool".to_string()
            ]
        );
    }

    #[test]
    fn sanitize_settings_update_maps_invalid_tool_filter_to_unknown() {
        let input = serde_json::json!({
            "chatActivityToolFilters": ["read", "invalid", "custom_tool", "UNKNOWN"],
        });
        let out = sanitize_settings_update(&input);
        let obj = out.as_object().expect("sanitized object");
        let filters = obj
            .get("chatActivityToolFilters")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        assert_eq!(
            filters,
            vec![
                "read".to_string(),
                "unknown".to_string(),
                "custom_tool".to_string()
            ]
        );
    }

    #[test]
    fn sanitize_settings_update_accepts_git_policy_values() {
        let input = serde_json::json!({
            "gitAllowForcePush": true,
            "gitAllowNoVerifyCommit": true,
            "gitEnforceBranchProtection": true,
            "gitStrictPatchValidation": true,
            "gitBranchProtectionPrompt": "alwaysCommitToNewBranch",
            "gitBranchProtection": ["main", "release/*", "", "main"],
            "gitPostCommitCommand": "sync",
        });

        let out = sanitize_settings_update(&input);
        let obj = out.as_object().expect("sanitized object");

        assert_eq!(
            obj.get("gitAllowForcePush").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            obj.get("gitAllowNoVerifyCommit").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            obj.get("gitEnforceBranchProtection")
                .and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            obj.get("gitStrictPatchValidation")
                .and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            obj.get("gitBranchProtectionPrompt")
                .and_then(|v| v.as_str()),
            Some("alwaysCommitToNewBranch")
        );
        assert_eq!(
            obj.get("gitPostCommitCommand").and_then(|v| v.as_str()),
            Some("sync")
        );

        let rules = obj
            .get("gitBranchProtection")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        assert_eq!(rules, vec!["main".to_string(), "release/*".to_string()]);
    }

    #[test]
    fn format_settings_response_includes_non_empty_directories_alias() {
        let input = serde_json::json!({
            "projects": [
                {
                    "id": "dir_1",
                    "path": "/tmp/workspace"
                }
            ]
        });
        let out = format_settings_response(&input);
        let obj = out.as_object().expect("settings object");
        let projects = obj
            .get("projects")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let directories = obj
            .get("directories")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert_eq!(projects.len(), 1);
        assert_eq!(directories, projects);
    }

    #[test]
    fn format_settings_response_round_trips_activity_detail_transport_prefs() {
        let input = serde_json::json!({
            "projects": [],
            "chatActivityDefaultExpanded": ["justification", "tool", "invalid"],
            "chatActivityDefaultExpandedToolFilters": ["read", "bash", "invalid", "READ"],
        });
        let out = format_settings_response(&input);
        let obj = out.as_object().expect("settings object");

        let expanded = obj
            .get("chatActivityDefaultExpanded")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        assert_eq!(expanded, vec!["justification".to_string()]);

        let tool_filters = obj
            .get("chatActivityDefaultExpandedToolFilters")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        assert_eq!(
            tool_filters,
            vec![
                "read".to_string(),
                "bash".to_string(),
                "unknown".to_string()
            ]
        );
    }
}
