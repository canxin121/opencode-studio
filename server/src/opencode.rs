use std::collections::VecDeque;
use std::net::TcpListener;
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::time::Duration;

use clap::ValueEnum;
use dashmap::DashMap;
use reqwest::StatusCode as ReqStatus;
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};

use crate::ui_auth;

#[derive(Debug, Clone, Copy, ValueEnum)]
#[value(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum OpenCodeLogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl OpenCodeLogLevel {
    fn as_cli_value(&self) -> &'static str {
        match self {
            Self::Debug => "DEBUG",
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }
}

fn parse_forward_logs_value(raw: Option<&str>) -> bool {
    let Some(raw) = raw else {
        return false;
    };
    let v = raw.trim();
    if v.is_empty() {
        return false;
    }
    matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on")
}

fn forward_logs_enabled() -> bool {
    parse_forward_logs_value(
        std::env::var("OPENCODE_STUDIO_OPENCODE_LOGS")
            .ok()
            .as_deref(),
    )
}

const OPENCODE_STARTUP_STDERR_MAX_LINES: usize = 64;
const OPENCODE_STARTUP_STDERR_MAX_CHARS: usize = 2000;

fn normalize_directory_for_upstream_query(value: &str) -> String {
    crate::path_utils::normalize_directory_for_match(value).unwrap_or_else(|| {
        let normalized = crate::path_utils::normalize_directory_path(value);
        let trimmed = normalized.trim();
        if trimmed.is_empty() {
            value.trim().to_string()
        } else {
            trimmed.to_string()
        }
    })
}

fn normalize_query_for_upstream(raw_query: &str) -> Option<String> {
    if raw_query.trim().is_empty() {
        return None;
    }

    let mut has_directory = false;
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in url::form_urlencoded::parse(raw_query.as_bytes()) {
        if key == "directory" {
            has_directory = true;
            let normalized = normalize_directory_for_upstream_query(value.as_ref());
            serializer.append_pair(key.as_ref(), &normalized);
            continue;
        }
        serializer.append_pair(key.as_ref(), value.as_ref());
    }

    if !has_directory {
        return None;
    }

    let rewritten = serializer.finish();
    if rewritten.is_empty() {
        None
    } else {
        Some(rewritten)
    }
}

#[derive(Clone)]
pub struct OpenCodeBridge {
    pub base_url: String,
    pub client: reqwest::Client,
    pub sse_client: reqwest::Client,
}

impl OpenCodeBridge {
    pub fn build_url(
        &self,
        path: &str,
        uri: Option<&axum::http::Uri>,
    ) -> Result<String, axum::http::uri::InvalidUri> {
        let mut url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        if let Some(uri) = uri
            && let Some(q) = uri.query()
            && !q.is_empty()
        {
            let query = normalize_query_for_upstream(q).unwrap_or_else(|| q.to_string());
            url.push('?');
            url.push_str(&query);
        }
        let _ = url.parse::<axum::http::Uri>()?;
        Ok(url)
    }
}

#[derive(Debug, Clone)]
pub struct OpenCodeStatus {
    pub port: Option<u16>,
    pub restarting: bool,
    pub ready: bool,
    pub last_error: Option<String>,
    pub last_error_info: Option<OpenCodeErrorInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeErrorInfo {
    pub code: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr_excerpt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<i32>,
}

impl OpenCodeErrorInfo {
    fn new(code: impl Into<String>, summary: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            summary: summary.into(),
            detail: None,
            hint: None,
            stderr_excerpt: None,
            exit_code: None,
            signal: None,
        }
    }

    fn with_detail(mut self, detail: impl Into<String>) -> Self {
        let text = detail.into();
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            self.detail = Some(trimmed.to_string());
        }
        self
    }

    fn with_hint(mut self, hint: Option<String>) -> Self {
        self.hint = hint.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });
        self
    }

    fn with_stderr_excerpt(mut self, stderr_excerpt: Option<String>) -> Self {
        self.stderr_excerpt = stderr_excerpt.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });
        self
    }

    fn with_exit_status(mut self, exit_code: Option<i32>, signal: Option<i32>) -> Self {
        self.exit_code = exit_code;
        self.signal = signal;
        self
    }

    fn legacy_message(&self) -> String {
        let mut out = self.summary.trim().to_string();

        if let Some(detail) = self.detail.as_deref().map(str::trim)
            && !detail.is_empty()
            && !detail.eq_ignore_ascii_case(&out)
        {
            if out.ends_with('.') {
                out.push(' ');
            } else {
                out.push_str(": ");
            }
            out.push_str(detail);
        }

        if let Some(stderr_excerpt) = self.stderr_excerpt.as_deref().map(str::trim)
            && !stderr_excerpt.is_empty()
        {
            out.push_str(". Recent OpenCode stderr: ");
            out.push_str(stderr_excerpt);
        }

        out
    }
}

