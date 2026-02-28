use std::path::PathBuf;

fn decode_url_encoded_path_component(input: &str) -> String {
    if !input.as_bytes().contains(&b'%') {
        return input.to_string();
    }
    urlencoding::decode(input)
        .map(|v| v.into_owned())
        .unwrap_or_else(|_| input.to_string())
}

fn is_windows_drive_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 2 {
        return false;
    }
    bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

pub(crate) fn normalize_directory_for_match(input: &str) -> Option<String> {
    let normalized = normalize_directory_path(input);
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return None;
    }

    let slash_normalized = trimmed.replace('\\', "/");
    let canonical = if slash_normalized.len() > 1 {
        slash_normalized.trim_end_matches('/').to_string()
    } else {
        slash_normalized
    };

    if canonical.is_empty() {
        return None;
    }

    if is_windows_drive_path(&canonical) {
        return Some(canonical.to_ascii_lowercase());
    }

    Some(canonical)
}

pub(crate) fn home_dir_env() -> Option<String> {
    std::env::var("HOME")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| {
            std::env::var("USERPROFILE")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        })
        .or_else(|| {
            let drive = std::env::var("HOMEDRIVE").ok().unwrap_or_default();
            let path = std::env::var("HOMEPATH").ok().unwrap_or_default();
            let joined = format!("{}{}", drive.trim(), path.trim())
                .trim()
                .to_string();
            if joined.is_empty() {
                None
            } else {
                Some(joined)
            }
        })
}

pub(crate) fn home_dir_path() -> Option<PathBuf> {
    home_dir_env().map(PathBuf::from)
}

pub(crate) fn config_home_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("XDG_CONFIG_HOME") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if cfg!(windows)
        && let Ok(dir) = std::env::var("APPDATA")
    {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    home_dir_path()
        .map(|v| v.join(".config"))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub(crate) fn data_home_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("XDG_DATA_HOME") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if cfg!(windows) {
        for key in ["LOCALAPPDATA", "APPDATA"] {
            if let Ok(dir) = std::env::var(key) {
                let trimmed = dir.trim();
                if !trimmed.is_empty() {
                    return PathBuf::from(trimmed);
                }
            }
        }
    }

    home_dir_path()
        .map(|v| v.join(".local").join("share"))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub(crate) fn cache_home_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("XDG_CACHE_HOME") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if cfg!(windows)
        && let Ok(dir) = std::env::var("LOCALAPPDATA")
    {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    home_dir_path()
        .map(|v| v.join(".cache"))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub(crate) fn opencode_config_dir() -> PathBuf {
    config_home_dir().join("opencode")
}

pub(crate) fn opencode_data_dir() -> PathBuf {
    data_home_dir().join("opencode")
}

pub(crate) fn normalize_directory_path(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return "".to_string();
    }

    let trimmed = decode_url_encoded_path_component(trimmed);
    let trimmed = trimmed.trim();
    if trimmed.is_empty() {
        return "".to_string();
    }

    if trimmed == "~" {
        return home_dir_env().unwrap_or_else(|| trimmed.to_string());
    }

    if let Some(rest) = trimmed.strip_prefix("~/")
        && let Some(home) = home_dir_env()
    {
        let rest = rest.replace('\\', "/");
        return PathBuf::from(home)
            .join(rest)
            .to_string_lossy()
            .replace('\\', "/");
    }

    if let Some(rest) = trimmed.strip_prefix("~\\")
        && let Some(home) = home_dir_env()
    {
        let rest = rest.replace('\\', "/");
        return PathBuf::from(home)
            .join(rest)
            .to_string_lossy()
            .replace('\\', "/");
    }

    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ENV_LOCK;

    struct EnvVarGuard {
        key: String,
        old: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &str, value: String) -> Self {
            let old = std::env::var(key).ok();
            unsafe {
                std::env::set_var(key, value);
            }
            Self {
                key: key.to_string(),
                old,
            }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            unsafe {
                if let Some(ref old) = self.old {
                    std::env::set_var(&self.key, old);
                } else {
                    std::env::remove_var(&self.key);
                }
            }
        }
    }

    #[test]
    fn normalize_directory_path_decodes_url_encoded_windows_path() {
        let out = normalize_directory_path("C%3A%5CUsers%5CAlice%5Cproject");
        assert_eq!(out, "C:\\Users\\Alice\\project");
    }

    #[test]
    fn normalize_directory_path_decodes_url_encoded_linux_path() {
        let out = normalize_directory_path("%2Fhome%2Falice%2Fproject");
        assert_eq!(out, "/home/alice/project");
    }

    #[test]
    fn normalize_directory_for_match_normalizes_windows_drive_case_and_separators() {
        let out = normalize_directory_for_match("C:\\Users\\Alice\\Repo\\").expect("path");
        assert_eq!(out, "c:/users/alice/repo");
    }

    #[test]
    fn normalize_directory_for_match_keeps_linux_case() {
        let out = normalize_directory_for_match("/home/Alice/Repo/").expect("path");
        assert_eq!(out, "/home/Alice/Repo");
    }

    #[test]
    fn normalize_directory_for_match_handles_encoded_windows_input() {
        let out = normalize_directory_for_match("C%3A%5CUsers%5CAlice%5CRepo").expect("path");
        assert_eq!(out, "c:/users/alice/repo");
    }

    #[test]
    fn opencode_data_dir_uses_data_home_without_legacy_fallback() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp =
            std::env::temp_dir().join(format!("opencode-path-utils-data-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);

        let xdg_data = tmp.join("xdg-data");
        let preferred = xdg_data.join("opencode");
        std::fs::create_dir_all(&preferred).unwrap();

        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", xdg_data.to_string_lossy().to_string());

        assert_eq!(opencode_data_dir(), preferred);
    }

    #[test]
    fn opencode_config_dir_uses_config_home_without_legacy_fallback() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp =
            std::env::temp_dir().join(format!("opencode-path-utils-config-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);

        let xdg_config = tmp.join("xdg-config");
        let preferred = xdg_config.join("opencode");
        std::fs::create_dir_all(&preferred).unwrap();

        let _xdg = EnvVarGuard::set("XDG_CONFIG_HOME", xdg_config.to_string_lossy().to_string());

        assert_eq!(opencode_config_dir(), preferred);
    }
}
