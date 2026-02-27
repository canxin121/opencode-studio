use std::sync::Arc;

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::Value;

use crate::settings;

mod merge;
mod response;
mod sanitize;

use merge::merge_persisted_settings;
pub(crate) use response::format_settings_response;
use sanitize::sanitize_settings_update;

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
    let mut guard = state.settings.write().await;
    let current_value = serde_json::to_value(&*guard).unwrap_or(serde_json::json!({}));
    let sanitized = sanitize_settings_update(&body);
    let merged = merge_persisted_settings(&current_value, &sanitized);

    let mut next_settings =
        serde_json::from_value::<settings::Settings>(merged.clone()).unwrap_or_default();

    if !next_settings.projects.is_empty() {
        next_settings.projects = validate_project_entries(&next_settings.projects).await;
    }

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
    crate::settings_events::publish_settings_replace(formatted.clone()).await;
    Json(formatted).into_response()
}

#[cfg(test)]
mod tests {
    use crate::config::{default_chat_activity_filters, default_chat_activity_tool_filters};

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
        assert_eq!(
            obj.get("updateAutoCheckEnabled").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            obj.get("updateAutoPromptEnabled").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            obj.get("updateAutoServiceInstallEnabled")
                .and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            obj.get("updateAutoInstallerInstallEnabled")
                .and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            obj.get("updateIgnoredReleaseTag"),
            Some(&serde_json::Value::Null)
        );
        assert_eq!(
            obj.get("updateReminderSnoozeUntil")
                .and_then(|v| v.as_i64()),
            Some(0)
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
