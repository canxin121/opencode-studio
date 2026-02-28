use std::ffi::OsStr;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use flate2::read::GzDecoder;
use tauri::Manager;

use crate::AppHandle;
use crate::backend::BackendManager;

const USER_AGENT: &str = "opencode-studio-desktop-updater";
const UPDATE_DOWNLOAD_DIR_NAME: &str = "update-downloads";

#[derive(Debug, Clone, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateProgressSnapshot {
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub downloaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Default)]
pub(crate) struct UpdateProgressState {
    inner: Arc<Mutex<UpdateProgressSnapshot>>,
}

impl UpdateProgressState {
    pub fn snapshot(&self) -> UpdateProgressSnapshot {
        self.inner
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| UpdateProgressSnapshot::default())
    }

    pub fn begin(&self, kind: &str, phase: &str, message: &str) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.running = true;
            guard.kind = Some(kind.to_string());
            guard.phase = Some(phase.to_string());
            guard.message = Some(message.to_string());
            guard.downloaded_bytes = 0;
            guard.total_bytes = None;
            guard.error = None;
        }
    }

    pub fn set_phase(&self, phase: &str, message: &str) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.phase = Some(phase.to_string());
            guard.message = Some(message.to_string());
        }
    }

    pub fn set_download(&self, phase: &str, message: &str, downloaded: u64, total: Option<u64>) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.phase = Some(phase.to_string());
            guard.message = Some(message.to_string());
            guard.downloaded_bytes = downloaded;
            guard.total_bytes = total;
        }
    }

    pub fn finish_ok(&self, phase: &str, message: &str) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.running = false;
            guard.phase = Some(phase.to_string());
            guard.message = Some(message.to_string());
            guard.error = None;
        }
    }

    pub fn finish_err(&self, message: String) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.running = false;
            guard.phase = Some("error".to_string());
            guard.message = Some(message.clone());
            guard.error = Some(message);
        }
    }
}

pub(crate) async fn apply_service_update(
    app: &AppHandle,
    progress: &UpdateProgressState,
    asset_url: String,
) -> Result<(), String> {
    progress.begin("service", "preparing", "Preparing service update...");

    let result: Result<(), String> = async {
        let asset_url = normalize_http_url(&asset_url)?;
        let sidecar_path = resolve_sidecar_path()?;
        if !sidecar_path.is_file() {
            return Err(format!(
                "service sidecar binary not found: {}",
                sidecar_path.display()
            ));
        }

        let downloads_dir = update_downloads_dir(app)?;
        let suffix = unique_suffix();
        let fallback = if cfg!(target_os = "windows") {
            "opencode-studio.zip"
        } else {
            "opencode-studio.tar.gz"
        };
        let archive_name = infer_asset_name(&asset_url, Some(fallback))
            .ok_or_else(|| "unable to derive service package filename".to_string())?;
        let archive_path = downloads_dir.join(format!("service-{suffix}-{archive_name}"));
        let extracted_path = downloads_dir.join(if cfg!(target_os = "windows") {
            format!("service-{suffix}.exe")
        } else {
            format!("service-{suffix}")
        });

        let progress_clone = progress.clone();
        download_asset_to_path(&asset_url, &archive_path, move |downloaded, total| {
            progress_clone.set_download(
                "downloading",
                "Downloading service package...",
                downloaded,
                total,
            );
        })
        .await?;

        progress.set_phase("extracting", "Extracting service package...");
        let expected_binary_name = if cfg!(target_os = "windows") {
            "opencode-studio.exe"
        } else {
            "opencode-studio"
        };
        extract_binary_from_archive(&archive_path, &extracted_path, expected_binary_name)?;

        progress.set_phase("stopping", "Stopping backend process...");
        let manager = app.state::<BackendManager>().inner().clone();
        manager
            .stop(app)
            .await
            .map_err(|err| format!("stop backend before update: {err}"))?;
        kill_residual_backend_processes_best_effort();
        std::thread::sleep(Duration::from_millis(250));

        progress.set_phase("replacing", "Replacing service binary...");
        replace_binary_file(&sidecar_path, &extracted_path)?;

        let _ = fs::remove_file(&archive_path);
        let _ = fs::remove_file(&extracted_path);

        progress.set_phase("restarting", "Restarting backend process...");
        manager
            .ensure_started(app)
            .await
            .map_err(|err| format!("restart backend after update: {err}"))?;

        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            progress.finish_ok("completed", "Service update completed.");
            Ok(())
        }
        Err(err) => {
            progress.finish_err(err.clone());
            Err(err)
        }
    }
}