pub struct OpenCodeManager {
    hostname: String,
    configured_port: Option<u16>,
    skip_start: bool,
    configured_log_level: Option<OpenCodeLogLevel>,

    // Optional back-reference so OpenCode plugins can call back into Studio.
    studio_base_url: Option<String>,
    ui_auth: ui_auth::UiAuth,

    // When we start OpenCode ourselves, we keep using the same port.
    managed_port: RwLock<Option<u16>>,
    child: Mutex<Option<Child>>,

    restarting: RwLock<bool>,
    ready: RwLock<bool>,
    last_error: RwLock<Option<String>>,
    last_error_info: RwLock<Option<OpenCodeErrorInfo>>,
    startup_stderr: RwLock<VecDeque<String>>,

    // Small in-memory cache of the bridge instance by port.
    bridge_cache: DashMap<u16, OpenCodeBridge>,
}

impl OpenCodeManager {
    pub fn new(
        hostname: String,
        configured_port: Option<u16>,
        skip_start: bool,
        configured_log_level: Option<OpenCodeLogLevel>,
        studio_base_url: Option<String>,
        ui_auth: ui_auth::UiAuth,
    ) -> Self {
        Self {
            hostname,
            configured_port,
            skip_start,
            configured_log_level,
            studio_base_url,
            ui_auth,
            managed_port: RwLock::new(None),
            child: Mutex::new(None),
            restarting: RwLock::new(false),
            ready: RwLock::new(false),
            last_error: RwLock::new(None),
            last_error_info: RwLock::new(None),
            startup_stderr: RwLock::new(VecDeque::new()),
            bridge_cache: DashMap::new(),
        }
    }

    pub async fn status(&self) -> OpenCodeStatus {
        let last_error_info = self.last_error_info.read().await.clone();
        OpenCodeStatus {
            port: self.port().await,
            restarting: *self.restarting.read().await,
            ready: *self.ready.read().await,
            last_error: self.last_error.read().await.clone(),
            last_error_info,
        }
    }

    pub async fn port(&self) -> Option<u16> {
        if let Some(p) = self.configured_port {
            return Some(p);
        }
        *self.managed_port.read().await
    }

    pub async fn is_restarting(&self) -> bool {
        *self.restarting.read().await
    }

    pub async fn bridge(&self) -> Option<OpenCodeBridge> {
        let port = self.port().await?;
        if let Some(existing) = self.bridge_cache.get(&port) {
            return Some(existing.clone());
        }
        let base_url = format_http_base_url(&self.hostname, port);
        let bridge = OpenCodeBridge {
            base_url,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .ok()?,
            sse_client: reqwest::Client::builder()
                // reqwest requires a concrete timeout; use a long one for SSE.
                .timeout(Duration::from_secs(24 * 60 * 60))
                .build()
                .ok()?,
        };
        self.bridge_cache.insert(port, bridge.clone());
        Some(bridge)
    }

    pub async fn start_if_needed(self: &Arc<Self>) -> Result<(), String> {
        if self.skip_start {
            return Ok(());
        }
        if self.configured_port.is_some() {
            // External server: nothing to start here.
            return Ok(());
        }
        if self.port().await.is_some() {
            return Ok(());
        }
        self.start_managed().await
    }

    pub async fn restart(self: &Arc<Self>, reason: &str) -> Result<(), String> {
        if self.skip_start {
            return Ok(());
        }

        {
            let mut restarting = self.restarting.write().await;
            if *restarting {
                // Another restart in-flight.
                return Ok(());
            }
            *restarting = true;
            *self.ready.write().await = false;
        }

        let result = async {
            if self.configured_port.is_some() {
                // External server: can't restart, just re-check readiness.
                self.clear_last_error().await;
                self.wait_for_ready(Duration::from_secs(20)).await?;
                return Ok(());
            }

            tracing::info!("Restarting OpenCode ({})", reason);
            self.stop_managed().await;
            // Small delay to allow port release.
            tokio::time::sleep(Duration::from_millis(250)).await;
            self.start_managed().await?;
            self.wait_for_ready(Duration::from_secs(20)).await?;
            Ok::<(), String>(())
        }
        .await;

        *self.restarting.write().await = false;
        result
    }

