use std::collections::HashSet;

use serde_json::Value;

use super::super::utils::{normalize_string_array, resolve_directory_path_no_fs};

pub(super) fn merge_persisted_settings(current: &Value, changes: &Value) -> Value {
    let Value::Object(current_obj) = current else {
        return changes.clone();
    };
    let Value::Object(changes_obj) = changes else {
        return current.clone();
    };

    let mut next = current_obj.clone();
    for (k, v) in changes_obj {
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
