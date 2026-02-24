use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    Json, Router,
    http::{HeaderValue, Method, header},
    middleware,
    response::{Html, IntoResponse},
    routing::{any, get, post},
};
use axum_extra::extract::cookie::SameSite;
use futures_util::stream::{self as futures_stream, StreamExt as _};
use serde::Serialize;
use tokio::sync::RwLock;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use url::Url;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) ui_auth: crate::ui_auth::UiAuth,
    pub(crate) ui_cookie_same_site: SameSite,
    pub(crate) cors_allowed_origins: Vec<String>,
    pub(crate) opencode: Arc<crate::opencode::OpenCodeManager>,
    pub(crate) plugin_runtime: Arc<crate::plugin_runtime::PluginRuntime>,
    pub(crate) terminal: Arc<crate::terminal::TerminalManager>,
    pub(crate) session_activity: crate::session_activity::SessionActivityManager,
    pub(crate) directory_session_index:
        crate::directory_session_index::DirectorySessionIndexManager,
    pub(crate) settings_path: PathBuf,
    pub(crate) settings: Arc<RwLock<crate::settings::Settings>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    timestamp: String,
    open_code_port: Option<u16>,
    open_code_running: bool,
    is_open_code_ready: bool,
    last_open_code_error: Option<String>,
}

async fn health(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> impl IntoResponse {
    let oc = state.opencode.status().await;
    let resp = HealthResponse {
        status: "ok",
        timestamp: time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "".to_string()),
        open_code_port: oc.port,
        open_code_running: oc.port.is_some() && oc.ready && !oc.restarting,
        is_open_code_ready: oc.ready,
        last_open_code_error: oc.last_error,
    };
    Json(resp)
}

fn tracked_status_directories(settings: &crate::settings::Settings) -> Vec<String> {
    let mut out = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();
    for project in settings.projects.iter() {
        let raw = project.path.trim();
        if raw.is_empty() {
            continue;
        }
        let normalized = crate::path_utils::normalize_directory_path(raw);
        let key = normalized.trim();
        if key.is_empty() {
            continue;
        }
        if seen.insert(key.to_string()) {
            out.push(key.to_string());
        }
    }
    out
}

const SESSION_ACTIVITY_IDLE_RETENTION: std::time::Duration =
    std::time::Duration::from_secs(30 * 60);
const SESSION_RUNTIME_IDLE_RETENTION: std::time::Duration = std::time::Duration::from_secs(30 * 60);
const STATUS_RECONCILE_FETCH_CONCURRENCY: usize = 6;

async fn fetch_session_status_map(
    bridge: &crate::opencode::OpenCodeBridge,
    directory: Option<&str>,
) -> Option<serde_json::Value> {
    let mut target = format!("{}/session/status", bridge.base_url.trim_end_matches('/'));
    if let Some(directory) = directory {
        let trimmed = directory.trim();
        if !trimmed.is_empty() {
            target.push_str("?directory=");
            target.push_str(&urlencoding::encode(trimmed));
        }
    }

    let resp = bridge.client.get(target).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<serde_json::Value>().await.ok()
}