pub(crate) async fn apply_installer_update(
    app: &AppHandle,
    progress: &UpdateProgressState,
    asset_url: String,
    asset_name: Option<String>,
) -> Result<(), String> {
    progress.begin(
        "installer",
        "preparing",
        "Preparing desktop installer update...",
    );

    let result: Result<(), String> = async {
        let asset_url = normalize_http_url(&asset_url)?;
        let downloads_dir = update_downloads_dir(app)?;
        let suffix = unique_suffix();
        let installer_name = infer_asset_name(&asset_url, asset_name.as_deref())
            .ok_or_else(|| "unable to derive installer package filename".to_string())?;
        let installer_path = downloads_dir.join(format!("desktop-{suffix}-{installer_name}"));

        let progress_clone = progress.clone();
        download_asset_to_path(&asset_url, &installer_path, move |downloaded, total| {
            progress_clone.set_download(
                "downloading",
                "Downloading desktop installer package...",
                downloaded,
                total,
            );
        })
        .await?;

        progress.set_phase("stopping", "Stopping runtime processes...");
        let manager = app.state::<BackendManager>().inner().clone();
        let _ = manager.stop(app).await;
        kill_residual_backend_processes_best_effort();

        progress.set_phase("launching", "Launching installer...");
        spawn_installer_launcher(&installer_path, std::process::id())?;
        app.exit(0);
        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            progress.finish_ok("launching", "Installer launched.");
            Ok(())
        }
        Err(err) => {
            progress.finish_err(err.clone());
            Err(err)
        }
    }
}

fn normalize_http_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.is_empty() {
        return Err("asset url is required".to_string());
    }
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("asset url must start with http:// or https://".to_string());
    }
    Ok(url.to_string())
}

async fn download_asset_to_path<F>(
    url: &str,
    destination: &Path,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, Option<u64>),
{
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("create update download dir {}: {err}", parent.display()))?;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|err| format!("create http client for updater: {err}"))?;

    let mut resp = client
        .get(url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .send()
        .await
        .map_err(|err| format!("download update package: {err}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "download update package failed with status {}",
            resp.status()
        ));
    }

    let total = resp.content_length();
    on_progress(0, total);

    let mut file = fs::File::create(destination).map_err(|err| {
        format!(
            "create update package file {}: {err}",
            destination.display()
        )
    })?;
    let mut downloaded = 0u64;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|err| format!("read update package stream: {err}"))?
    {
        file.write_all(&chunk)
            .map_err(|err| format!("write update package file {}: {err}", destination.display()))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        on_progress(downloaded, total);
    }
    Ok(())
}

fn update_downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("resolve desktop update download dir: {err}"))?;
    let dir = base.join(UPDATE_DOWNLOAD_DIR_NAME);
    fs::create_dir_all(&dir)
        .map_err(|err| format!("create desktop update download dir {}: {err}", dir.display()))?;
    Ok(dir)
}

fn unique_suffix() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default()
    )
}

fn infer_asset_name(url: &str, preferred: Option<&str>) -> Option<String> {
    let preferred = preferred
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(sanitize_file_name)
        .filter(|v| !v.is_empty());
    if preferred.is_some() {
        return preferred;
    }

    let path_part = url.split('?').next().unwrap_or(url);
    let tail = path_part.rsplit('/').next().unwrap_or("").trim();
    let sanitized = sanitize_file_name(tail);
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

fn sanitize_file_name(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn resolve_sidecar_path() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|err| format!("resolve current exe: {err}"))?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "resolve current exe dir failed".to_string())?;
    let base_dir = if exe_dir.ends_with("deps") {
        exe_dir.parent().unwrap_or(exe_dir)
    } else {
        exe_dir
    };

    let mut sidecar_path = base_dir.join("opencode-studio");
    #[cfg(target_os = "windows")]
    {
        if sidecar_path
            .extension()
            .is_none_or(|ext| ext != OsStr::new("exe"))
        {
            sidecar_path.as_mut_os_string().push(".exe");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if sidecar_path
            .extension()
            .is_some_and(|ext| ext == OsStr::new("exe"))
        {
            sidecar_path.set_extension("");
        }
    }

    Ok(sidecar_path)
}

