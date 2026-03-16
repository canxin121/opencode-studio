use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use tokio::process::Command;

use crate::workspace_preview_registry::{PreviewSessionRecord, WorkspacePreviewRegistry};
use crate::{ApiResult, AppError};

fn is_running_state(state: &str) -> bool {
    matches!(state.trim().to_lowercase().as_str(), "running" | "ready")
}

fn resolve_run_directory(raw: &str) -> ApiResult<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_request("runDirectory is required"));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err(AppError::bad_request(format!(
            "runDirectory does not point to a directory: {}",
            path.to_string_lossy()
        )));
    }
    Ok(path)
}

fn resolve_logs_path(raw: &str, run_dir: &Path) -> ApiResult<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_request("logsPath is required"));
    }

    let path = PathBuf::from(trimmed);
    let resolved = if path.is_absolute() {
        path
    } else {
        run_dir.join(path)
    };
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            AppError::internal(format!(
                "failed to create logs directory {}: {err}",
                parent.to_string_lossy()
            ))
        })?;
    }
    Ok(resolved)
}

fn resolve_preview_program(program: &str) -> String {
    if program == "bun" {
        for key in ["OPENCODE_STUDIO_BUN_PATH", "OPENCODE_BUN_PATH"] {
            if let Some(value) = std::env::var_os(key) {
                let value = value.to_string_lossy().trim().to_string();
                if !value.is_empty() {
                    return value;
                }
            }
        }
    }

    program.to_string()
}

#[cfg(target_os = "macos")]
fn augment_macos_path(base: &str) -> String {
    use std::collections::HashSet;

    let mut out = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();

    for part in base.split(':') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            out.push(trimmed.to_string());
        }
    }

    let mut extras = vec![
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/local/sbin".to_string(),
    ];

    if let Some(home) = crate::path_utils::home_dir_path() {
        extras.push(home.join(".bun").join("bin").to_string_lossy().into_owned());
        extras.push(
            home.join(".cargo")
                .join("bin")
                .to_string_lossy()
                .into_owned(),
        );
    }

    for extra in extras {
        let trimmed = extra.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            out.push(trimmed.to_string());
        }
    }

    out.join(":")
}

#[cfg(not(target_os = "macos"))]
fn augment_macos_path(base: &str) -> String {
    base.to_string()
}

#[derive(Clone)]
pub(crate) struct WorkspacePreviewRuntime {
    registry: Arc<WorkspacePreviewRegistry>,
    running_by_id: Arc<DashMap<String, u32>>,
}

impl WorkspacePreviewRuntime {
    pub(crate) fn new(registry: Arc<WorkspacePreviewRegistry>) -> Self {
        Self {
            registry,
            running_by_id: Arc::new(DashMap::new()),
        }
    }

    pub(crate) async fn start_by_id(&self, id: &str) -> ApiResult<PreviewSessionRecord> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }

        if self.running_by_id.contains_key(trimmed) {
            return Err(AppError::bad_request("preview session is already running"));
        }

        let session =
            self.registry.get_by_id(trimmed).await.ok_or_else(|| {
                AppError::not_found(format!("preview session not found: {trimmed}"))
            })?;

        if is_running_state(&session.state) {
            return Err(AppError::bad_request(
                "preview session is already marked running; stop it first",
            ));
        }
        if let Some(pid) = session.pid
            && pid > 0
        {
            return Err(AppError::bad_request(
                "preview session has an active pid; stop it first",
            ));
        }

        let run_dir = resolve_run_directory(&session.run_directory)?;
        let logs_path = resolve_logs_path(&session.logs_path, &run_dir)?;

        let stdout_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&logs_path)
            .map_err(|err| {
                AppError::internal(format!(
                    "failed to open logs file {}: {err}",
                    logs_path.to_string_lossy()
                ))
            })?;
        let stderr_file = stdout_file.try_clone().map_err(|err| {
            AppError::internal(format!("failed to clone logs file handle: {err}"))
        })?;

        let program = resolve_preview_program(&session.command);
        let mut cmd = Command::new(&program);
        cmd.args(&session.args)
            .current_dir(&run_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .kill_on_drop(true);

        // See plugin_runtime for why this helps on macOS GUI launches.
        if cfg!(target_os = "macos") && !Path::new(&program).is_absolute() {
            let base_path = std::env::var("PATH").unwrap_or_default();
            let augmented = augment_macos_path(&base_path);
            if augmented != base_path && !augmented.is_empty() {
                cmd.env("PATH", augmented);
            }
        }

        let mut child = cmd.spawn().map_err(|err| {
            AppError::bad_gateway(format!(
                "failed to start preview command '{}' (cwd={}): {err}",
                session.command,
                run_dir.to_string_lossy()
            ))
        })?;

        let pid = child.id().ok_or_else(|| {
            AppError::internal("preview process started but pid is unavailable".to_string())
        })?;

        let running_map = self.running_by_id.clone();

        // Track first to ensure stop() can immediately see it.
        running_map.insert(trimmed.to_string(), pid);

        let updated = self.registry.mark_running_by_id(trimmed, pid).await?;

        // If a stop raced with our start (removed the entry), revert to stopped.
        let still_running = running_map
            .get(trimmed)
            .map(|current| *current == pid)
            .unwrap_or(false);
        if !still_running {
            let _ = self.registry.mark_stopped_by_id(trimmed, None).await;
        }

        let registry = self.registry.clone();
        let session_id = trimmed.to_string();
        tokio::spawn(async move {
            let status = child.wait().await;

            // Only apply exit handling if this process is still the current one.
            let should_apply = match running_map.get(&session_id) {
                Some(current) => *current == pid,
                None => false,
            };

            if should_apply {
                running_map.remove(&session_id);
            }

            let exit_detail = match status {
                Ok(status) if status.success() => None,
                Ok(status) => Some(format!(
                    "preview process exited with status {:?}",
                    status.code()
                )),
                Err(err) => Some(format!("preview process wait failed: {err}")),
            };

            if should_apply {
                let _ = registry.mark_stopped_by_id(&session_id, exit_detail).await;
            }
        });

        Ok(updated)
    }

    pub(crate) async fn stop_by_id(&self, id: &str) -> ApiResult<PreviewSessionRecord> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(AppError::bad_request("id is required"));
        }

        if let Some((_, pid)) = self.running_by_id.remove(trimmed) {
            let _ = kill_pid(pid).await;
            return self.registry.mark_stopped_by_id(trimmed, None).await;
        }

        let session =
            self.registry.get_by_id(trimmed).await.ok_or_else(|| {
                AppError::not_found(format!("preview session not found: {trimmed}"))
            })?;

        if let Some(pid) = session.pid
            && pid > 0
        {
            let _ = kill_pid(pid).await;
        }

        self.registry.mark_stopped_by_id(trimmed, None).await
    }
}

async fn kill_pid(pid: u32) -> ApiResult<()> {
    if pid == 0 {
        return Ok(());
    }

    #[cfg(unix)]
    {
        // Best-effort graceful stop.
        unsafe {
            let _ = libc::kill(pid as i32, libc::SIGTERM);
        }
        tokio::time::sleep(Duration::from_millis(650)).await;
        unsafe {
            let _ = libc::kill(pid as i32, libc::SIGKILL);
        }
        return Ok(());
    }

    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .await;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}
