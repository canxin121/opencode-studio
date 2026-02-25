use std::path::{Path, PathBuf};

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

fn has_opencode_config(dir: &Path) -> bool {
    dir.join("opencode.json").exists() || dir.join("opencode.jsonc").exists()
}

fn has_opencode_data(dir: &Path) -> bool {
    dir.join("opencode.db").exists()
        || dir.join("auth.json").exists()
        || dir.join("storage").exists()
}

pub(crate) fn opencode_config_dir() -> PathBuf {
    let preferred = config_home_dir().join("opencode");
    let legacy = home_dir_path().map(|home| home.join(".config").join("opencode"));

    let explicit_config_home = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);

    if explicit_config_home {
        return preferred;
    }

    if has_opencode_config(&preferred) {
        return preferred;
    }
    if let Some(legacy) = legacy
        && has_opencode_config(&legacy)
    {
        return legacy;
    }
    preferred
}

pub(crate) fn opencode_data_dir() -> PathBuf {
    let preferred = data_home_dir().join("opencode");
    let legacy = home_dir_path().map(|home| home.join(".local").join("share").join("opencode"));

    let explicit_data_home = std::env::var("XDG_DATA_HOME")
        .ok()
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);

    if explicit_data_home {
        return preferred;
    }

    if has_opencode_data(&preferred) {
        return preferred;
    }
    if let Some(legacy) = legacy
        && has_opencode_data(&legacy)
    {
        return legacy;
    }
    preferred
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
    fn opencode_data_dir_falls_back_to_legacy_home_when_preferred_missing() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp =
            std::env::temp_dir().join(format!("opencode-path-utils-data-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);

        let home = tmp.join("home");
        let local_app = tmp.join("localapp");
        let legacy = home.join(".local").join("share").join("opencode");
        let preferred = local_app.join("opencode");
        std::fs::create_dir_all(legacy.join("storage").join("session")).unwrap();
        std::fs::create_dir_all(&preferred).unwrap();

        let _home = EnvVarGuard::set("HOME", home.to_string_lossy().to_string());
        let _local = EnvVarGuard::set("LOCALAPPDATA", local_app.to_string_lossy().to_string());
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", "".to_string());

        assert_eq!(opencode_data_dir(), legacy);
    }

    #[test]
    fn opencode_config_dir_falls_back_to_legacy_home_when_preferred_missing() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp =
            std::env::temp_dir().join(format!("opencode-path-utils-config-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);

        let home = tmp.join("home");
        let appdata = tmp.join("appdata");
        let legacy = home.join(".config").join("opencode");
        let preferred = appdata.join("opencode");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&preferred).unwrap();
        std::fs::write(legacy.join("opencode.json"), "{}\n").unwrap();

        let _home = EnvVarGuard::set("HOME", home.to_string_lossy().to_string());
        let _appdata = EnvVarGuard::set("APPDATA", appdata.to_string_lossy().to_string());
        let _xdg = EnvVarGuard::set("XDG_CONFIG_HOME", "".to_string());

        assert_eq!(opencode_config_dir(), legacy);
    }
}
