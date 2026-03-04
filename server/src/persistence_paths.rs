use std::path::{Path, PathBuf};

pub(crate) const SETTINGS_FILE: &str = "studio-settings.json";
pub(crate) const LEGACY_SETTINGS_FILE: &str = "settings.json";
pub(crate) const SIDEBAR_PREFERENCES_FILE: &str = "chat-sidebar-preferences.json";
pub(crate) const LEGACY_SIDEBAR_PREFERENCES_FILE: &str = "chat-sidebar.preferences.json";
pub(crate) const LEGACY_SESSIONS_SIDEBAR_PREFERENCES_FILE: &str =
    "sessions-sidebar.preferences.json";
pub(crate) const TERMINAL_UI_STATE_FILE: &str = "terminal-ui-state.json";
pub(crate) const LEGACY_TERMINAL_UI_STATE_FILE: &str = "terminal.state.json";
pub(crate) const TERMINAL_SESSION_REGISTRY_FILE: &str = "session-registry.json";
pub(crate) const LEGACY_TERMINAL_SESSION_REGISTRY_FILE: &str = "sessions.json";

pub(crate) const OPENCODE_STORAGE_DIRNAME: &str = "storage";
pub(crate) const OPENCODE_DB_FILE: &str = "opencode.sqlite";
pub(crate) const LEGACY_OPENCODE_DB_FILE: &str = "opencode.db";
pub(crate) const SESSION_RECORDS_DIR: &str = "sessions";
pub(crate) const LEGACY_SESSION_RECORDS_DIR: &str = "session";
pub(crate) const MESSAGE_RECORDS_DIR: &str = "messages";
pub(crate) const LEGACY_MESSAGE_RECORDS_DIR: &str = "message";
pub(crate) const MESSAGE_PARTS_DIR: &str = "message-parts";
pub(crate) const LEGACY_MESSAGE_PARTS_DIR: &str = "part";

fn dedupe_paths(candidates: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::<PathBuf>::new();
    for path in candidates {
        if out.iter().any(|existing| existing == &path) {
            continue;
        }
        out.push(path);
    }
    out
}

const PATH_PRIORITY_MISSING: u8 = 0;
const PATH_PRIORITY_EMPTY_DIR: u8 = 1;
const PATH_PRIORITY_EMPTY_FILE: u8 = 2;
const PATH_PRIORITY_NON_EMPTY_DIR: u8 = 3;
const PATH_PRIORITY_NON_EMPTY_FILE: u8 = 4;

fn existing_path_priority(path: &Path) -> u8 {
    let Ok(meta) = std::fs::metadata(path) else {
        return PATH_PRIORITY_MISSING;
    };

    if meta.is_file() {
        return if meta.len() > 0 {
            PATH_PRIORITY_NON_EMPTY_FILE
        } else {
            PATH_PRIORITY_EMPTY_FILE
        };
    }

    if meta.is_dir() {
        return match std::fs::read_dir(path) {
            Ok(mut entries) => {
                if entries.next().is_some() {
                    PATH_PRIORITY_NON_EMPTY_DIR
                } else {
                    PATH_PRIORITY_EMPTY_DIR
                }
            }
            Err(_) => PATH_PRIORITY_EMPTY_DIR,
        };
    }

    PATH_PRIORITY_EMPTY_FILE
}

fn select_existing_path(candidates: Vec<PathBuf>) -> PathBuf {
    let mut best_priority = PATH_PRIORITY_MISSING;
    let mut best: Option<PathBuf> = None;

    for path in &candidates {
        let priority = existing_path_priority(path);
        if priority <= best_priority {
            continue;
        }
        best_priority = priority;
        best = Some(path.clone());
        if priority == PATH_PRIORITY_NON_EMPTY_FILE {
            break;
        }
    }

    best.unwrap_or_else(|| candidates.into_iter().next().unwrap_or_default())
}

pub(crate) fn studio_data_dir_candidates() -> Vec<PathBuf> {
    if let Ok(dir) = std::env::var("OPENCODE_STUDIO_DATA_DIR")
        && !dir.trim().is_empty()
    {
        return vec![PathBuf::from(dir)];
    }

    let mut candidates = Vec::<PathBuf>::new();
    if let Some(home) = crate::path_utils::home_dir_path() {
        candidates.push(home.join(".config").join("opencode-studio"));
    }

    candidates.push(crate::path_utils::config_home_dir().join("opencode-studio"));

    if let Ok(dir) = std::env::var("APPDATA") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed).join("opencode-studio"));
        }
    }

    dedupe_paths(candidates)
}