    pub async fn ensure_ready(&self, timeout: Duration) -> Result<(), String> {
        self.wait_for_ready(timeout).await
    }

    async fn clear_last_error(&self) {
        self.last_error.write().await.take();
        self.last_error_info.write().await.take();
    }

    async fn set_last_error_info(&self, info: OpenCodeErrorInfo) -> String {
        let message = info.legacy_message();
        *self.last_error.write().await = Some(message.clone());
        *self.last_error_info.write().await = Some(info);
        message
    }

    async fn start_managed(self: &Arc<Self>) -> Result<(), String> {
        let port = if let Some(p) = *self.managed_port.read().await {
            p
        } else {
            let Some(p) = pick_free_port() else {
                let message = self
                    .set_last_error_info(
                        OpenCodeErrorInfo::new(
                            "port_allocation_failed",
                            "Failed to allocate a free local port for OpenCode",
                        )
                        .with_hint(Some(
                            "Verify local TCP ports are available and not blocked by system policy."
                                .to_string(),
                        )),
                    )
                    .await;
                *self.ready.write().await = false;
                return Err(message);
            };
            *self.managed_port.write().await = Some(p);
            p
        };

        // Spawn `opencode serve`.
        let forward_logs = forward_logs_enabled();

        let log_level = self
            .configured_log_level
            .as_ref()
            .map(|v| v.as_cli_value())
            .unwrap_or("INFO");

        let mut cmd = Command::new("opencode");
        cmd.arg("serve")
            .arg("--hostname")
            .arg(self.hostname.clone())
            .arg("--port")
            .arg(port.to_string())
            .arg("--print-logs")
            .arg("--log-level")
            .arg(log_level)
            .stdin(Stdio::null());

        if let Some(base_url) = self.studio_base_url.as_deref() {
            cmd.env("OPENCODE_STUDIO_BASE_URL", base_url);
        }
        if let Some(token) = ui_auth::issue_internal_token(&self.ui_auth) {
            cmd.env("OPENCODE_STUDIO_UI_AUTH_TOKEN", token);
        }

        if cfg!(windows) {
            apply_windows_home_env_defaults(&mut cmd);
        }

        if forward_logs {
            cmd.stdout(Stdio::piped());
        } else {
            cmd.stdout(Stdio::null());
        }
        cmd.stderr(Stdio::piped());

        self.startup_stderr.write().await.clear();

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(err) => {
                let detail = err.to_string();
                let message = self
                    .set_last_error_info(
                        OpenCodeErrorInfo::new(
                            "spawn_failed",
                            "Failed to launch the OpenCode process",
                        )
                        .with_detail(detail.clone())
                        .with_hint(infer_hint_from_spawn_error(&detail)),
                    )
                    .await;
                *self.ready.write().await = false;
                *self.managed_port.write().await = None;
                return Err(message);
            }
        };

        if forward_logs && let Some(stdout) = child.stdout.take() {
            tokio::spawn(forward_child_output("opencode", stdout));
        }
        if let Some(stderr) = child.stderr.take() {
            let manager = Arc::clone(self);
            tokio::spawn(async move {
                collect_child_stderr_output(manager, "opencode", stderr, forward_logs).await;
            });
        }

        *self.child.lock().await = Some(child);

