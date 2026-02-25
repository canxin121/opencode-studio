use std::collections::HashSet;
use std::path::PathBuf;

use serde_json::Value;

fn is_windows_absolute_like(path: &str) -> bool {
    let bytes = path.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        return true;
    }
    path.starts_with("\\\\") || path.starts_with("//")
}

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

    let normalized = crate::path_utils::normalize_directory_path(trimmed);

    let p = PathBuf::from(&normalized);
    let abs = if p.is_absolute() || is_windows_absolute_like(&normalized) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_directory_path_no_fs_decodes_windows_encoded_paths() {
        let out = resolve_directory_path_no_fs("C%3A%5CUsers%5CAlice%5Crepo").expect("path");
        assert_eq!(out, "C:\\Users\\Alice\\repo");
    }

    #[test]
    fn resolve_directory_path_no_fs_decodes_linux_encoded_paths() {
        let out = resolve_directory_path_no_fs("%2Fhome%2Falice%2Frepo").expect("path");
        assert!(!out.contains('%'));
        assert!(out.replace('\\', "/").ends_with("/home/alice/repo"));
    }
}