pub(crate) fn studio_settings_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    for root in studio_data_dir_candidates() {
        candidates.push(root.join(SETTINGS_FILE));
        candidates.push(root.join(LEGACY_SETTINGS_FILE));
    }
    dedupe_paths(candidates)
}

pub(crate) fn studio_settings_path() -> PathBuf {
    select_existing_path(studio_settings_path_candidates())
}

pub(crate) fn sidebar_preferences_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    for root in studio_data_dir_candidates() {
        let ui_dir = root.join("ui");
        candidates.push(ui_dir.join(SIDEBAR_PREFERENCES_FILE));
        candidates.push(ui_dir.join(LEGACY_SIDEBAR_PREFERENCES_FILE));
        candidates.push(ui_dir.join(LEGACY_SESSIONS_SIDEBAR_PREFERENCES_FILE));
    }
    dedupe_paths(candidates)
}

pub(crate) fn sidebar_preferences_path() -> PathBuf {
    select_existing_path(sidebar_preferences_path_candidates())
}

pub(crate) fn terminal_ui_state_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    for root in studio_data_dir_candidates() {
        let ui_dir = root.join("ui");
        candidates.push(ui_dir.join(TERMINAL_UI_STATE_FILE));
        candidates.push(ui_dir.join(LEGACY_TERMINAL_UI_STATE_FILE));
    }
    dedupe_paths(candidates)
}

pub(crate) fn terminal_ui_state_path() -> PathBuf {
    select_existing_path(terminal_ui_state_path_candidates())
}

pub(crate) fn terminal_session_registry_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    for root in studio_data_dir_candidates() {
        let terminal_dir = root.join("terminal");
        candidates.push(terminal_dir.join(TERMINAL_SESSION_REGISTRY_FILE));
        candidates.push(terminal_dir.join(LEGACY_TERMINAL_SESSION_REGISTRY_FILE));
    }
    dedupe_paths(candidates)
}

pub(crate) fn terminal_session_registry_path() -> PathBuf {
    select_existing_path(terminal_session_registry_path_candidates())
}

pub(crate) fn opencode_data_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();

    candidates.push(crate::path_utils::opencode_data_dir());

    if let Ok(dir) = std::env::var("APPDATA") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed).join("opencode"));
        }
    }

    if let Ok(dir) = std::env::var("LOCALAPPDATA") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed).join("opencode"));
        }
    }

    dedupe_paths(candidates)
}

pub(crate) fn opencode_db_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    for root in opencode_data_dir_candidates() {
        candidates.push(root.join(OPENCODE_STORAGE_DIRNAME).join(OPENCODE_DB_FILE));
        candidates.push(root.join(LEGACY_OPENCODE_DB_FILE));
    }
    dedupe_paths(candidates)
}

pub(crate) fn opencode_db_path() -> PathBuf {
    select_existing_path(opencode_db_path_candidates())
}

pub(crate) fn opencode_sessions_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    for root in opencode_data_dir_candidates() {
        let storage = root.join(OPENCODE_STORAGE_DIRNAME);
        candidates.push(storage.join(SESSION_RECORDS_DIR));
        candidates.push(storage.join(LEGACY_SESSION_RECORDS_DIR));
    }
    dedupe_paths(candidates)
}

pub(crate) fn opencode_sessions_dir() -> PathBuf {
    select_existing_path(opencode_sessions_dir_candidates())
}

pub(crate) fn opencode_messages_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    for root in opencode_data_dir_candidates() {
        let storage = root.join(OPENCODE_STORAGE_DIRNAME);
        candidates.push(storage.join(MESSAGE_RECORDS_DIR));
        candidates.push(storage.join(LEGACY_MESSAGE_RECORDS_DIR));
    }
    dedupe_paths(candidates)
}

pub(crate) fn opencode_messages_dir() -> PathBuf {
    select_existing_path(opencode_messages_dir_candidates())
}