        self.clear_last_error().await;
        Ok(())
    }

    async fn stop_managed(&self) {
        // Try to kill the child process.
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }

        // Best-effort: also kill anything listening on our port.
        if let Some(port) = *self.managed_port.read().await {
            kill_process_on_port(port).await;
        }
    }

    async fn wait_for_ready(&self, timeout: Duration) -> Result<(), String> {
        let port = self
            .port()
            .await
            .ok_or_else(|| "OpenCode port is not available".to_string())?;

        let base_url = format_http_base_url(&self.hostname, port);
        let deadline = tokio::time::Instant::now() + timeout;

        tracing::info!(
            "Waiting for OpenCode to become ready at {} (timeout: {}s)",
            base_url,
            timeout.as_secs()
        );

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(4))
            .connect_timeout(Duration::from_secs(2))
            .build()
            .map_err(|e| e.to_string())?;

        loop {
            if let Some(msg) = self.check_managed_process_before_ready().await {
                return Err(msg);
            }

            if tokio::time::Instant::now() >= deadline {
                let code = if self.configured_port.is_some() {
                    "external_ready_timeout"
                } else {
                    "ready_timeout"
                };
                let summary = if self.configured_port.is_some() {
                    "Timed out waiting for configured OpenCode endpoint to become ready"
                } else {
                    "Timed out waiting for OpenCode to become ready"
                };
                let stderr_excerpt = self.recent_startup_stderr_excerpt().await;
                let msg = self
                    .set_last_error_info(
                        OpenCodeErrorInfo::new(code, summary)
                            .with_stderr_excerpt(stderr_excerpt.clone())
                            .with_hint(
                                infer_hint_from_startup_stderr(stderr_excerpt.as_deref()).or_else(
                                    || {
                                        Some(
                                            "Check OpenCode startup logs and run `opencode serve --print-logs` manually for full diagnostics.".to_string(),
                                        )
                                    },
                                ),
                            ),
                    )
                    .await;
                *self.ready.write().await = false;
                return Err(msg);
            }

            // Health-check: verify upstream supports key endpoints.
            let cfg = client
                .get(format!("{}/config", base_url))
                .header("accept", "application/json")
                .send()
                .await;
            let agent = client
                .get(format!("{}/agent", base_url))
                .header("accept", "application/json")
                .send()
                .await;

            let ok = match (cfg, agent) {
                (Ok(c), Ok(a)) => c.status() == ReqStatus::OK && a.status() == ReqStatus::OK,
                _ => false,
            };

            if ok {
                *self.ready.write().await = true;
                self.clear_last_error().await;
                return Ok(());
            }

            tokio::time::sleep(Duration::from_millis(400)).await;
        }
    }

    async fn record_startup_stderr_line(&self, line: String) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return;
        }
        let mut stderr_tail = self.startup_stderr.write().await;
        stderr_tail.push_back(trimmed.to_string());
        while stderr_tail.len() > OPENCODE_STARTUP_STDERR_MAX_LINES {
            stderr_tail.pop_front();
        }
    }

    async fn recent_startup_stderr_excerpt(&self) -> Option<String> {
        let stderr_tail = self.startup_stderr.read().await;
        if stderr_tail.is_empty() {
            return None;
        }
        let joined = stderr_tail.iter().cloned().collect::<Vec<_>>().join(" | ");
        Some(truncate_error_detail(
            joined.trim(),
            OPENCODE_STARTUP_STDERR_MAX_CHARS,
        ))
    }

    async fn check_managed_process_before_ready(&self) -> Option<String> {
        if self.configured_port.is_some() {
            return None;
        }

        enum ManagedProcessState {
            Running,
            Exited(ExitStatus),
            ProbeFailed(String),
        }

        let state = {
            let mut guard = self.child.lock().await;
            let child = guard.as_mut()?;

            match child.try_wait() {
                Ok(Some(status)) => {
                    guard.take();
                    ManagedProcessState::Exited(status)
                }
                Ok(None) => ManagedProcessState::Running,
                Err(err) => ManagedProcessState::ProbeFailed(err.to_string()),
            }
        };

        match state {
            ManagedProcessState::Running => None,
            ManagedProcessState::ProbeFailed(detail) => {
                let msg = self
                    .set_last_error_info(
                        OpenCodeErrorInfo::new(
                            "process_probe_failed",
                            "Failed to inspect OpenCode process status",
                        )
                        .with_detail(detail)
                        .with_hint(Some(
                            "Retry startup. If this repeats, check host process permissions and process limits."
                                .to_string(),
                        )),
                    )
                    .await;
                *self.ready.write().await = false;
                Some(msg)
            }
            ManagedProcessState::Exited(status) => {
                *self.ready.write().await = false;
                *self.managed_port.write().await = None;

                let (summary, exit_code, signal) = exit_status_context(status);
                let stderr_excerpt = self.recent_startup_stderr_excerpt().await;
                let msg = self
                    .set_last_error_info(
                        OpenCodeErrorInfo::new("exited_before_ready", summary)
                            .with_exit_status(exit_code, signal)
                            .with_stderr_excerpt(stderr_excerpt.clone())
                            .with_hint(
                                infer_hint_from_startup_stderr(stderr_excerpt.as_deref()).or_else(
                                    || {
                                        Some(
                                            "OpenCode exited during startup. Run `opencode serve --print-logs` manually and inspect the reported error.".to_string(),
                                        )
                                    },
                                ),
                            ),
                    )
                    .await;
                Some(msg)
            }
        }
    }
}

