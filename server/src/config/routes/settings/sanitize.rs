use std::collections::HashSet;

use serde_json::Value;

use super::super::super::sanitize::{
    normalize_chat_activity_filters, normalize_chat_activity_tool_filters,
};
use super::super::utils::{normalize_string_array, resolve_directory_path_no_fs};

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

pub(super) fn sanitize_settings_update(payload: &Value) -> Value {
    let Value::Object(input) = payload else {
        return Value::Object(serde_json::Map::new());
    };

    SettingsUpdateSanitizer::new(input).sanitize()
}

struct SettingsUpdateSanitizer<'a> {
    input: &'a serde_json::Map<String, Value>,
    output: serde_json::Map<String, Value>,
}

impl<'a> SettingsUpdateSanitizer<'a> {
    fn new(input: &'a serde_json::Map<String, Value>) -> Self {
        Self {
            input,
            output: serde_json::Map::new(),
        }
    }

    fn sanitize(mut self) -> Value {
        self.sanitize_strings();
        self.sanitize_enum_fields();
        self.sanitize_trimmed_string_fields();
        self.sanitize_boolean_fields();
        self.sanitize_number_fields();
        self.sanitize_array_fields();
        self.sanitize_typography_sizes();
        self.sanitize_projects_alias();
        self.sanitize_skill_catalogs();
        Value::Object(self.output)
    }

    fn sanitize_strings(&mut self) {
        for key in [
            "themeId",
            "lightThemeId",
            "darkThemeId",
            "homeDirectory",
            "uiFont",
            "monoFont",
            "markdownDisplayMode",
        ] {
            if let Some(Value::String(s)) = self.input.get(key)
                && !s.is_empty()
            {
                self.output
                    .insert(key.to_string(), Value::String(s.clone()));
            }
        }
    }

    fn sanitize_enum_fields(&mut self) {
        self.insert_allowed_enum("themeVariant", ["light", "dark"]);
        self.insert_allowed_enum("toolCallExpansion", ["collapsed", "activity", "detailed"]);
        self.insert_allowed_enum(
            "diffLayoutPreference",
            ["dynamic", "inline", "side-by-side"],
        );
        self.insert_allowed_enum("diffViewMode", ["single", "stacked"]);
        self.insert_allowed_enum(
            "gitBranchProtectionPrompt",
            ["alwaysCommit", "alwaysCommitToNewBranch", "alwaysPrompt"],
        );
        self.insert_allowed_enum("gitPostCommitCommand", ["none", "push", "sync"]);
    }

    fn insert_allowed_enum<const N: usize>(&mut self, key: &str, allowed: [&str; N]) {
        let Some(Value::String(v)) = self.input.get(key) else {
            return;
        };

        let trimmed = v.trim();
        if allowed.contains(&trimmed) {
            self.output
                .insert(key.to_string(), Value::String(trimmed.to_string()));
        }
    }

    fn sanitize_trimmed_string_fields(&mut self) {
        for key in [
            "githubClientId",
            "githubScopes",
            "defaultModel",
            "defaultVariant",
            "defaultAgent",
            "defaultGitIdentityId",
            "updateIgnoredReleaseTag",
        ] {
            if let Some(Value::String(v)) = self.input.get(key) {
                let trimmed = v.trim();
                if !trimmed.is_empty() {
                    self.output
                        .insert(key.to_string(), Value::String(trimmed.to_string()));
                } else {
                    self.output.insert(key.to_string(), Value::Null);
                }
            }
        }
    }

    fn sanitize_boolean_fields(&mut self) {
        for key in [
            "useSystemTheme",
            "updateAutoCheckEnabled",
            "updateAutoPromptEnabled",
            "updateAutoServiceInstallEnabled",
            "updateAutoInstallerInstallEnabled",
            "showReasoningTraces",
            "showTextJustificationActivity",
            "showChatTimestamps",
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
            if let Some(Value::Bool(b)) = self.input.get(key) {
                self.output.insert(key.to_string(), Value::Bool(*b));
            }
        }
    }

    fn sanitize_number_fields(&mut self) {
        self.insert_bounded_number("autoDeleteAfterDays", 1, 365);
        self.insert_bounded_number("fontSize", 50, 200);
        self.insert_bounded_number("padding", 50, 200);
        self.insert_bounded_number("cornerRadius", 0, 32);
        self.insert_bounded_number("inputBarOffset", 0, 100);
        self.insert_bounded_number("memoryLimitHistorical", 10, 500);
        self.insert_bounded_number("memoryLimitViewport", 20, 500);
        self.insert_bounded_number("memoryLimitActiveSession", 30, 1000);
        self.insert_bounded_number("updateReminderSnoozeUntil", 0, 4_102_444_800_000);
    }