pub(crate) fn opencode_message_parts_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    for root in opencode_data_dir_candidates() {
        let storage = root.join(OPENCODE_STORAGE_DIRNAME);
        candidates.push(storage.join(MESSAGE_PARTS_DIR));
        candidates.push(storage.join(LEGACY_MESSAGE_PARTS_DIR));
    }
    dedupe_paths(candidates)
}

pub(crate) fn opencode_message_parts_dir() -> PathBuf {
    select_existing_path(opencode_message_parts_dir_candidates())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ENV_LOCK;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct EnvVarGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: String) -> Self {
            let prev = std::env::var(key).ok();
            unsafe {
                std::env::set_var(key, value);
            }
            Self { key, prev }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            unsafe {
                match self.prev.as_deref() {
                    Some(v) => std::env::set_var(self.key, v),
                    None => std::env::remove_var(self.key),
                }
            }
        }
    }

    fn unique_tmp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("opencode-studio-{label}-{nanos}"))
    }

    #[test]
    fn studio_settings_path_prefers_xdg_style_home_when_present_on_windows_like_env() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp = unique_tmp_dir("studio-settings-xdg-home-priority");
        std::fs::create_dir_all(&tmp).unwrap();

        let home = tmp.join("home");
        let appdata = tmp.join("appdata");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&appdata).unwrap();

        let home_settings = home
            .join(".config")
            .join("opencode-studio")
            .join(SETTINGS_FILE);
        let app_settings = appdata.join("opencode-studio").join(SETTINGS_FILE);
        std::fs::create_dir_all(home_settings.parent().unwrap_or(tmp.as_path())).unwrap();
        std::fs::create_dir_all(app_settings.parent().unwrap_or(tmp.as_path())).unwrap();
        std::fs::write(
            &home_settings,
            b"{\"projects\":[{\"id\":\"home\",\"path\":\"D:/git\"}]}",
        )
        .unwrap();
        std::fs::write(
            &app_settings,
            b"{\"projects\":[{\"id\":\"app\",\"path\":\"C:/repo\"}]}",
        )
        .unwrap();

        let _override = EnvVarGuard::set("OPENCODE_STUDIO_DATA_DIR", "".to_string());
        let _xdg = EnvVarGuard::set("XDG_CONFIG_HOME", "".to_string());
        let _home = EnvVarGuard::set("HOME", home.to_string_lossy().to_string());
        let _appdata = EnvVarGuard::set("APPDATA", appdata.to_string_lossy().to_string());

        assert_eq!(studio_settings_path(), home_settings);
    }

    #[test]
    fn studio_settings_path_falls_back_to_appdata_when_home_settings_missing() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp = unique_tmp_dir("studio-settings-appdata-fallback");
        std::fs::create_dir_all(&tmp).unwrap();

        let home = tmp.join("home");
        let appdata = tmp.join("appdata");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&appdata).unwrap();

        let app_settings = appdata.join("opencode-studio").join(SETTINGS_FILE);
        std::fs::create_dir_all(app_settings.parent().unwrap_or(tmp.as_path())).unwrap();
        std::fs::write(
            &app_settings,
            b"{\"projects\":[{\"id\":\"app\",\"path\":\"D:/git\"}]}",
        )
        .unwrap();

        let _override = EnvVarGuard::set("OPENCODE_STUDIO_DATA_DIR", "".to_string());
        let _xdg = EnvVarGuard::set("XDG_CONFIG_HOME", "".to_string());
        let _home = EnvVarGuard::set("HOME", home.to_string_lossy().to_string());
        let _appdata = EnvVarGuard::set("APPDATA", appdata.to_string_lossy().to_string());

        assert_eq!(studio_settings_path(), app_settings);
    }

    #[test]
    fn opencode_db_path_prefers_legacy_when_modern_db_is_empty() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp = unique_tmp_dir("persistence-db-legacy-priority");
        std::fs::create_dir_all(&tmp).unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let modern = tmp.join("opencode").join("storage").join(OPENCODE_DB_FILE);
        let legacy = tmp.join("opencode").join(LEGACY_OPENCODE_DB_FILE);

        std::fs::create_dir_all(modern.parent().unwrap_or(tmp.as_path())).unwrap();
        std::fs::write(&modern, b"").unwrap();
        std::fs::write(&legacy, b"legacy-db").unwrap();

        assert_eq!(opencode_db_path(), legacy);
    }

    #[test]
    fn opencode_db_path_uses_existing_appdata_storage_when_default_is_missing() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp = unique_tmp_dir("persistence-db-appdata-fallback");
        std::fs::create_dir_all(&tmp).unwrap();

        let home = tmp.join("home");
        let appdata = tmp.join("appdata");
        let local_appdata = tmp.join("localappdata");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&appdata).unwrap();
        std::fs::create_dir_all(&local_appdata).unwrap();

        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", "".to_string());
        let _home = EnvVarGuard::set("HOME", home.to_string_lossy().to_string());
        let _appdata = EnvVarGuard::set("APPDATA", appdata.to_string_lossy().to_string());
        let _local = EnvVarGuard::set("LOCALAPPDATA", local_appdata.to_string_lossy().to_string());

        let expected = appdata
            .join("opencode")
            .join(OPENCODE_STORAGE_DIRNAME)
            .join(OPENCODE_DB_FILE);
        std::fs::create_dir_all(expected.parent().unwrap_or(tmp.as_path())).unwrap();
        std::fs::write(&expected, b"sqlite").unwrap();

        assert_eq!(opencode_db_path(), expected);
    }

    #[test]
    fn opencode_db_path_prefers_xdg_style_home_over_windows_appdata_roots() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp = unique_tmp_dir("persistence-db-xdg-home-priority");
        std::fs::create_dir_all(&tmp).unwrap();

        let home = tmp.join("home");
        let appdata = tmp.join("appdata");
        let local_appdata = tmp.join("localappdata");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&appdata).unwrap();
        std::fs::create_dir_all(&local_appdata).unwrap();

        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", "".to_string());
        let _home = EnvVarGuard::set("HOME", home.to_string_lossy().to_string());
        let _appdata = EnvVarGuard::set("APPDATA", appdata.to_string_lossy().to_string());
        let _local = EnvVarGuard::set("LOCALAPPDATA", local_appdata.to_string_lossy().to_string());

        let preferred = home
            .join(".local")
            .join("share")
            .join("opencode")
            .join(OPENCODE_STORAGE_DIRNAME)
            .join(OPENCODE_DB_FILE);
        let fallback = appdata
            .join("opencode")
            .join(OPENCODE_STORAGE_DIRNAME)
            .join(OPENCODE_DB_FILE);
        std::fs::create_dir_all(preferred.parent().unwrap_or(tmp.as_path())).unwrap();
        std::fs::create_dir_all(fallback.parent().unwrap_or(tmp.as_path())).unwrap();
        std::fs::write(&preferred, b"local").unwrap();
        std::fs::write(&fallback, b"roaming").unwrap();

        assert_eq!(opencode_db_path(), preferred);
    }

    #[test]
    fn opencode_messages_dir_prefers_non_empty_legacy_dir_when_modern_is_empty() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp = unique_tmp_dir("persistence-message-dir-priority");
        std::fs::create_dir_all(&tmp).unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let modern = tmp
            .join("opencode")
            .join(OPENCODE_STORAGE_DIRNAME)
            .join(MESSAGE_RECORDS_DIR);
        let legacy = tmp
            .join("opencode")
            .join(OPENCODE_STORAGE_DIRNAME)
            .join(LEGACY_MESSAGE_RECORDS_DIR);

        std::fs::create_dir_all(&modern).unwrap();
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("sentinel.json"), b"{}").unwrap();

        assert_eq!(opencode_messages_dir(), legacy);
    }

    #[test]
    fn opencode_messages_dir_prefers_modern_when_both_dirs_have_data() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp = unique_tmp_dir("persistence-message-dir-modern-preferred");
        std::fs::create_dir_all(&tmp).unwrap();
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", tmp.to_string_lossy().to_string());

        let modern = tmp
            .join("opencode")
            .join(OPENCODE_STORAGE_DIRNAME)
            .join(MESSAGE_RECORDS_DIR);
        let legacy = tmp
            .join("opencode")
            .join(OPENCODE_STORAGE_DIRNAME)
            .join(LEGACY_MESSAGE_RECORDS_DIR);

        std::fs::create_dir_all(&modern).unwrap();
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(modern.join("modern.json"), b"{}").unwrap();
        std::fs::write(legacy.join("legacy.json"), b"{}").unwrap();

        assert_eq!(opencode_messages_dir(), modern);
    }
}