fn extract_binary_from_archive(
    archive_path: &Path,
    destination_binary: &Path,
    expected_binary_name: &str,
) -> Result<(), String> {
    let file_name = archive_path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if file_name.ends_with(".zip") {
        return extract_binary_from_zip(archive_path, destination_binary, expected_binary_name);
    }
    if file_name.ends_with(".tar.gz") || file_name.ends_with(".tgz") {
        return extract_binary_from_tar_gz(archive_path, destination_binary, expected_binary_name);
    }

    Err(format!(
        "unsupported service package format: {}",
        archive_path.display()
    ))
}

fn extract_binary_from_zip(
    archive_path: &Path,
    destination_binary: &Path,
    expected_binary_name: &str,
) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path)
        .map_err(|err| format!("open zip package {}: {err}", archive_path.display()))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|err| format!("read zip package {}: {err}", archive_path.display()))?;

    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|err| format!("read zip entry #{idx}: {err}"))?;
        if !entry.is_file() {
            continue;
        }
        let entry_name = Path::new(entry.name())
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("");
        if entry_name != expected_binary_name {
            continue;
        }

        if let Some(parent) = destination_binary.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("create extract dir {}: {err}", parent.display()))?;
        }
        let mut out = fs::File::create(destination_binary).map_err(|err| {
            format!(
                "create extracted binary {}: {err}",
                destination_binary.display()
            )
        })?;
        io::copy(&mut entry, &mut out).map_err(|err| {
            format!(
                "write extracted binary {}: {err}",
                destination_binary.display()
            )
        })?;
        return Ok(());
    }

    Err(format!(
        "service binary {expected_binary_name} not found in {}",
        archive_path.display()
    ))
}

fn extract_binary_from_tar_gz(
    archive_path: &Path,
    destination_binary: &Path,
    expected_binary_name: &str,
) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path)
        .map_err(|err| format!("open tar.gz package {}: {err}", archive_path.display()))?;
    let decoder = GzDecoder::new(archive_file);
    let mut archive = tar::Archive::new(decoder);

    let entries = archive
        .entries()
        .map_err(|err| format!("read tar.gz entries {}: {err}", archive_path.display()))?;
    for entry in entries {
        let mut entry = entry.map_err(|err| format!("read tar.gz entry: {err}"))?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = entry
            .path()
            .map_err(|err| format!("read tar.gz entry path: {err}"))?;
        let entry_name = path.file_name().and_then(|v| v.to_str()).unwrap_or("");
        if entry_name != expected_binary_name {
            continue;
        }

        if let Some(parent) = destination_binary.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("create extract dir {}: {err}", parent.display()))?;
        }
        let mut out = fs::File::create(destination_binary).map_err(|err| {
            format!(
                "create extracted binary {}: {err}",
                destination_binary.display()
            )
        })?;
        io::copy(&mut entry, &mut out).map_err(|err| {
            format!(
                "write extracted binary {}: {err}",
                destination_binary.display()
            )
        })?;
        return Ok(());
    }

    Err(format!(
        "service binary {expected_binary_name} not found in {}",
        archive_path.display()
    ))
}

