use std::path::{Path, PathBuf};

use serde_json::Value;
use thiserror::Error;

use crate::opencode_config_model::OpenCodeConfig;

pub const OPENCODE_CONFIG_ENV: &str = "OPENCODE_CONFIG";

#[derive(Debug, Error)]
pub enum OpenCodeConfigError {
    #[error("{message}")]
    InvalidInput { message: String },

    #[error("Failed to read {path}: {source}")]
    ReadFile {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to parse {path}: {source}")]
    ParseFile {
        path: PathBuf,
        #[source]
        source: json5::Error,
    },
}

pub type OcResult<T> = std::result::Result<T, OpenCodeConfigError>;

impl OpenCodeConfigError {
    fn invalid_input(message: impl Into<String>) -> Self {
        Self::InvalidInput {
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfigPaths {
    pub user_path: PathBuf,
    pub project_path: Option<PathBuf>,
    pub custom_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct OpenCodeConfigStore {
    custom_config_path: Option<PathBuf>,
}

impl OpenCodeConfigStore {
    pub fn from_env() -> Self {
        let custom_config_path = std::env::var(OPENCODE_CONFIG_ENV)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .map(|p| p.canonicalize().unwrap_or(p));

        Self { custom_config_path }
    }

    pub fn opencode_config_dir(&self) -> PathBuf {
        crate::path_utils::opencode_config_dir()
    }

    pub fn config_file_user(&self) -> PathBuf {
        self.opencode_config_dir().join("opencode.json")
    }

    pub fn config_file_custom(&self) -> Option<PathBuf> {
        self.custom_config_path.clone()
    }

    fn project_config_candidates(&self, working_directory: &Path) -> Vec<PathBuf> {
        vec![
            working_directory.join("opencode.json"),
            working_directory.join("opencode.jsonc"),
            working_directory.join(".opencode").join("opencode.json"),
            working_directory.join(".opencode").join("opencode.jsonc"),
        ]
    }

    fn project_config_path(&self, working_directory: &Path) -> PathBuf {
        for c in self.project_config_candidates(working_directory) {
            if c.exists() {
                return c;
            }
        }
        self.project_config_candidates(working_directory)
            .into_iter()
            .next()
            .unwrap_or_else(|| working_directory.join("opencode.json"))
    }

    pub fn get_config_paths(&self, working_directory: Option<&Path>) -> ConfigPaths {
        let user_path = self.config_file_user();
        let project_path = working_directory.map(|wd| self.project_config_path(wd));
        let custom_path = self.config_file_custom();
        ConfigPaths {
            user_path,
            project_path,
            custom_path,
        }
    }

    fn parse_jsonc(raw: &str, path: &Path) -> OcResult<OpenCodeConfig> {
        // json5 is close enough for JSONC-like files.
        json5::from_str::<OpenCodeConfig>(raw).map_err(|source| OpenCodeConfigError::ParseFile {
            path: path.to_path_buf(),
            source,
        })
    }

    pub fn read_config_file(&self, path: Option<&Path>) -> OcResult<OpenCodeConfig> {
        let Some(path) = path else {
            return Ok(OpenCodeConfig::default());
        };
        if !path.exists() {
            return Ok(OpenCodeConfig::default());
        }
        let raw = fs_read_to_string(path)?;
        let raw = raw.trim();
        if raw.is_empty() {
            return Ok(OpenCodeConfig::default());
        }
        Self::parse_jsonc(raw, path)
    }

    pub fn read_config_layers(
        &self,
        working_directory: Option<&Path>,
    ) -> OcResult<(OpenCodeConfig, OpenCodeConfig, OpenCodeConfig, ConfigPaths)> {
        let paths = self.get_config_paths(working_directory);
        let user = self.read_config_file(Some(&paths.user_path))?;
        let project = self.read_config_file(paths.project_path.as_deref())?;
        let custom = self.read_config_file(paths.custom_path.as_deref())?;
        Ok((user, project, custom, paths))
    }

    // Note: write helpers live in `server/src/config` (UI uses PUT there).

    pub fn get_provider_sources(
        &self,
        provider_id: &str,
        working_directory: Option<&Path>,
    ) -> OcResult<Value> {
        let provider_id = provider_id.trim();
        if provider_id.is_empty() {
            return Err(OpenCodeConfigError::invalid_input(
                "Provider ID is required",
            ));
        }

        let (user, project, custom, paths) = self.read_config_layers(working_directory)?;
        let has_provider = |cfg: &OpenCodeConfig| cfg.provider.contains_key(provider_id);

        Ok(serde_json::json!({
            "sources": {
                // Auth is stored separately by opencode; OpenCode Studio augments this in providers.rs
                "auth": {"exists": false},
                "user": {
                    "exists": has_provider(&user),
                    "path": paths.user_path.to_string_lossy()
                },
                "project": {
                    "exists": has_provider(&project),
                    "path": paths.project_path.as_ref().map(|p| p.to_string_lossy().into_owned())
                },
                "custom": {
                    "exists": has_provider(&custom),
                    "path": paths.custom_path.as_ref().map(|p| p.to_string_lossy().into_owned())
                }
            }
        }))
    }

    // Intentionally no provider-delete mutation helpers here; the UI edits configs via PUT.
}

// === Public helpers used by HTTP handlers ===

pub fn get_provider_sources(
    provider_id: &str,
    working_directory: Option<&Path>,
) -> OcResult<Value> {
    OpenCodeConfigStore::from_env().get_provider_sources(provider_id, working_directory)
}

fn fs_read_to_string(path: &Path) -> OcResult<String> {
    std::fs::read_to_string(path).map_err(|source| OpenCodeConfigError::ReadFile {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::OpenCodeConfigStore;
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
    fn parse_jsonc_accepts_comments() {
        let raw = "// comment\n{ provider: { openai: { apiKey: 'x' } } }";
        let parsed =
            OpenCodeConfigStore::parse_jsonc(raw, std::path::Path::new("/tmp/opencode.jsonc"));
        assert!(parsed.is_ok());
    }

    #[test]
    fn config_file_user_falls_back_to_legacy_home_config_when_present() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let tmp =
            std::env::temp_dir().join(format!("opencode-config-store-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);

        let home = tmp.join("home");
        let appdata = tmp.join("appdata");
        let legacy_dir = home.join(".config").join("opencode");
        let preferred_dir = appdata.join("opencode");
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::create_dir_all(&preferred_dir).unwrap();
        std::fs::write(legacy_dir.join("opencode.json"), "{\"$schema\":\"x\"}\n").unwrap();

        let _home = EnvVarGuard::set("HOME", home.to_string_lossy().to_string());
        let _app = EnvVarGuard::set("APPDATA", appdata.to_string_lossy().to_string());
        let _xdg = EnvVarGuard::set("XDG_CONFIG_HOME", "".to_string());

        let store = OpenCodeConfigStore::from_env();
        assert_eq!(store.config_file_user(), legacy_dir.join("opencode.json"));
    }
}
