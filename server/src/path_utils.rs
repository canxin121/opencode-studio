use std::path::PathBuf;

pub(crate) fn normalize_directory_path(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return "".to_string();
    }

    if trimmed == "~" {
        return std::env::var("HOME").unwrap_or_else(|_| trimmed.to_string());
    }

    if let Some(rest) = trimmed.strip_prefix("~/")
        && let Ok(home) = std::env::var("HOME")
    {
        return PathBuf::from(home)
            .join(rest)
            .to_string_lossy()
            .into_owned();
    }

    if let Some(rest) = trimmed.strip_prefix("~\\")
        && let Ok(home) = std::env::var("HOME")
    {
        return PathBuf::from(home)
            .join(rest)
            .to_string_lossy()
            .into_owned();
    }

    trimmed.to_string()
}