async fn reconcile_runtime_status_from_opencode(state: &Arc<AppState>) {
    let oc = state.opencode.status().await;
    if oc.restarting || !oc.ready {
        return;
    }

    let Some(bridge) = state.opencode.bridge().await else {
        return;
    };

    let directories = {
        let settings = state.settings.read().await;
        tracked_status_directories(&settings)
    };

    let mut busy = HashSet::<String>::new();
    let mut scope = HashSet::<String>::new();

    if directories.is_empty() {
        if let Some(payload) = fetch_session_status_map(&bridge, None).await {
            let busy = state
                .directory_session_index
                .reconcile_runtime_status_map(&payload);
            state.session_activity.reconcile_busy_set(&busy);
        }
        return;
    } else {
        let tasks = futures_stream::iter(directories.into_iter().map(|directory| {
            let bridge = bridge.clone();
            async move {
                let payload = fetch_session_status_map(&bridge, Some(&directory)).await;
                (directory, payload)
            }
        }))
        .buffer_unordered(STATUS_RECONCILE_FETCH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

        for (directory, payload) in tasks {
            let Some(payload) = payload else {
                continue;
            };
            let local_busy = state
                .directory_session_index
                .merge_runtime_status_map(&payload);
            scope.extend(
                state
                    .directory_session_index
                    .session_ids_for_directory(&directory),
            );
            scope.extend(local_busy.iter().cloned());
            busy.extend(local_busy);
        }
    }

    if scope.is_empty() {
        return;
    }

    state
        .directory_session_index
        .reconcile_busy_set_scoped(&busy, &scope);
    state
        .session_activity
        .reconcile_busy_set_scoped(&busy, &scope);
}

async fn session_activity(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> impl IntoResponse {
    // Best-effort reconcile the in-memory activity snapshot with OpenCode's
    // authoritative /session/status so hard-refresh doesn't show stale "running".
    //
    // The server-side activity snapshot is derived from proxied SSE events; if no
    // client was connected when a run ended we may miss the terminal idle signal.
    reconcile_runtime_status_from_opencode(&state).await;
    state
        .session_activity
        .prune_stale_idle_entries(SESSION_ACTIVITY_IDLE_RETENTION);
    state
        .directory_session_index
        .prune_stale_runtime_entries(SESSION_RUNTIME_IDLE_RETENTION);

    Json(state.session_activity.snapshot_json())
}

// Note: update/install is intentionally not exposed via the UI.

pub(crate) async fn run(args: crate::Args) {
    fn normalize_origin_str(raw: &str) -> Option<String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
        let Ok(url) = Url::parse(trimmed) else {
            return None;
        };
        let scheme = url.scheme();
        if scheme != "http" && scheme != "https" {
            return None;
        }
        Some(url.origin().ascii_serialization())
    }

    fn build_cors_layer(origins: &[String]) -> Option<CorsLayer> {
        if origins.is_empty() {
            return None;
        }

        let mut values: Vec<HeaderValue> = Vec::new();
        for origin in origins {
            let Ok(v) = HeaderValue::from_str(origin) else {
                tracing::warn!(
                    target: "opencode_studio.cors",
                    origin = %origin,
                    "Ignoring invalid CORS origin header value"
                );
                continue;
            };
            values.push(v);
        }

        if values.is_empty() {
            return None;
        }

        let allow_headers = [
            header::ACCEPT,
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::HeaderName::from_static("last-event-id"),
        ];
        let allow_methods = [
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
            Method::OPTIONS,
        ];

        Some(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(values))
                .allow_credentials(true)
                .allow_headers(allow_headers)
                .allow_methods(allow_methods)
                .max_age(std::time::Duration::from_secs(60 * 60)),
        )
    }

    let mut normalized_cors_origins: Vec<String> = Vec::new();
    for raw in args.cors_origin.iter() {
        let Some(origin) = normalize_origin_str(raw) else {
            tracing::warn!(
                target: "opencode_studio.cors",
                origin = %raw,
                "Ignoring invalid CORS origin"
            );
            continue;
        };
        normalized_cors_origins.push(origin);
    }
    normalized_cors_origins.sort();
    normalized_cors_origins.dedup();

    let ui_cookie_same_site = match args.ui_cookie_samesite {
        crate::UiCookieSameSite::Auto => {
            if normalized_cors_origins.is_empty() {
                SameSite::Strict
            } else {
                SameSite::None
            }
        }
        crate::UiCookieSameSite::Strict => SameSite::Strict,
        crate::UiCookieSameSite::Lax => SameSite::Lax,
        crate::UiCookieSameSite::None => SameSite::None,
    };

    let ui_dir_path: Option<PathBuf> = args
        .ui_dir
        .as_deref()
        .map(|s| s.trim().to_string())
        .and_then(|configured| {
            if configured.is_empty() {
                return None;
            }
            let path = PathBuf::from(configured);
            Some(if path.is_absolute() {
                path
            } else {
                // Treat explicit relative paths as relative to the current working directory.
                let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                cwd.join(path)
            })
        });

    let ui_auth = crate::ui_auth::init_ui_auth(args.ui_password.clone());
    if crate::ui_auth::spawn_cleanup_sessions_task_if_enabled(&ui_auth) {
        tracing::info!("UI password protection enabled");
    }

    let (settings_path, settings_value) = crate::settings::init_settings().await;

    let configured_opencode_port = args.opencode_port;
    let opencode = Arc::new(crate::opencode::OpenCodeManager::new(
        args.opencode_host.clone(),
        configured_opencode_port,
        args.skip_opencode_start,
        args.opencode_log_level,
    ));
    if let Err(err) = opencode.start_if_needed().await {
        tracing::error!(
            "Failed to start OpenCode: {err}. Ensure 'opencode' is in PATH or pass --opencode-port to a running instance."
        );
        std::process::exit(1);
    }
    if let Err(err) = opencode
        .ensure_ready(std::time::Duration::from_secs(20))
        .await
    {
        tracing::error!(
            "OpenCode is required but not available: {err}. Ensure 'opencode' is in PATH or pass --opencode-port to a running instance."
        );
        std::process::exit(1);
    }

    let terminal = Arc::new(crate::terminal::TerminalManager::new());
    terminal.clone().spawn_cleanup_task();

    let plugin_runtime = Arc::new(crate::plugin_runtime::PluginRuntime::new());

    let activity = crate::session_activity::SessionActivityManager::new();
    let directory_session_index =
        crate::directory_session_index::DirectorySessionIndexManager::new();

    let state = Arc::new(AppState {
        ui_auth,
        ui_cookie_same_site,
        cors_allowed_origins: normalized_cors_origins.clone(),
        opencode,
        plugin_runtime,
        terminal,
        session_activity: activity,
        directory_session_index,
        settings_path,
        settings: Arc::new(RwLock::new(settings_value)),
    });

    if let Err(err) = state
        .plugin_runtime
        .refresh_from_opencode_config_layers(None)
        .await
    {
        tracing::warn!(
            target: "opencode_studio.plugin_runtime",
            error = %err,
            "failed to refresh plugin runtime on startup"
        );
    }

    {
        let state = state.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                reconcile_runtime_status_from_opencode(&state).await;
                state
                    .session_activity
                    .prune_stale_idle_entries(SESSION_ACTIVITY_IDLE_RETENTION);
                state
                    .directory_session_index
                    .prune_stale_runtime_entries(SESSION_RUNTIME_IDLE_RETENTION);
            }
        });
    }

    let api_router = Router::new()
        // Providers
        .route(
            "/provider/{provider_id}/source",
            get(crate::providers::provider_source_get),
        )
        .route(
            "/provider/env/check",
            post(crate::providers::env_check_post),
        )
        // Config / Skills
        .route(
            "/config/settings",
            get(crate::config::config_settings_get).put(crate::config::config_settings_put),
        )
        .route(
            "/config/settings/events",
            get(crate::settings_events::config_settings_events),
        )
        .route(
            "/config/opencode",
            get(crate::config::config_opencode_get).put(crate::config::config_opencode_put),
        )
        .route("/plugins", get(crate::plugin_runtime::plugins_list_get))
        .route(
            "/plugins/{plugin_id}/manifest",
            get(crate::plugin_runtime::plugin_manifest_get),
        )
        .route(
            "/plugins/{plugin_id}/action",
            post(crate::plugin_runtime::plugin_action_post),
        )
        .route(
            "/plugins/{plugin_id}/events",
            get(crate::plugin_runtime::plugin_events_get),
        )
        .route(
            "/plugins/{plugin_id}/assets/{*asset_path}",
            get(crate::plugin_runtime::plugin_asset_get),
        )
        .route("/config/reload", post(crate::config::config_reload_post))
        .route(
            "/ui/chat-sidebar/preferences",
            get(crate::chat_sidebar_preferences::chat_sidebar_preferences_get)
                .put(crate::chat_sidebar_preferences::chat_sidebar_preferences_put),
        )
        .route(
            "/ui/chat-sidebar/preferences/events",
            get(crate::chat_sidebar_preferences::chat_sidebar_preferences_events),
        )
        .route(
            "/ui/terminal/state",
            get(crate::terminal_ui_state::terminal_ui_state_get)
                .put(crate::terminal_ui_state::terminal_ui_state_put),
        )
        .route(
            "/ui/terminal/state/events",
            get(crate::terminal_ui_state::terminal_ui_state_events),
        )
        // Legacy aliases kept for backward compatibility.
        .route(
            "/ui/sessions-sidebar/preferences",
            get(crate::chat_sidebar_preferences::chat_sidebar_preferences_get)
                .put(crate::chat_sidebar_preferences::chat_sidebar_preferences_put),
        )
        .route(
            "/ui/sessions-sidebar/preferences/events",
            get(crate::chat_sidebar_preferences::chat_sidebar_preferences_events),
        )
        // SSE bridge
        .route(
            "/event",
            get(crate::opencode_proxy::proxy_opencode_sse_event),
        )
        .route(
            "/global/event",
            get(crate::global_sse_hub::global_event_sse),
        )
        .route(
            "/chat-sidebar/bootstrap",
            get(crate::chat_sidebar::chat_sidebar_bootstrap),
        )
        .route(
            "/chat-sidebar/events",
            get(crate::chat_sidebar::chat_sidebar_events),
        )
        .route(
            "/chat-sidebar/recent-index",
            get(crate::chat_sidebar::chat_sidebar_recent_index),
        )
        .route(
            "/chat-sidebar/running-index",
            get(crate::chat_sidebar::chat_sidebar_running_index),
        )
        // Legacy aliases kept for backward compatibility.
        .route(
            "/sessions-sidebar/bootstrap",
            get(crate::chat_sidebar::chat_sidebar_bootstrap),
        )
        .route(
            "/sessions-sidebar/events",
            get(crate::chat_sidebar::chat_sidebar_events),
        )
        .route(
            "/sessions-sidebar/recent-index",
            get(crate::chat_sidebar::chat_sidebar_recent_index),
        )
        .route(
            "/sessions-sidebar/running-index",
            get(crate::chat_sidebar::chat_sidebar_running_index),
        )
        .route(
            "/sessions/summaries",
            get(crate::chat_sidebar::sessions_summaries_get),
        )
        .route("/directories", get(crate::chat_sidebar::directories_get))
        .route(
            "/directories/{directory_id}/sessions",
            get(crate::chat_sidebar::directory_sessions_by_id_get),
        )
        // OpenCode Studio session list + filtered message history
        .route(
            "/session",
            get(crate::opencode_session::session_list).post(crate::opencode_session::session_post),
        )
        .route(
            "/session/status",
            get(crate::opencode_proxy::session_status_get),
        )
        .route(
            "/session/{session_id}/message",
            get(crate::opencode_session::session_message_get)
                .post(crate::opencode_proxy::session_message_post),
        )
        .route(
            "/session/{session_id}/message/{message_id}/part/{part_id}",
            get(crate::opencode_session::session_message_part_get),
        )
        .route("/permission", get(crate::opencode_proxy::permission_list))
        .route("/question", get(crate::opencode_proxy::question_list))
        // OpenCode Studio activity tracking
        .route("/session-activity", get(session_activity))
        // OpenCode Studio meta endpoints
        .route(
            "/opencode-studio/update-check",
            get(crate::updates::update_check),
        )
        .route(
            "/opencode-studio/session-locate",
            get(crate::opencode_proxy::opencode_studio_session_locate),
        )
        .route(
            "/opencode-studio/cache/clear",
            post(crate::opencode_session::opencode_storage_cache_clear),
        )
        // Filesystem
        .route("/fs/home", get(crate::fs::fs_home))
        .route("/fs/mkdir", post(crate::fs::fs_mkdir))
        .route("/fs/read", get(crate::fs::fs_read))
        .route("/fs/raw", get(crate::fs::fs_raw))
        .route("/fs/download", get(crate::fs::fs_download))
        .route("/fs/write", post(crate::fs::fs_write))
        .route(
            "/fs/upload",
            post(crate::fs::fs_upload)
                .layer(RequestBodyLimitLayer::new(crate::fs::MAX_UPLOAD_BYTES)),
        )
        .route("/fs/delete", post(crate::fs::fs_delete))
        .route("/fs/rename", post(crate::fs::fs_rename))
        .route("/fs/list", get(crate::fs::fs_list))
        .route("/fs/search", get(crate::fs::fs_search))
        .route("/fs/search-content", post(crate::fs::fs_content_search))
        .route("/fs/replace-content", post(crate::fs::fs_content_replace))
        // Terminal
        .route("/terminal/create", post(crate::terminal::terminal_create))
        .route(
            "/terminal/{session_id}/stream",
            get(crate::terminal::terminal_stream),
        )
        .route(
            "/terminal/{session_id}/input",
            post(crate::terminal::terminal_input),
        )
        .route(
            "/terminal/{session_id}/resize",
            post(crate::terminal::terminal_resize),
        )
        .route(
            "/terminal/{session_id}",
            get(crate::terminal::terminal_get).delete(crate::terminal::terminal_delete),
        )
        .route(
            "/terminal/{session_id}/restart",
            post(crate::terminal::terminal_restart),
        )
        // Git
        .route("/git/check", get(crate::git::git_check))
        .route("/git/repos", get(crate::git::git_repos))
        .route("/git/safe-directory", post(crate::git::git_safe_directory))
        .route("/git/init", post(crate::git::git_init))
        .route("/git/clone", post(crate::git::git_clone))
        .route(
            "/git/gpg/enable-preset-passphrase",
            post(crate::git::git_gpg_enable_preset_passphrase),
        )
        .route(
            "/git/gpg/disable-signing",
            post(crate::git::git_gpg_disable_signing),
        )
        .route(
            "/git/gpg/set-signing-key",
            post(crate::git::git_gpg_set_signing_key),
        )
        .route("/git/remote-info", get(crate::git::git_remote_info))
        .route(
            "/git/remotes",
            post(crate::git::git_remote_add)
                .put(crate::git::git_remote_rename)
                .delete(crate::git::git_remote_remove),
        )
        .route("/git/remotes/set-url", post(crate::git::git_remote_set_url))
        .route("/git/signing-info", get(crate::git::git_signing_info))
        .route("/git/state", get(crate::git::git_state))
        .route("/git/merge/abort", post(crate::git::git_merge_abort))
        .route("/git/rebase/abort", post(crate::git::git_rebase_abort))
        .route("/git/stash", get(crate::git::git_stash_list))
        .route("/git/stash/show", get(crate::git::git_stash_show))
        .route("/git/stash/push", post(crate::git::git_stash_push))
        .route("/git/stash/apply", post(crate::git::git_stash_apply))
        .route("/git/stash/pop", post(crate::git::git_stash_pop))
        .route("/git/stash/drop", post(crate::git::git_stash_drop))
        .route("/git/stash/drop-all", post(crate::git::git_stash_drop_all))
        .route("/git/stash/branch", post(crate::git::git_stash_branch))
        .route(
            "/git/rebase/continue",
            post(crate::git::git_rebase_continue),
        )
        .route("/git/rebase/skip", post(crate::git::git_rebase_skip))
        .route(
            "/git/cherry-pick/abort",
            post(crate::git::git_cherry_pick_abort),
        )
        .route(
            "/git/cherry-pick/continue",
            post(crate::git::git_cherry_pick_continue),
        )
        .route(
            "/git/cherry-pick/skip",
            post(crate::git::git_cherry_pick_skip),
        )
        .route("/git/cherry-pick", post(crate::git::git_cherry_pick))
        .route("/git/revert/abort", post(crate::git::git_revert_abort))
        .route(
            "/git/revert/continue",
            post(crate::git::git_revert_continue),
        )
        .route("/git/revert/skip", post(crate::git::git_revert_skip))
        .route("/git/revert-commit", post(crate::git::git_revert_commit))
        .route("/git/merge", post(crate::git::git_merge))
        .route("/git/rebase", post(crate::git::git_rebase))
        .route(
            "/git/remote-branches",
            get(crate::git::git_remote_branches_list),
        )
        // Git data
        .route("/git/status", get(crate::git::git_status))
        .route("/git/watch", get(crate::git::git_watch))
        .route("/git/diff", get(crate::git::git_diff))
        .route("/git/file-diff", get(crate::git::git_file_diff))
        .route("/git/compare", get(crate::git::git_compare))
        .route("/git/patch", post(crate::git::git_apply_patch))
        .route("/git/lfs", get(crate::git::git_lfs_status))
        .route("/git/lfs/install", post(crate::git::git_lfs_install))
        .route("/git/lfs/track", post(crate::git::git_lfs_track))
        .route("/git/lfs/locks", get(crate::git::git_lfs_locks))
        .route("/git/lfs/lock", post(crate::git::git_lfs_lock))
        .route("/git/lfs/unlock", post(crate::git::git_lfs_unlock))
        .route("/git/submodules", get(crate::git::git_submodules))
        .route("/git/submodules/add", post(crate::git::git_submodule_add))
        .route("/git/submodules/init", post(crate::git::git_submodule_init))
        .route(
            "/git/submodules/update",
            post(crate::git::git_submodule_update),
        )
        .route("/git/log", get(crate::git::git_log))
        .route("/git/commit-diff", get(crate::git::git_commit_diff))
        .route("/git/commit-files", get(crate::git::git_commit_files))
        .route(
            "/git/commit-file-diff",
            get(crate::git::git_commit_file_diff),
        )
        .route(
            "/git/commit-file-content",
            get(crate::git::git_commit_file_content),
        )
        .route("/git/blame", get(crate::git::git_blame))
        .route("/git/stage", post(crate::git::git_stage))
        .route("/git/clean", post(crate::git::git_clean))
        .route("/git/ignore", post(crate::git::git_ignore))
        .route("/git/rename", post(crate::git::git_rename))
        .route("/git/delete", post(crate::git::git_delete))
        .route("/git/unstage", post(crate::git::git_unstage))
        .route("/git/revert", post(crate::git::git_revert))
        .route("/git/pull", post(crate::git::git_pull))
        .route("/git/push", post(crate::git::git_push))
        .route(
            "/git/create-github-repo-and-push",
            post(crate::git::git_create_github_repo_and_push),
        )
        .route("/git/fetch", post(crate::git::git_fetch))
        .route("/git/commit", post(crate::git::git_commit))
        .route("/git/undo-commit", post(crate::git::git_undo_commit))
        .route("/git/reset", post(crate::git::git_reset_commit))
        .route("/git/commit-template", get(crate::git::git_commit_template))
        .route("/git/conflicts", get(crate::git::git_conflicts_list))
        .route("/git/conflicts/file", get(crate::git::git_conflict_file))
        .route(
            "/git/conflicts/resolve",
            post(crate::git::git_conflict_resolve),
        )
        .route(
            "/git/branches",
            get(crate::git::git_branches)
                .post(crate::git::git_create_branch)
                .delete(crate::git::git_delete_branch),
        )
        .route("/git/branches/rename", post(crate::git::git_rename_branch))
        .route(
            "/git/branches/delete-remote",
            post(crate::git::git_delete_remote_branch),
        )
        .route("/git/tags", get(crate::git::git_tags_list))
        .route("/git/tags", post(crate::git::git_tags_create))
        .route(
            "/git/tags",
            axum::routing::delete(crate::git::git_tags_delete),
        )
        .route(
            "/git/tags/delete-remote",
            post(crate::git::git_tags_delete_remote),
        )
        .route("/git/checkout", post(crate::git::git_checkout))
        .route(
            "/git/checkout-detached",
            post(crate::git::git_checkout_detached),
        )
        .route(
            "/git/branches/create-from",
            post(crate::git::git_create_branch_from),
        )
        .route(
            "/git/worktrees",
            get(crate::git::git_worktrees)
                .post(crate::git::git_worktree_add)
                .delete(crate::git::git_worktree_remove),
        )
        .route("/git/worktrees/prune", post(crate::git::git_worktree_prune))
        .route(
            "/git/worktrees/migrate",
            post(crate::git::git_worktree_migrate),
        )
        // OpenCode REST reverse proxy fallback
        .route("/{*path}", any(crate::opencode_proxy::proxy_opencode_rest))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::ui_auth::require_ui_auth,
        ));

    let (has_ui, asset_files, static_files) = match &ui_dir_path {
        None => {
            tracing::info!("UI disabled (API-only mode)");
            (false, None, None)
        }
        Some(dir) => {
            let index_file = dir.join("index.html");
            let has_ui = index_file.is_file();
            tracing::info!(
                "UI dir resolved to {} (index.html exists: {})",
                dir.to_string_lossy(),
                has_ui
            );

            // Serve Vite hashed assets with a real 404 when missing. The SPA fallback
            // (index.html) is only appropriate for client routes, not JS/CSS chunks.
            let asset_files = ServeDir::new(dir.join("assets"));
            let static_files = ServeDir::new(dir).fallback(ServeFile::new(index_file));
            (has_ui, Some(asset_files), Some(static_files))
        }
    };

    let mut app = Router::new()
        .route("/health", get(health))
        .route(
            "/auth/session",
            get(crate::ui_auth::auth_session_status).post(crate::ui_auth::auth_session_create),
        )
        .nest("/api", api_router)
        .with_state(state)
        .layer(TraceLayer::new_for_http());

    if let Some(cors) = build_cors_layer(&normalized_cors_origins) {
        tracing::info!(
            target: "opencode_studio.cors",
            origins = %normalized_cors_origins.len(),
            "CORS enabled"
        );
        app = app.layer(cors);
    }

    app = if has_ui {
        app.nest_service("/assets", asset_files.expect("assets service"))
            .fallback_service(static_files.expect("static service"))
    } else {
        app.fallback(|| async {
            Html(
                "<html><body><h1>OpenCode Studio server running</h1><p>UI is not served by this instance (API-only mode). Configure a frontend separately and connect to this server via <code>/api/*</code>. To serve the built UI from this server, pass <code>--ui-dir &lt;dist&gt;</code> (or set <code>OPENCODE_STUDIO_UI_DIR</code>).</p></body></html>",
            )
        })
    };

    let addr: SocketAddr = format!("{}:{}", args.host, args.port)
        .parse()
        .expect("valid bind address");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind listener");

    tracing::info!("OpenCode Studio listening on http://{}", addr);
    axum::serve(listener, app).await.expect("server run");
}
