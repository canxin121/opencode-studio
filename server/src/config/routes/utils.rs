use std::collections::HashSet;
use std::path::PathBuf;

use serde_json::Value;

pub(super) fn normalize_string_array(v: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(arr)) = v else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = HashSet::<String>::new();
    for item in arr {
        let Some(s) = item.as_str() else {
            continue;
        };
        let s = s.trim();
        if s.is_empty() {
            continue;
        }
        if seen.insert(s.to_string()) {
            out.push(s.to_string());
        }
    }
    out
}

pub(super) fn resolve_directory_path_no_fs(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = if trimmed == "~" {
        std::env::var("HOME").unwrap_or_else(|_| trimmed.to_string())
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        std::env::var("HOME")
            .map(|h| PathBuf::from(h).join(rest).to_string_lossy().into_owned())
            .unwrap_or_else(|_| trimmed.to_string())
    } else if let Some(rest) = trimmed.strip_prefix("~\\") {
        std::env::var("HOME")
            .map(|h| PathBuf::from(h).join(rest).to_string_lossy().into_owned())
            .unwrap_or_else(|_| trimmed.to_string())
    } else {
        trimmed.to_string()
    };

    let p = PathBuf::from(normalized);
    let abs = if p.is_absolute() {
        p
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(p)
    };
    Some(
        abs.components()
            .collect::<PathBuf>()
            .to_string_lossy()
            .into_owned(),
    )
}
