use base64::Engine as _;
use clap::{Parser, ValueEnum};
use tracing::Level;

mod app;
mod attachment_cache;
mod chat_sidebar;
mod chat_sidebar_preferences;
mod config;
mod directory_session_index;
mod directory_sessions;
mod error;
mod fs;
mod git;
mod git2_utils;
mod global_sse_hub;
mod opencode;
mod opencode_auth;
mod opencode_config;
mod opencode_config_model;
mod opencode_proxy;
mod opencode_session;
mod path_utils;
mod persistence_paths;
mod plugin_runtime;
mod providers;
mod runtime_config;
mod session_activity;
mod settings;
mod settings_events;
mod terminal;
mod terminal_ui_state;
#[cfg(test)]
mod test_support;
mod ui_auth;
mod updates;

pub(crate) use app::AppState;
pub(crate) use error::{ApiResult, AppError};

#[derive(Debug, Parser)]
#[command(
    name = "opencode-studio",
    version,
    about = "OpenCode Studio (Rust+Vue) dev server"
)]
pub(crate) struct Args {
    /// Runtime config file path (TOML).
    ///
    /// When unset, OpenCode Studio tries `<current-exe-dir>/opencode-studio.toml`.
    #[arg(long, env = "OPENCODE_STUDIO_CONFIG", value_name = "PATH")]
    pub(crate) config: Option<String>,

    /// Bind address (e.g. 127.0.0.1 or 0.0.0.0)
    #[arg(long, env = "OPENCODE_STUDIO_HOST", default_value = "127.0.0.1")]
    pub(crate) host: String,

    /// HTTP port
    #[arg(short, long, env = "OPENCODE_STUDIO_PORT", default_value_t = 3000)]
    pub(crate) port: u16,

    /// Enable UI session password
    #[arg(long, env = "OPENCODE_STUDIO_UI_PASSWORD")]
    pub(crate) ui_password: Option<String>,

    /// Connect to an existing OpenCode server on this port.
    ///
    /// When unset, OpenCode Studio will try to start `opencode serve`.
    #[arg(long, env = "OPENCODE_PORT")]
    pub(crate) opencode_port: Option<u16>,

    /// Hostname for the OpenCode server (used with --opencode-port)
    #[arg(long, env = "OPENCODE_HOST", default_value = "127.0.0.1")]
    pub(crate) opencode_host: String,

    /// Do not start OpenCode automatically.
    #[arg(
        long,
        env = "OPENCODE_STUDIO_SKIP_OPENCODE_START",
        default_value_t = false
    )]
    pub(crate) skip_opencode_start: bool,

    /// Log level for the managed `opencode serve` process.
    ///
    /// Only used when OpenCode Studio starts OpenCode itself (i.e. when --opencode-port is unset).
    #[arg(
        long,
        env = "OPENCODE_STUDIO_OPENCODE_LOG_LEVEL",
        value_enum,
        value_name = "LEVEL"
    )]
    pub(crate) opencode_log_level: Option<crate::opencode::OpenCodeLogLevel>,

    /// Directory with built UI assets (Vite dist).
    ///
    /// When unset, OpenCode Studio runs API-only (no static UI).
    #[arg(long, env = "OPENCODE_STUDIO_UI_DIR", value_name = "PATH")]
    pub(crate) ui_dir: Option<String>,

    /// Allowed CORS origins for cross-origin frontends.
    ///
    /// Use a comma-separated list via env (OPENCODE_STUDIO_CORS_ORIGINS) or repeat
    /// this flag.
    ///
    /// Example: --cors-origin http://localhost:5173
    #[arg(
        long,
        env = "OPENCODE_STUDIO_CORS_ORIGINS",
        value_delimiter = ',',
        value_name = "ORIGIN"
    )]
    pub(crate) cors_origin: Vec<String>,

    /// Allow all CORS origins (`*`).
    ///
    /// This is intended for explicit cross-origin API usage where credentials are
    /// not required by the browser CORS layer.
    #[arg(long, env = "OPENCODE_STUDIO_CORS_ALLOW_ALL", default_value_t = false)]
    pub(crate) cors_allow_all: bool,

    /// SameSite policy for the UI session cookie.
    ///
    /// - auto: Strict by default; switches to None when CORS origins are configured
    /// - none: required for cross-site cookie auth (e.g. localhost -> studio.cxits.cn)
    ///
    /// NOTE: SameSite=None requires Secure cookies, so ensure TLS (or a proxy that
    /// sets X-Forwarded-Proto=https).
    #[arg(
        long,
        env = "OPENCODE_STUDIO_UI_COOKIE_SAMESITE",
        value_enum,
        default_value = "auto",
        value_name = "MODE"
    )]
    pub(crate) ui_cookie_samesite: UiCookieSameSite,
}

#[derive(Clone, Debug, ValueEnum)]
#[value(rename_all = "kebab_case")]
pub(crate) enum UiCookieSameSite {
    Auto,
    Strict,
    Lax,
    None,
}

pub(crate) fn issue_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("issue_token: getrandom failed");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .with_target(false)
        .with_max_level(Level::INFO)
        .init();

    let args = match runtime_config::parse_args_with_runtime_config() {
        Ok(args) => args,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(2);
        }
    };
    app::run(args).await;
}
