use std::net::TcpListener;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use clap::ValueEnum;
use dashmap::DashMap;
use reqwest::StatusCode as ReqStatus;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};

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
            url.push('?');
            url.push_str(q);
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
}

pub struct OpenCodeManager {
    hostname: String,
    configured_port: Option<u16>,
    skip_start: bool,
    configured_log_level: Option<OpenCodeLogLevel>,

    // When we start OpenCode ourselves, we keep using the same port.
    managed_port: RwLock<Option<u16>>,
    child: Mutex<Option<Child>>,

    restarting: RwLock<bool>,
    ready: RwLock<bool>,
    last_error: RwLock<Option<String>>,

    // Small in-memory cache of the bridge instance by port.
    bridge_cache: DashMap<u16, OpenCodeBridge>,
}

impl OpenCodeManager {
    pub fn new(
        hostname: String,
        configured_port: Option<u16>,
        skip_start: bool,
        configured_log_level: Option<OpenCodeLogLevel>,
    ) -> Self {
        Self {
            hostname,
            configured_port,
            skip_start,
            configured_log_level,
            managed_port: RwLock::new(None),
            child: Mutex::new(None),
            restarting: RwLock::new(false),
            ready: RwLock::new(false),
            last_error: RwLock::new(None),
            bridge_cache: DashMap::new(),
        }
    }

    pub async fn status(&self) -> OpenCodeStatus {
        OpenCodeStatus {
            port: self.port().await,
            restarting: *self.restarting.read().await,
            ready: *self.ready.read().await,
            last_error: self.last_error.read().await.clone(),
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
                self.last_error.write().await.take();
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

    async fn start_managed(&self) -> Result<(), String> {
        let port = {
            let mut guard = self.managed_port.write().await;
            if let Some(p) = *guard {
                p
            } else {
                let p =
                    pick_free_port().ok_or_else(|| "Failed to allocate a free port".to_string())?;
                *guard = Some(p);
                p
            }
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

        if forward_logs {
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        } else {
            cmd.stdout(Stdio::null()).stderr(Stdio::null());
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start OpenCode: {e}"))?;

        if forward_logs {
            if let Some(stdout) = child.stdout.take() {
                tokio::spawn(forward_child_output("opencode", stdout));
            }
            if let Some(stderr) = child.stderr.take() {
                tokio::spawn(forward_child_output("opencode", stderr));
            }
        }

        *self.child.lock().await = Some(child);

        self.last_error.write().await.take();
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
            if tokio::time::Instant::now() >= deadline {
                let msg = "Timed out waiting for OpenCode to become ready".to_string();
                *self.last_error.write().await = Some(msg.clone());
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
                self.last_error.write().await.take();
                return Ok(());
            }

            tokio::time::sleep(Duration::from_millis(400)).await;
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

fn format_http_base_url(hostname: &str, port: u16) -> String {
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

async fn kill_process_on_port(port: u16) {
    // Best-effort port cleanup using lsof+kill on Unix.
    #[cfg(unix)]
    {
        let out = Command::new("lsof")
            .arg("-ti")
            .arg(format!(":{port}"))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await;
        let Ok(out) = out else {
            return;
        };
        if !out.status.success() {
            return;
        }
        let txt = String::from_utf8_lossy(&out.stdout);
        for pid in txt
            .split_whitespace()
            .filter_map(|s| s.trim().parse::<i32>().ok())
        {
            let _ = Command::new("kill")
                .arg("-9")
                .arg(pid.to_string())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .await;
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
}
