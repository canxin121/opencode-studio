use std::path::PathBuf;

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

fn select_existing_path(candidates: Vec<PathBuf>) -> PathBuf {
    for path in &candidates {
        if path.exists() {
            return path.clone();
        }
    }
    candidates.into_iter().next().unwrap_or_default()
}

pub(crate) fn studio_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OPENCODE_STUDIO_DATA_DIR")
        && !dir.trim().is_empty()
    {
        return PathBuf::from(dir);
    }

    crate::path_utils::config_home_dir().join("opencode-studio")
}

pub(crate) fn studio_settings_path_candidates() -> Vec<PathBuf> {
    let root = studio_data_dir();
    dedupe_paths(vec![
        root.join(SETTINGS_FILE),
        root.join(LEGACY_SETTINGS_FILE),
    ])
}

pub(crate) fn studio_settings_path() -> PathBuf {
    select_existing_path(studio_settings_path_candidates())
}

pub(crate) fn sidebar_preferences_path_candidates() -> Vec<PathBuf> {
    let ui_dir = studio_data_dir().join("ui");
    dedupe_paths(vec![
        ui_dir.join(SIDEBAR_PREFERENCES_FILE),
        ui_dir.join(LEGACY_SIDEBAR_PREFERENCES_FILE),
        ui_dir.join(LEGACY_SESSIONS_SIDEBAR_PREFERENCES_FILE),
    ])
}

pub(crate) fn sidebar_preferences_path() -> PathBuf {
    select_existing_path(sidebar_preferences_path_candidates())
}

pub(crate) fn terminal_ui_state_path_candidates() -> Vec<PathBuf> {
    let ui_dir = studio_data_dir().join("ui");
    dedupe_paths(vec![
        ui_dir.join(TERMINAL_UI_STATE_FILE),
        ui_dir.join(LEGACY_TERMINAL_UI_STATE_FILE),
    ])
}

pub(crate) fn terminal_ui_state_path() -> PathBuf {
    select_existing_path(terminal_ui_state_path_candidates())
}

pub(crate) fn terminal_session_registry_path_candidates() -> Vec<PathBuf> {
    let terminal_dir = studio_data_dir().join("terminal");
    dedupe_paths(vec![
        terminal_dir.join(TERMINAL_SESSION_REGISTRY_FILE),
        terminal_dir.join(LEGACY_TERMINAL_SESSION_REGISTRY_FILE),
    ])
}

pub(crate) fn terminal_session_registry_path() -> PathBuf {
    select_existing_path(terminal_session_registry_path_candidates())
}

pub(crate) fn opencode_data_dir() -> PathBuf {
    crate::path_utils::opencode_data_dir()
}

pub(crate) fn opencode_storage_dir() -> PathBuf {
    opencode_data_dir().join(OPENCODE_STORAGE_DIRNAME)
}

pub(crate) fn opencode_db_path_candidates() -> Vec<PathBuf> {
    dedupe_paths(vec![
        opencode_storage_dir().join(OPENCODE_DB_FILE),
        opencode_data_dir().join(LEGACY_OPENCODE_DB_FILE),
    ])
}

pub(crate) fn opencode_db_path() -> PathBuf {
    select_existing_path(opencode_db_path_candidates())
}

pub(crate) fn opencode_sessions_dir_candidates() -> Vec<PathBuf> {
    let storage = opencode_storage_dir();
    dedupe_paths(vec![
        storage.join(SESSION_RECORDS_DIR),
        storage.join(LEGACY_SESSION_RECORDS_DIR),
    ])
}

pub(crate) fn opencode_messages_dir_candidates() -> Vec<PathBuf> {
    let storage = opencode_storage_dir();
    dedupe_paths(vec![
        storage.join(MESSAGE_RECORDS_DIR),
        storage.join(LEGACY_MESSAGE_RECORDS_DIR),
    ])
}

pub(crate) fn opencode_messages_dir() -> PathBuf {
    select_existing_path(opencode_messages_dir_candidates())
}

pub(crate) fn opencode_message_parts_dir_candidates() -> Vec<PathBuf> {
    let storage = opencode_storage_dir();
    dedupe_paths(vec![
        storage.join(MESSAGE_PARTS_DIR),
        storage.join(LEGACY_MESSAGE_PARTS_DIR),
    ])
}

pub(crate) fn opencode_message_parts_dir() -> PathBuf {
    select_existing_path(opencode_message_parts_dir_candidates())
}
