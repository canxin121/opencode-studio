use base64::Engine as _;
use clap::Parser;
use rand_core::{OsRng, RngCore};
use tracing::Level;

mod app;
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
mod providers;
mod session_activity;
mod settings;
mod settings_events;
mod terminal;
mod terminal_ui_state;
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
    /// Required: pass --ui-dir or set OPENCODE_STUDIO_UI_DIR.
    #[arg(long, env = "OPENCODE_STUDIO_UI_DIR", value_name = "PATH")]
    pub(crate) ui_dir: String,
}

pub(crate) fn issue_token() -> String {
    let mut buf = [0u8; 32];
    let mut rng = OsRng;
    rng.fill_bytes(&mut buf);
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

    let args = Args::parse();
    app::run(args).await;
}
