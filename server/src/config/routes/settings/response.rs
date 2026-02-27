use serde_json::Value;

use crate::config::{
    default_chat_activity_filters, default_chat_activity_tool_filters,
    normalize_chat_activity_filters, normalize_chat_activity_tool_filters,
};

use super::super::utils::normalize_string_array;
use super::sanitize::sanitize_settings_update;

pub(crate) fn format_settings_response(settings_value: &Value) -> Value {
    SettingsResponseBuilder::new(settings_value).build()
}

struct SettingsResponseBuilder<'a> {
    input: &'a Value,
    output: serde_json::Map<String, Value>,
}

impl<'a> SettingsResponseBuilder<'a> {
    fn new(input: &'a Value) -> Self {
        let sanitized = sanitize_settings_update(input);
        let Value::Object(output) = sanitized else {
            return Self {
                input,
                output: serde_json::Map::new(),
            };
        };

        Self { input, output }
    }

    fn build(mut self) -> Value {
        self.copy_projects_alias();
        self.set_normalized_directory_arrays();
        self.set_typography_sizes();

        self.set_bool_with_default("showReasoningTraces", false);
        self.set_bool_with_default("showTextJustificationActivity", false);
        self.set_bool_with_default("gitAllowForcePush", false);
        self.set_bool_with_default("gitAllowNoVerifyCommit", false);
        self.set_bool_with_default("gitEnforceBranchProtection", false);
        self.set_bool_with_default("gitStrictPatchValidation", false);
        self.set_bool_with_default("updateAutoCheckEnabled", true);
        self.set_bool_with_default("updateAutoPromptEnabled", true);
        self.set_bool_with_default("updateAutoServiceInstallEnabled", false);
        self.set_bool_with_default("updateAutoInstallerInstallEnabled", false);
        self.set_nullable_trimmed_string_with_default_null("updateIgnoredReleaseTag");
        self.set_nonnegative_i64_with_default("updateReminderSnoozeUntil", 0);
        self.set_bool_with_default("showChatTimestamps", true);
        self.set_bool_with_default("chatActivityAutoCollapseOnIdle", true);

        self.set_git_branch_protection_prompt();
        self.set_git_branch_protection();
        self.set_git_post_commit_command();
        self.set_chat_activity_filters();
        self.set_chat_activity_tool_filters();
        self.set_optional_default_expanded_tool_filters();

        Value::Object(self.output)
    }

    fn copy_projects_alias(&mut self) {
        if let Some(projects) = self.output.get("projects").cloned() {
            self.output.insert("directories".to_string(), projects);
        }
    }

    fn set_normalized_directory_arrays(&mut self) {
        self.output.insert(
            "approvedDirectories".to_string(),
            Value::Array(
                normalize_string_array(self.input.get("approvedDirectories"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
        self.output.insert(
            "securityScopedBookmarks".to_string(),
            Value::Array(
                normalize_string_array(self.input.get("securityScopedBookmarks"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
        self.output.insert(
            "pinnedDirectories".to_string(),
            Value::Array(
                normalize_string_array(self.input.get("pinnedDirectories"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }

    fn set_typography_sizes(&mut self) {
        self.output.insert(
            "typographySizes".to_string(),
            sanitize_typography_sizes_partial(self.input.get("typographySizes"))
                .unwrap_or(Value::Null),
        );
    }

    fn set_bool_with_default(&mut self, key: &str, default: bool) {
        let value = self
            .input
            .get(key)
            .and_then(|v| v.as_bool())
            .or_else(|| self.output.get(key).and_then(|v| v.as_bool()))
            .unwrap_or(default);
        self.output.insert(key.to_string(), Value::Bool(value));
    }

    fn set_nullable_trimmed_string_with_default_null(&mut self, key: &str) {
        let value = self
            .input
            .get(key)
            .and_then(|v| v.as_str())
            .or_else(|| self.output.get(key).and_then(|v| v.as_str()))
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToString::to_string);

        match value {
            Some(v) => {
                self.output.insert(key.to_string(), Value::String(v));
            }
            None => {
                self.output.insert(key.to_string(), Value::Null);
            }
        }
    }

    fn set_nonnegative_i64_with_default(&mut self, key: &str, default: i64) {
        let value = self
            .input
            .get(key)
            .and_then(|v| v.as_i64())
            .or_else(|| self.output.get(key).and_then(|v| v.as_i64()))
            .unwrap_or(default)
            .max(0);
        self.output
            .insert(key.to_string(), Value::Number(value.into()));
    }

    fn set_git_branch_protection_prompt(&mut self) {
        let mut value = self
            .input
            .get("gitBranchProtectionPrompt")
            .and_then(|v| v.as_str())
            .or_else(|| {
                self.output
                    .get("gitBranchProtectionPrompt")
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("alwaysPrompt")
            .trim()
            .to_string();

        if value != "alwaysCommit" && value != "alwaysCommitToNewBranch" && value != "alwaysPrompt"
        {
            value = "alwaysPrompt".to_string();
        }
        self.output.insert(
            "gitBranchProtectionPrompt".to_string(),
            Value::String(value),
        );
    }

    fn set_git_branch_protection(&mut self) {
        self.output.insert(
            "gitBranchProtection".to_string(),
            Value::Array(
                normalize_string_array(self.input.get("gitBranchProtection"))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }

    fn set_git_post_commit_command(&mut self) {
        let mut value = self
            .input
            .get("gitPostCommitCommand")
            .and_then(|v| v.as_str())
            .or_else(|| {
                self.output
                    .get("gitPostCommitCommand")
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("none")
            .trim()
            .to_string();

        if value != "none" && value != "push" && value != "sync" {
            value = "none".to_string();
        }
        self.output
            .insert("gitPostCommitCommand".to_string(), Value::String(value));
    }

    fn set_chat_activity_filters(&mut self) {
        let filters = if self.input.get("chatActivityFilters").is_some() {
            normalize_chat_activity_filters(self.input.get("chatActivityFilters"))
        } else {
            default_chat_activity_filters()
        };

        self.output.insert(
            "chatActivityFilters".to_string(),
            Value::Array(filters.into_iter().map(Value::String).collect()),
        );
    }

    fn set_chat_activity_tool_filters(&mut self) {
        let filters = if self.input.get("chatActivityToolFilters").is_some() {
            normalize_chat_activity_tool_filters(self.input.get("chatActivityToolFilters"))
        } else {
            default_chat_activity_tool_filters()
        };

        self.output.insert(
            "chatActivityToolFilters".to_string(),
            Value::Array(filters.into_iter().map(Value::String).collect()),
        );
    }

    fn set_optional_default_expanded_tool_filters(&mut self) {
        if self
            .input
            .get("chatActivityDefaultExpandedToolFilters")
            .is_some()
        {
            self.output.insert(
                "chatActivityDefaultExpandedToolFilters".to_string(),
                Value::Array(
                    normalize_chat_activity_tool_filters(
                        self.input.get("chatActivityDefaultExpandedToolFilters"),
                    )
                    .into_iter()
                    .map(Value::String)
                    .collect(),
                ),
            );
        }
    }
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