fn pick_free_port() -> Option<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").ok()?;
    let port = listener.local_addr().ok()?.port();
    drop(listener);
    Some(port)
}

fn normalize_connect_hostname(hostname: &str) -> String {
    let host = hostname.trim();
    match host {
        // 0.0.0.0 / :: are valid bind addresses but not valid destinations to connect to.
        "0.0.0.0" => "127.0.0.1".to_string(),
        "::" | "[::]" => "::1".to_string(),
        _ => host.to_string(),
    }
}

pub(crate) fn format_http_base_url(hostname: &str, port: u16) -> String {
    let host = normalize_connect_hostname(hostname);
    if host.starts_with('[') {
        return format!("http://{}:{}", host, port);
    }
    if host.contains(':') {
        // IPv6 literal.
        return format!("http://[{}]:{}", host, port);
    }
    format!("http://{}:{}", host, port)
}

fn apply_windows_home_env_defaults(cmd: &mut Command) {
    let Some(home) = windows_home_env_defaults() else {
        return;
    };

    if std::env::var("HOME")
        .ok()
        .map(|v| v.trim().is_empty())
        .unwrap_or(true)
    {
        cmd.env("HOME", &home);
    }
}

fn windows_home_env_defaults() -> Option<String> {
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

async fn collect_child_stderr_output(
    manager: Arc<OpenCodeManager>,
    label: &'static str,
    stream: impl tokio::io::AsyncRead + Unpin,
    forward_logs: bool,
) {
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        manager
            .record_startup_stderr_line(trimmed.to_string())
            .await;

        if !forward_logs {
            continue;
        }

        // Write directly to stderr to avoid tracing filters.
        let msg = format!("{label}: {trimmed}\n");
        let mut stderr = tokio::io::stderr();
        if stderr.write_all(msg.as_bytes()).await.is_err() {
            break;
        }
        let _ = stderr.flush().await;
    }
}

fn truncate_error_detail(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }

    let total = input.chars().count();
    if total <= max_chars {
        return input.to_string();
    }

    let mut out = input
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    out.push('…');
    out
}

fn infer_hint_from_spawn_error(detail: &str) -> Option<String> {
    let lower = detail.to_ascii_lowercase();

    if lower.contains("no such file or directory")
        || lower.contains("not found")
        || lower.contains("cannot find the file")
    {
        return Some(
            "OpenCode CLI was not found. Install `opencode-ai` and make sure `opencode` is on PATH."
                .to_string(),
        );
    }

    if lower.contains("permission denied")
        || lower.contains("access is denied")
        || lower.contains("operation not permitted")
    {
        return Some(
            "OpenCode exists but could not be executed. Check executable permissions and security policy."
                .to_string(),
        );
    }

    None
}

fn infer_hint_from_startup_stderr(stderr_excerpt: Option<&str>) -> Option<String> {
    let stderr = stderr_excerpt?.trim();
    if stderr.is_empty() {
        return None;
    }

    let lower = stderr.to_ascii_lowercase();

    if lower.contains("eaddrinuse") || lower.contains("address already in use") {
        return Some(
            "OpenCode could not bind its port. Free the conflicting port/process and retry."
                .to_string(),
        );
    }

    if lower.contains("permission denied")
        || lower.contains("eacces")
        || lower.contains("operation not permitted")
    {
        return Some(
            "OpenCode hit a permissions error. Verify access to config/data directories and retry."
                .to_string(),
        );
    }

    if lower.contains("database is locked")
        || lower.contains("readonly database")
        || lower.contains("sqlite")
    {
        return Some(
            "OpenCode storage appears locked or unavailable. Close other OpenCode instances and retry."
                .to_string(),
        );
    }

    None
}

fn exit_status_context(status: ExitStatus) -> (String, Option<i32>, Option<i32>) {
    if let Some(code) = status.code() {
        return (
            format!("OpenCode exited before becoming ready (exit code {code})"),
            Some(code),
            None,
        );
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return (
                format!("OpenCode exited before becoming ready (signal {signal})"),
                None,
                Some(signal),
            );
        }
    }

    (
        "OpenCode exited before becoming ready".to_string(),
        None,
        None,
    )
}

async fn forward_child_output(label: &'static str, stream: impl tokio::io::AsyncRead + Unpin) {
    forward_child_output_to_writer(label, stream, tokio::io::stderr()).await;
}