    fn insert_bounded_number(&mut self, key: &str, min: i64, max: i64) {
        let Some(n) = self.input.get(key).and_then(|v| v.as_i64()) else {
            return;
        };

        let clamped = n.max(min).min(max);
        self.output
            .insert(key.to_string(), Value::Number(clamped.into()));
    }

    fn sanitize_array_fields(&mut self) {
        self.insert_normalized_string_array("approvedDirectories");
        self.insert_normalized_string_array("securityScopedBookmarks");
        self.insert_normalized_string_array("pinnedDirectories");
        self.insert_normalized_string_array("gitBranchProtection");

        if self.input.get("chatActivityFilters").is_some() {
            self.output.insert(
                "chatActivityFilters".to_string(),
                Value::Array(
                    normalize_chat_activity_filters(self.input.get("chatActivityFilters"))
                        .into_iter()
                        .map(Value::String)
                        .collect(),
                ),
            );
        }
        if self.input.get("chatActivityToolFilters").is_some() {
            self.output.insert(
                "chatActivityToolFilters".to_string(),
                Value::Array(
                    normalize_chat_activity_tool_filters(self.input.get("chatActivityToolFilters"))
                        .into_iter()
                        .map(Value::String)
                        .collect(),
                ),
            );
        }
        if self.input.get("chatActivityDefaultExpanded").is_some() {
            self.output.insert(
                "chatActivityDefaultExpanded".to_string(),
                Value::Array(
                    normalize_chat_activity_default_expanded(
                        self.input.get("chatActivityDefaultExpanded"),
                    )
                    .into_iter()
                    .map(Value::String)
                    .collect(),
                ),
            );
        }
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

    fn insert_normalized_string_array(&mut self, key: &str) {
        if self.input.get(key).is_some() {
            self.output.insert(
                key.to_string(),
                Value::Array(
                    normalize_string_array(self.input.get(key))
                        .into_iter()
                        .map(Value::String)
                        .collect(),
                ),
            );
        }
    }

    fn sanitize_typography_sizes(&mut self) {
        if let Some(v) = sanitize_typography_sizes_partial(self.input.get("typographySizes")) {
            self.output.insert("typographySizes".to_string(), v);
        }
    }

    fn sanitize_projects_alias(&mut self) {
        if let Some(projects) = sanitize_projects(project_entries_payload(self.input)) {
            self.output.insert("projects".to_string(), projects);
        }
    }

    fn sanitize_skill_catalogs(&mut self) {
        if let Some(v) = sanitize_skill_catalogs(self.input.get("skillCatalogs")) {
            self.output.insert("skillCatalogs".to_string(), v);
        }
    }
}

fn normalize_chat_activity_default_expanded(v: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(arr)) = v else {
        return Vec::new();
    };

    let mut requested = HashSet::<String>::new();
    for item in arr {
        let Some(s) = item.as_str() else {
            continue;
        };
        let trimmed = s.trim().to_ascii_lowercase();
        if trimmed.is_empty() {
            continue;
        }
        requested.insert(trimmed);
    }

    let mut out = Vec::new();
    for allowed in CHAT_ACTIVITY_DEFAULT_EXPANDED_ALLOWED {
        if requested.contains(allowed) {
            out.push(allowed.to_string());
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
        project.insert("path".to_string(), Value::String(normalized_path));
        if !label.is_empty() {
            project.insert("label".to_string(), Value::String(label.to_string()));
        }
        if let Some(v) = added_at {
            project.insert("addedAt".to_string(), Value::Number(v.into()));
        }
        if let Some(v) = last_opened_at {
            project.insert("lastOpenedAt".to_string(), Value::Number(v.into()));
        }

        if let Some(Value::Object(wt)) = obj.get("worktreeDefaults") {
            let mut defaults = serde_json::Map::new();
            if let Some(Value::String(s)) = wt.get("branchPrefix") {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    defaults.insert(
                        "branchPrefix".to_string(),
                        Value::String(trimmed.to_string()),
                    );
                }
            }
            if let Some(Value::String(s)) = wt.get("baseBranch") {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    defaults.insert("baseBranch".to_string(), Value::String(trimmed.to_string()));
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

fn project_entries_payload(obj: &serde_json::Map<String, Value>) -> Option<&Value> {
    if obj.get("directories").is_some() {
        obj.get("directories")
    } else {
        obj.get("projects")
    }
}