fn replace_binary_file(target_binary: &Path, new_binary: &Path) -> Result<(), String> {
    if !new_binary.is_file() {
        return Err(format!("new binary not found: {}", new_binary.display()));
    }

    let parent = target_binary
        .parent()
        .ok_or_else(|| format!("invalid target binary path: {}", target_binary.display()))?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("create binary dir {}: {err}", parent.display()))?;

    let filename = target_binary
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| {
            format!(
                "invalid target binary filename: {}",
                target_binary.display()
            )
        })?;
    let staged = parent.join(format!("{filename}.new"));
    let backup = parent.join(format!("{filename}.bak"));

    if staged.exists() {
        let _ = fs::remove_file(&staged);
    }
    fs::copy(new_binary, &staged).map_err(|err| {
        format!(
            "copy staged update binary {} -> {}: {err}",
            new_binary.display(),
            staged.display()
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&staged)
            .map_err(|err| format!("read staged file metadata {}: {err}", staged.display()))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&staged, perms)
            .map_err(|err| format!("set staged file permissions {}: {err}", staged.display()))?;
    }

    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }

    if target_binary.exists() {
        fs::rename(target_binary, &backup).map_err(|err| {
            format!(
                "move old binary {} -> {}: {err}",
                target_binary.display(),
                backup.display()
            )
        })?;
    }

    let write_result = fs::rename(&staged, target_binary).or_else(|_| {
        fs::copy(&staged, target_binary).map(|_| ()).map_err(|err| {
            io::Error::new(
                err.kind(),
                format!(
                    "copy staged binary {} -> {}: {err}",
                    staged.display(),
                    target_binary.display()
                ),
            )
        })
    });

    if let Err(err) = write_result {
        if backup.exists() {
            let _ = fs::rename(&backup, target_binary);
        }
        let _ = fs::remove_file(&staged);
        return Err(err.to_string());
    }

    let _ = fs::remove_file(&staged);
    let _ = fs::remove_file(&backup);
    Ok(())
}

fn kill_residual_backend_processes_best_effort() {
    #[cfg(target_os = "windows")]
    {
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/IM", "opencode-studio.exe", "/T"])
            .status();
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let _ = StdCommand::new("pkill")
            .args(["-x", "opencode-studio"])
            .status();
    }
}

fn spawn_installer_launcher(installer_path: &Path, app_pid: u32) -> Result<(), String> {
    if !installer_path.is_file() {
        return Err(format!(
            "installer package not found: {}",
            installer_path.display()
        ));
    }

    #[cfg(target_os = "windows")]
    {
        return spawn_installer_launcher_windows(installer_path, app_pid);
    }
    #[cfg(target_os = "macos")]
    {
        return spawn_installer_launcher_unix(installer_path, app_pid, true);
    }
    #[cfg(target_os = "linux")]
    {
        return spawn_installer_launcher_unix(installer_path, app_pid, false);
    }

    #[allow(unreachable_code)]
    Err("installer update is not supported on this platform".to_string())
}

#[cfg(target_os = "windows")]
fn spawn_installer_launcher_windows(installer_path: &Path, app_pid: u32) -> Result<(), String> {
    let installer = installer_path.to_string_lossy().replace('\'', "''");
    let ext = installer_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let launch = if ext == "msi" {
        format!(
            "Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i','{}'",
            installer
        )
    } else {
        format!("Start-Process -FilePath '{}'", installer)
    };
    let script = format!(
        "$pidToWait={app_pid}; while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) {{ Start-Sleep -Milliseconds 300 }}; \
Get-Process opencode-studio -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; \
Get-Process opencode-studio-desktop -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; \
{launch}"
    );

    StdCommand::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .spawn()
        .map_err(|err| format!("spawn installer launcher: {err}"))?;
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn spawn_installer_launcher_unix(
    installer_path: &Path,
    app_pid: u32,
    is_macos: bool,
) -> Result<(), String> {
    let quoted_path = shell_quote(installer_path.to_string_lossy().as_ref());
    let ext = installer_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let launch = if is_macos {
        format!("open {quoted_path}")
    } else if ext == "appimage" {
        format!("chmod +x {quoted_path}; {quoted_path}")
    } else {
        format!("xdg-open {quoted_path}")
    };

    let script = format!(
        "while kill -0 {app_pid} 2>/dev/null; do sleep 0.3; done; \
pkill -x opencode-studio >/dev/null 2>&1 || true; \
pkill -x opencode-studio-desktop >/dev/null 2>&1 || true; \
({launch}) >/dev/null 2>&1 &"
    );

    StdCommand::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .spawn()
        .map_err(|err| format!("spawn installer launcher: {err}"))?;
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn shell_quote(input: &str) -> String {
    format!("'{}'", input.replace('\'', "'\"'\"'"))
}
