use std::path::PathBuf;

pub(crate) const SETTINGS_FILE: &str = "studio-settings.json";
pub(crate) const SIDEBAR_PREFERENCES_FILE: &str = "chat-sidebar-preferences.json";
pub(crate) const TERMINAL_UI_STATE_FILE: &str = "terminal-ui-state.json";
pub(crate) const TERMINAL_SESSION_REGISTRY_FILE: &str = "session-registry.json";

pub(crate) const OPENCODE_STORAGE_DIRNAME: &str = "storage";
pub(crate) const OPENCODE_DB_FILE: &str = "opencode.sqlite";
pub(crate) const SESSION_RECORDS_DIR: &str = "sessions";
pub(crate) const MESSAGE_RECORDS_DIR: &str = "messages";
pub(crate) const MESSAGE_PARTS_DIR: &str = "message-parts";

pub(crate) fn studio_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OPENCODE_STUDIO_DATA_DIR")
        && !dir.trim().is_empty()
    {
        return PathBuf::from(dir);
    }

    crate::path_utils::config_home_dir().join("opencode-studio")
}

pub(crate) fn studio_settings_path() -> PathBuf {
    studio_data_dir().join(SETTINGS_FILE)
}

pub(crate) fn sidebar_preferences_path() -> PathBuf {
    studio_data_dir().join("ui").join(SIDEBAR_PREFERENCES_FILE)
}

pub(crate) fn terminal_ui_state_path() -> PathBuf {
    studio_data_dir().join("ui").join(TERMINAL_UI_STATE_FILE)
}

pub(crate) fn terminal_session_registry_path() -> PathBuf {
    studio_data_dir()
        .join("terminal")
        .join(TERMINAL_SESSION_REGISTRY_FILE)
}

pub(crate) fn opencode_data_dir() -> PathBuf {
    crate::path_utils::opencode_data_dir()
}

pub(crate) fn opencode_storage_dir() -> PathBuf {
    opencode_data_dir().join(OPENCODE_STORAGE_DIRNAME)
}

pub(crate) fn opencode_db_path() -> PathBuf {
    opencode_storage_dir().join(OPENCODE_DB_FILE)
}

pub(crate) fn opencode_sessions_dir() -> PathBuf {
    opencode_storage_dir().join(SESSION_RECORDS_DIR)
}

pub(crate) fn opencode_messages_dir() -> PathBuf {
    opencode_storage_dir().join(MESSAGE_RECORDS_DIR)
}

pub(crate) fn opencode_message_parts_dir() -> PathBuf {
    opencode_storage_dir().join(MESSAGE_PARTS_DIR)
}