async fn forward_child_output_to_writer(
    label: &'static str,
    stream: impl tokio::io::AsyncRead + Unpin,
    mut out: impl AsyncWrite + Unpin,
) {
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Write directly to stderr to avoid tracing filters (e.g. RUST_LOG=warn).
        // Best-effort: if the output stream errors, stop forwarding.
        let msg = format!("{label}: {line}\n");
        if out.write_all(msg.as_bytes()).await.is_err() {
            break;
        }
        let _ = out.flush().await;
    }
}

fn parse_pid_list(output: &[u8]) -> Vec<u32> {
    let mut pids = Vec::new();
    for pid in String::from_utf8_lossy(output)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
    {
        if !pids.contains(&pid) {
            pids.push(pid);
        }
    }
    pids
}

fn listener_lsof_args(port: u16) -> [String; 4] {
    [
        "-nP".to_string(),
        "-t".to_string(),
        format!("-iTCP:{port}"),
        "-sTCP:LISTEN".to_string(),
    ]
}

#[cfg(unix)]
async fn listening_pids_on_port(port: u16) -> Vec<u32> {
    let args = listener_lsof_args(port);
    let out = Command::new("lsof")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await;
    let Ok(out) = out else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    parse_pid_list(&out.stdout)
}

#[cfg(unix)]
async fn signal_pid(pid: u32, signal: &str) {
    let _ = Command::new("kill")
        .arg(signal)
        .arg(pid.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await;
}

async fn kill_process_on_port(port: u16) {
    // Best-effort port cleanup using listener-only lsof queries on Unix so we
    // do not kill clients like opencode-studio's own SSE connection.
    #[cfg(unix)]
    {
        let current_pid = std::process::id();
        let listener_pids = listening_pids_on_port(port).await;
        for pid in listener_pids.into_iter().filter(|pid| *pid != current_pid) {
            signal_pid(pid, "-TERM").await;
        }

        tokio::time::sleep(Duration::from_millis(150)).await;

        let listener_pids = listening_pids_on_port(port).await;
        for pid in listener_pids.into_iter().filter(|pid| *pid != current_pid) {
            signal_pid(pid, "-KILL").await;
        }
    }

    #[cfg(not(unix))]
    {
        let _ = port;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ENV_LOCK;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn parse_forward_logs_value_accepts_common_truthy_values() {
        for v in ["1", "true", "TRUE", "yes", "on", " On "] {
            assert!(parse_forward_logs_value(Some(v)), "{v}");
        }
        for v in ["0", "false", "no", "off", "", "  "] {
            assert!(!parse_forward_logs_value(Some(v)), "{v}");
        }
        assert!(!parse_forward_logs_value(None));
    }

    #[test]
    fn open_code_log_level_maps_to_cli_values() {
        assert_eq!(OpenCodeLogLevel::Debug.as_cli_value(), "DEBUG");
        assert_eq!(OpenCodeLogLevel::Info.as_cli_value(), "INFO");
        assert_eq!(OpenCodeLogLevel::Warn.as_cli_value(), "WARN");
        assert_eq!(OpenCodeLogLevel::Error.as_cli_value(), "ERROR");
    }

    #[test]
    fn build_url_normalizes_directory_query_param() {
        let bridge = OpenCodeBridge {
            base_url: "http://127.0.0.1:4096".to_string(),
            client: reqwest::Client::new(),
            sse_client: reqwest::Client::new(),
        };
        let uri: axum::http::Uri =
            "/session/status?directory=C%3A%5CUsers%5CAlice%5CRepo%5C&sessionId=ses_1"
                .parse()
                .expect("valid uri");

        let built = bridge
            .build_url("/session/status", Some(&uri))
            .expect("url");
        let parsed = url::Url::parse(&built).expect("parsed url");

        let directory = parsed
            .query_pairs()
            .find(|(k, _)| k == "directory")
            .map(|(_, v)| v.into_owned());
        let session_id = parsed
            .query_pairs()
            .find(|(k, _)| k == "sessionId")
            .map(|(_, v)| v.into_owned());

        assert_eq!(directory.as_deref(), Some("c:/users/alice/repo"));
        assert_eq!(session_id.as_deref(), Some("ses_1"));
    }

    #[test]
    fn build_url_keeps_query_without_directory_unchanged() {
        let bridge = OpenCodeBridge {
            base_url: "http://127.0.0.1:4096".to_string(),
            client: reqwest::Client::new(),
            sse_client: reqwest::Client::new(),
        };
        let uri: axum::http::Uri = "/session/status?sessionId=ses_1&local=true"
            .parse()
            .expect("valid uri");

        let built = bridge
            .build_url("/session/status", Some(&uri))
            .expect("url");

        assert_eq!(
            built,
            "http://127.0.0.1:4096/session/status?sessionId=ses_1&local=true"
        );
    }

    #[tokio::test]
    async fn forward_child_output_to_writer_prefixes_and_skips_empty_lines() {
        let (mut child_w, child_r) = tokio::io::duplex(256);
        let (out_w, mut out_r) = tokio::io::duplex(256);

        let task = tokio::spawn(async move {
            forward_child_output_to_writer("opencode", child_r, out_w).await;
        });

        child_w.write_all(b"hello\n\nworld\n").await.unwrap();
        child_w.shutdown().await.unwrap();

        task.await.unwrap();

        let mut buf = Vec::new();
        out_r.read_to_end(&mut buf).await.unwrap();
        let out = String::from_utf8(buf).expect("utf8");

        assert!(out.contains("opencode: hello\n"), "{out}");
        assert!(out.contains("opencode: world\n"), "{out}");
        assert!(!out.contains("opencode: \n"), "{out}");
    }

    #[test]
    fn parse_pid_list_skips_invalid_entries_and_duplicates() {
        let parsed = parse_pid_list(b"123\n456\nnope\n123\n\n789\n");
        assert_eq!(parsed, vec![123, 456, 789]);
    }

    #[test]
    fn listener_lsof_args_only_target_tcp_listeners() {
        assert_eq!(
            listener_lsof_args(3210),
            [
                "-nP".to_string(),
                "-t".to_string(),
                "-iTCP:3210".to_string(),
                "-sTCP:LISTEN".to_string(),
            ]
        );
    }

    #[test]
    fn truncate_error_detail_appends_ellipsis_when_too_long() {
        assert_eq!(truncate_error_detail("abcdef", 10), "abcdef");
        assert_eq!(truncate_error_detail("abcdef", 4), "abc…");
        assert_eq!(truncate_error_detail("abcdef", 1), "…");
        assert_eq!(truncate_error_detail("abcdef", 0), "");
    }

    #[test]
    fn infer_hint_from_spawn_error_handles_missing_binary() {
        let hint =
            infer_hint_from_spawn_error("No such file or directory (os error 2)").expect("hint");
        assert!(hint.contains("Install `opencode-ai`"), "{hint}");
    }

    #[test]
    fn infer_hint_from_startup_stderr_handles_port_conflict() {
        let hint = infer_hint_from_startup_stderr(Some(
            "Error: listen EADDRINUSE: address already in use",
        ))
        .expect("hint");
        assert!(hint.contains("port"), "{hint}");
    }

    #[test]
    fn opencode_error_info_legacy_message_includes_stderr_excerpt() {
        let msg = OpenCodeErrorInfo::new("spawn_failed", "Failed to launch OpenCode")
            .with_detail("permission denied")
            .with_stderr_excerpt(Some("stacktrace line".to_string()))
            .legacy_message();
        assert!(msg.contains("Failed to launch OpenCode"), "{msg}");
        assert!(msg.contains("permission denied"), "{msg}");
        assert!(msg.contains("Recent OpenCode stderr"), "{msg}");
    }

    #[test]
    fn exit_status_context_includes_exit_code() {
        #[cfg(unix)]
        let status = {
            use std::os::unix::process::ExitStatusExt;
            ExitStatus::from_raw(7 << 8)
        };

        #[cfg(windows)]
        let status = {
            use std::os::windows::process::ExitStatusExt;
            ExitStatus::from_raw(7)
        };

        let (msg, code, signal) = exit_status_context(status);
        assert!(msg.contains("exit code 7"), "{msg}");
        assert_eq!(code, Some(7));
        assert_eq!(signal, None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn listening_pids_on_port_excludes_connected_clients() {
        let port = pick_free_port().expect("port");
        let script = format!(
            "import socket, time; s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', {port})); s.listen(1); conn, _ = s.accept(); time.sleep(5)",
        );
        let mut child = Command::new("python3")
            .arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("python listener");
        let child_pid = child.id().expect("listener pid");
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);

        let stream = loop {
            match tokio::net::TcpStream::connect(("127.0.0.1", port)).await {
                Ok(stream) => break stream,
                Err(_) => {
                    if tokio::time::Instant::now() >= deadline {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        panic!("timed out waiting for python listener on {port}");
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        };

        let pids = listening_pids_on_port(port).await;

        drop(stream);
        let _ = child.kill().await;
        let _ = child.wait().await;

        assert!(pids.contains(&child_pid), "{pids:?}");
        assert!(!pids.contains(&std::process::id()), "{pids:?}");
    }

    #[test]
    fn windows_home_env_defaults_uses_userprofile_when_home_missing() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let old_userprofile = std::env::var("USERPROFILE").ok();
        let old_home = std::env::var("HOME").ok();
        let old_homedrive = std::env::var("HOMEDRIVE").ok();
        let old_homepath = std::env::var("HOMEPATH").ok();

        unsafe {
            std::env::set_var("USERPROFILE", r"C:\Users\Alice");
            std::env::remove_var("HOME");
            std::env::remove_var("HOMEDRIVE");
            std::env::remove_var("HOMEPATH");
        }

        let home = windows_home_env_defaults().expect("defaults");
        assert_eq!(home, r"C:\Users\Alice");

        unsafe {
            if let Some(v) = old_userprofile {
                std::env::set_var("USERPROFILE", v);
            } else {
                std::env::remove_var("USERPROFILE");
            }
            if let Some(v) = old_home {
                std::env::set_var("HOME", v);
            } else {
                std::env::remove_var("HOME");
            }
            if let Some(v) = old_homedrive {
                std::env::set_var("HOMEDRIVE", v);
            } else {
                std::env::remove_var("HOMEDRIVE");
            }
            if let Some(v) = old_homepath {
                std::env::set_var("HOMEPATH", v);
            } else {
                std::env::remove_var("HOMEPATH");
            }
        }
    }

    #[test]
    fn windows_home_env_defaults_prefers_home_over_userprofile() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let old_userprofile = std::env::var("USERPROFILE").ok();
        let old_home = std::env::var("HOME").ok();

        unsafe {
            std::env::set_var("HOME", r"C:\Users\Primary");
            std::env::set_var("USERPROFILE", r"C:\Users\Fallback");
        }

        let home = windows_home_env_defaults().expect("defaults");
        assert_eq!(home, r"C:\Users\Primary");

        unsafe {
            if let Some(v) = old_userprofile {
                std::env::set_var("USERPROFILE", v);
            } else {
                std::env::remove_var("USERPROFILE");
            }
            if let Some(v) = old_home {
                std::env::set_var("HOME", v);
            } else {
                std::env::remove_var("HOME");
            }
        }
    }

    #[test]
    fn windows_home_env_defaults_uses_homedrive_homepath_when_needed() {
        let _env_lock = ENV_LOCK.lock().unwrap();
        let old_userprofile = std::env::var("USERPROFILE").ok();
        let old_home = std::env::var("HOME").ok();
        let old_homedrive = std::env::var("HOMEDRIVE").ok();
        let old_homepath = std::env::var("HOMEPATH").ok();

        unsafe {
            std::env::remove_var("HOME");
            std::env::set_var("USERPROFILE", "   ");
            std::env::set_var("HOMEDRIVE", " C: ");
            std::env::set_var("HOMEPATH", " \\Users\\Alice ");
        }

        let home = windows_home_env_defaults().expect("defaults");
        assert_eq!(home, r"C:\Users\Alice");

        unsafe {
            if let Some(v) = old_userprofile {
                std::env::set_var("USERPROFILE", v);
            } else {
                std::env::remove_var("USERPROFILE");
            }
            if let Some(v) = old_home {
                std::env::set_var("HOME", v);
            } else {
                std::env::remove_var("HOME");
            }
            if let Some(v) = old_homedrive {
                std::env::set_var("HOMEDRIVE", v);
            } else {
                std::env::remove_var("HOMEDRIVE");
            }
            if let Some(v) = old_homepath {
                std::env::set_var("HOMEPATH", v);
            } else {
                std::env::remove_var("HOMEPATH");
            }
        }
    }

    #[test]
    fn format_http_base_url_normalizes_unspecified_bind_hosts() {
        assert_eq!(
            format_http_base_url("0.0.0.0", 11434),
            "http://127.0.0.1:11434"
        );
        assert_eq!(format_http_base_url("::", 11434), "http://[::1]:11434");
        assert_eq!(format_http_base_url("[::]", 11434), "http://[::1]:11434");
    }

    #[test]
    fn format_http_base_url_handles_ipv6_inputs() {
        assert_eq!(format_http_base_url("::1", 9999), "http://[::1]:9999");
        assert_eq!(format_http_base_url("[::1]", 9999), "http://[::1]:9999");
    }
}
