use std::collections::HashSet;

use serde_json::Value;

const CHAT_ACTIVITY_FILTERS_ALLOWED: [&str; 8] = [
    "tool",
    "step-start",
    "step-finish",
    "snapshot",
    "patch",
    "agent",
    "retry",
    "compaction",
];

const CHAT_ACTIVITY_TOOL_FILTERS_DEFAULT: [&str; 22] = [
    "read",
    "list",
    "glob",
    "grep",
    "edit",
    "write",
    "apply_patch",
    "multiedit",
    "bash",
    "task",
    "webfetch",
    "websearch",
    "codesearch",
    "skill",
    "lsp",
    "todowrite",
    "todoread",
    "question",
    "batch",
    "plan_enter",
    "plan_exit",
    "unknown",
];

pub(crate) fn default_chat_activity_filters() -> Vec<String> {
    CHAT_ACTIVITY_FILTERS_ALLOWED
        .iter()
        .map(|s| s.to_string())
        .collect()
}

pub(crate) fn normalize_chat_activity_filters(v: Option<&Value>) -> Vec<String> {
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

    // Tool activity is controlled by chatActivityToolFilters; keep top-level tool
    // activity always enabled.
    requested.insert("tool".to_string());

    let mut out = Vec::new();
    for allowed in CHAT_ACTIVITY_FILTERS_ALLOWED.iter() {
        if requested.contains(*allowed) {
            out.push((*allowed).to_string());
        }
    }
    out
}

pub(crate) fn default_chat_activity_tool_filters() -> Vec<String> {
    CHAT_ACTIVITY_TOOL_FILTERS_DEFAULT
        .iter()
        .map(|s| s.to_string())
        .collect()
}

pub(crate) fn normalize_chat_activity_tool_filters(v: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(arr)) = v else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = HashSet::<String>::new();
    for item in arr {
        let Some(s) = item.as_str() else {
            continue;
        };
        let mut t = s.trim().to_ascii_lowercase();
        // Backward compatibility: older builds used `invalid` for unknown tools.
        if t == "invalid" {
            t = "unknown".to_string();
        }
        if t.is_empty() {
            continue;
        }
        if seen.insert(t.clone()) {
            out.push(t);
        }
    }
    out
}
