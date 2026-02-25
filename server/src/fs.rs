use std::{
    collections::HashSet,
    ffi::OsStr,
    path::{Component, Path, PathBuf},
    time::Instant,
};

use std::sync::Arc;

use crate::{ApiResult, AppError};
use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use ignore::WalkBuilder;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::path_utils::{home_dir_env, normalize_directory_path};

const DEFAULT_FILE_SEARCH_LIMIT: usize = 60;
const MAX_FILE_SEARCH_LIMIT: usize = 400;
const MAX_FS_LIST_LIMIT: usize = 2000;

const DEFAULT_CONTENT_SEARCH_MAX_RESULTS: usize = 1200;
const MAX_CONTENT_SEARCH_MAX_RESULTS: usize = 5000;
const DEFAULT_CONTENT_SEARCH_MAX_MATCHES_PER_FILE: usize = 80;
const MAX_CONTENT_SEARCH_MAX_MATCHES_PER_FILE: usize = 300;
const DEFAULT_CONTENT_SEARCH_CONTEXT_CHARS: usize = 48;
const MAX_CONTENT_SEARCH_CONTEXT_CHARS: usize = 160;
const MAX_CONTENT_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_CONTENT_REPLACE_PATHS: usize = 4000;

const FILE_SEARCH_EXCLUDED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
    "tmp",
    "logs",
];

fn has_parent_dir_component(p: &Path) -> bool {
    p.components().any(|c| matches!(c, Component::ParentDir))
}

fn resolve_path(input: &str) -> PathBuf {
    let normalized = normalize_directory_path(input);
    PathBuf::from(normalized)
}

fn is_windows_style_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn normalize_for_workspace_compare(path: &Path) -> String {
    let mut normalized = path
        .components()
        .collect::<PathBuf>()
        .to_string_lossy()
        .replace('\\', "/");

    if normalized.len() > 1 {
        normalized = normalized.trim_end_matches('/').to_string();
    }

    if cfg!(windows) || is_windows_style_path(&normalized) {
        normalized = normalized.to_ascii_lowercase();
    }

    normalized
}

fn is_path_within_base(base: &str, target: &str) -> bool {
    if target == base {
        return true;
    }
    if base == "/" {
        return target.starts_with('/');
    }

    target
        .strip_prefix(base)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

fn to_api_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn ensure_within_base(base: &Path, target: &Path) -> ApiResult<()> {
    let base = normalize_for_workspace_compare(base);
    let target = normalize_for_workspace_compare(target);

    if !is_path_within_base(&base, &target) {
        return Err(AppError::bad_request("Path is outside of active workspace"));
    }
    Ok(())
}

pub(crate) async fn validate_directory(candidate: &str) -> ApiResult<PathBuf> {
    let resolved = resolve_path(candidate);
    if resolved.as_os_str().is_empty() {
        return Err(AppError::bad_request("Directory parameter is required"));
    }

    let abs = if resolved.is_absolute() {
        resolved
    } else {
        // Treat relative paths as relative to cwd.
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(resolved)
    };

    let meta = tokio::fs::metadata(&abs)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => "Directory not found".to_string(),
            std::io::ErrorKind::PermissionDenied => "Access to directory denied".to_string(),
            _ => "Failed to validate directory".to_string(),
        })
        .map_err(AppError::bad_request)?;
    if !meta.is_dir() {
        return Err(AppError::bad_request("Specified path is not a directory"));
    }
    Ok(abs)
}

#[derive(Debug, Deserialize)]
pub struct ProjectDirQuery {
    pub directory: Option<String>,
}

pub async fn resolve_project_directory(
    _state: &crate::AppState,
    headers: &HeaderMap,
    query_directory: Option<&str>,
) -> ApiResult<PathBuf> {
    let header_directory = headers
        .get("x-opencode-directory")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim())
        .filter(|v| !v.is_empty());

    let requested =
        header_directory.or(query_directory.map(|v| v.trim()).filter(|v| !v.is_empty()));

    if let Some(req) = requested {
        return validate_directory(req).await;
    }

    Err(AppError::bad_request("Directory parameter is required"))
}

async fn resolve_workspace_path_from_context(
    state: &crate::AppState,
    headers: &HeaderMap,
    query_directory: Option<&str>,
    target: &str,
) -> ApiResult<(PathBuf, PathBuf)> {
    let base = resolve_project_directory(state, headers, query_directory).await?;

    let target_trimmed = target.trim();
    if target_trimmed.is_empty() {
        return Err(AppError::bad_request("Path is required"));
    }

    let normalized = normalize_directory_path(target_trimmed);
    let mut candidate = PathBuf::from(normalized);
    if !candidate.is_absolute() {
        candidate = base.join(candidate);
    }

    // Normalize away '.' segments; reject any '..' segment.
    if has_parent_dir_component(&candidate) {
        return Err(AppError::bad_request(
            "Invalid path: path traversal not allowed",
        ));
    }

    // Important: avoid canonicalize here because the path may not exist yet.
    ensure_within_base(&base, &candidate)?;
    Ok((base, candidate))
}

#[derive(Debug, Serialize)]
pub struct FsHomeResponse {
    pub home: String,
}

#[derive(Debug, Serialize)]
pub struct SuccessPathResponse {
    pub success: bool,
    pub path: String,
}

pub async fn fs_home() -> ApiResult<Json<FsHomeResponse>> {
    let home = home_dir_env().unwrap_or_default();
    if home.trim().is_empty() {
        return Err(AppError::internal("Failed to resolve home directory"));
    }
    Ok(Json(FsHomeResponse { home }))
}

#[derive(Debug, Deserialize)]
pub struct MkdirBody {
    pub path: Option<String>,
}

pub async fn fs_mkdir(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(q): Query<ProjectDirQuery>,
    Json(body): Json<MkdirBody>,
) -> ApiResult<Json<SuccessPathResponse>> {
    let dir_path = body
        .path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::bad_request("Path is required"))?;

    let (_base, resolved) = resolve_workspace_path_from_context(
        state.as_ref(),
        &headers,
        q.directory.as_deref(),
        dir_path,
    )
    .await?;

    tokio::fs::create_dir_all(&resolved).await.map_err(|err| {
        if err.kind() == std::io::ErrorKind::PermissionDenied {
            AppError::forbidden("Access denied")
        } else {
            AppError::internal(err.to_string())
        }
    })?;

    Ok(Json(SuccessPathResponse {
        success: true,
        path: to_api_path(&resolved),
    }))
}

#[derive(Debug, Deserialize)]
pub struct ReadQuery {
    pub path: Option<String>,
}

const MAX_READ_BYTES: u64 = 50 * 1024 * 1024;
pub(crate) const MAX_UPLOAD_BYTES: usize = MAX_READ_BYTES as usize;

pub async fn fs_read(Query(q): Query<ReadQuery>) -> ApiResult<Response> {
    let file_path = q.path.unwrap_or_default();
    let file_path = file_path.trim();
    if file_path.is_empty() {
        return Err(AppError::bad_request("Path is required"));
    }

    let resolved = resolve_path(file_path);
    if has_parent_dir_component(&resolved) {
        return Err(AppError::bad_request(
            "Invalid path: path traversal not allowed",
        ));
    }

    let abs = if resolved.is_absolute() {
        resolved
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(resolved)
    };

    let meta = tokio::fs::metadata(&abs)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => AppError::not_found("File not found"),
            std::io::ErrorKind::PermissionDenied => AppError::forbidden("Access to file denied"),
            _ => AppError::internal("Failed to read file"),
        })?;

    if !meta.is_file() {
        return Err(AppError::bad_request("Specified path is not a file"));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(AppError::payload_too_large("File too large"));
    }

    let content = tokio::fs::read_to_string(&abs)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => AppError::not_found("File not found"),
            std::io::ErrorKind::PermissionDenied => AppError::forbidden("Access to file denied"),
            _ => AppError::internal(err.to_string()),
        })?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/plain")
        .body(Body::from(content))
        .unwrap())
}

fn mime_for_ext(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

pub async fn fs_raw(Query(q): Query<ReadQuery>) -> ApiResult<Response> {
    let file_path = q.path.unwrap_or_default();
    let file_path = file_path.trim();
    if file_path.is_empty() {
        return Err(AppError::bad_request("Path is required"));
    }

    let resolved = resolve_path(file_path);
    if has_parent_dir_component(&resolved) {
        return Err(AppError::bad_request(
            "Invalid path: path traversal not allowed",
        ));
    }

    let abs = if resolved.is_absolute() {
        resolved
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(resolved)
    };

    let meta = tokio::fs::metadata(&abs)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => AppError::not_found("File not found"),
            std::io::ErrorKind::PermissionDenied => AppError::forbidden("Access to file denied"),
            _ => AppError::internal("Failed to read file"),
        })?;

    if !meta.is_file() {
        return Err(AppError::bad_request("Specified path is not a file"));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(AppError::payload_too_large("File too large"));
    }

    let mime = mime_for_ext(&abs);
    let content = tokio::fs::read(&abs)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => AppError::not_found("File not found"),
            std::io::ErrorKind::PermissionDenied => AppError::forbidden("Access to file denied"),
            _ => AppError::internal(err.to_string()),
        })?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("cache-control", "no-store")
        .header("content-type", mime)
        .body(Body::from(content))
        .unwrap())
}

#[derive(Debug, Deserialize)]
pub struct FsPathQuery {
    pub directory: Option<String>,
    pub path: Option<String>,
}

fn content_disposition_attachment(path: &Path) -> String {
    let raw = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".to_string());

    // RFC 6266: provide both ASCII fallback and UTF-8 filename*.
    let mut ascii = String::with_capacity(raw.len());
    for ch in raw.chars() {
        let ok = ch.is_ascii() && !matches!(ch, '"' | '\\') && !ch.is_ascii_control();
        ascii.push(if ok { ch } else { '_' });
    }
    if ascii.trim().is_empty() {
        ascii = "download".to_string();
    }

    let encoded = urlencoding::encode(&raw);
    format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        ascii, encoded
    )
}

pub async fn fs_download(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(q): Query<FsPathQuery>,
) -> ApiResult<Response> {
    let file_path = q
        .path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::bad_request("Path is required"))?;

    let (_base, abs) = resolve_workspace_path_from_context(
        state.as_ref(),
        &headers,
        q.directory.as_deref(),
        file_path,
    )
    .await?;

    let meta = tokio::fs::metadata(&abs)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => AppError::not_found("File not found"),
            std::io::ErrorKind::PermissionDenied => AppError::forbidden("Access to file denied"),
            _ => AppError::internal("Failed to read file"),
        })?;

    if !meta.is_file() {
        return Err(AppError::bad_request("Specified path is not a file"));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(AppError::payload_too_large("File too large"));
    }

    let mime = mime_for_ext(&abs);
    let content = tokio::fs::read(&abs)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => AppError::not_found("File not found"),
            std::io::ErrorKind::PermissionDenied => AppError::forbidden("Access to file denied"),
            _ => AppError::internal(err.to_string()),
        })?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("cache-control", "no-store")
        .header("content-type", mime)
        .header("content-disposition", content_disposition_attachment(&abs))
        .body(Body::from(content))
        .unwrap())
}

#[derive(Debug, Deserialize)]
pub struct UploadQuery {
    pub directory: Option<String>,
    pub path: Option<String>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub success: bool,
    pub path: String,
    pub bytes: usize,
}

pub async fn fs_upload(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(q): Query<UploadQuery>,
    payload: Bytes,
) -> ApiResult<Json<UploadResponse>> {
    let file_path = q
        .path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::bad_request("Path is required"))?;

    let bytes_len = payload.len();
    if bytes_len > MAX_UPLOAD_BYTES {
        return Err(AppError::payload_too_large("File too large"));
    }

    let overwrite = q.overwrite.unwrap_or(false);

    let (_base, resolved) = resolve_workspace_path_from_context(
        state.as_ref(),
        &headers,
        q.directory.as_deref(),
        file_path,
    )
    .await?;

    if !overwrite {
        match tokio::fs::symlink_metadata(&resolved).await {
            Ok(meta) => {
                if meta.is_dir() {
                    return Err(AppError::bad_request("Target path is a directory"));
                }
                return Err(AppError::bad_request("File already exists"));
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(AppError::forbidden("Access denied"));
            }
            Err(err) => return Err(AppError::internal(err.to_string())),
        }
    }

    if let Some(parent) = resolved.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|err| {
            if err.kind() == std::io::ErrorKind::PermissionDenied {
                AppError::forbidden("Access denied")
            } else {
                AppError::internal(err.to_string())
            }
        })?;
    }

    tokio::fs::write(&resolved, payload.as_ref())
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::PermissionDenied => AppError::forbidden("Access denied"),
            std::io::ErrorKind::IsADirectory => AppError::bad_request("Target path is a directory"),
            _ => AppError::internal(err.to_string()),
        })?;

    let upload_mime = mime_for_ext(&resolved);
    if let Err(err) = state
        .attachment_cache
        .register_uploaded_file(&resolved, payload.as_ref(), upload_mime)
        .await
    {
        tracing::warn!(
            target: "opencode_studio.attachment_cache",
            path = %resolved.display(),
            error = %err,
            "failed to register uploaded file in attachment cache"
        );
    }

    Ok(Json(UploadResponse {
        success: true,
        path: to_api_path(&resolved),
        bytes: bytes_len,
    }))
}

#[derive(Debug, Deserialize)]
pub struct WriteBody {
    pub path: Option<String>,
    pub content: Option<String>,
}

pub async fn fs_write(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(q): Query<ProjectDirQuery>,
    Json(body): Json<WriteBody>,
) -> ApiResult<Json<SuccessPathResponse>> {
    let file_path = body
        .path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::bad_request("Path is required"))?;
    let content = body
        .content
        .ok_or_else(|| AppError::bad_request("Content is required"))?;

    if content.len() as u64 > MAX_READ_BYTES {
        return Err(AppError::payload_too_large("Content too large"));
    }

    let (_base, resolved) = resolve_workspace_path_from_context(
        state.as_ref(),
        &headers,
        q.directory.as_deref(),
        file_path,
    )
    .await?;

    if let Some(parent) = resolved.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|err| {
            if err.kind() == std::io::ErrorKind::PermissionDenied {
                AppError::forbidden("Access denied")
            } else {
                AppError::internal(err.to_string())
            }
        })?;
    }

    tokio::fs::write(&resolved, content).await.map_err(|err| {
        if err.kind() == std::io::ErrorKind::PermissionDenied {
            AppError::forbidden("Access denied")
        } else {
            AppError::internal(err.to_string())
        }
    })?;

    Ok(Json(SuccessPathResponse {
        success: true,
        path: to_api_path(&resolved),
    }))
}

#[derive(Debug, Deserialize)]
pub struct DeleteBody {
    pub path: Option<String>,
}

pub async fn fs_delete(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(q): Query<ProjectDirQuery>,
    Json(body): Json<DeleteBody>,
) -> ApiResult<Json<SuccessPathResponse>> {
    let target_path = body
        .path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::bad_request("Path is required"))?;

    let (_base, resolved) = resolve_workspace_path_from_context(
        state.as_ref(),
        &headers,
        q.directory.as_deref(),
        target_path,
    )
    .await?;

    let meta = match tokio::fs::symlink_metadata(&resolved).await {
        Ok(m) => Some(m),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err(AppError::forbidden("Access denied"));
        }
        Err(err) => return Err(AppError::internal(err.to_string())),
    };

    if meta.is_none() {
        // Match client "force: true" behavior.
        return Ok(Json(SuccessPathResponse {
            success: true,
            path: to_api_path(&resolved),
        }));
    }

    let meta = meta.unwrap();
    if meta.is_dir() {
        tokio::fs::remove_dir_all(&resolved).await
    } else {
        tokio::fs::remove_file(&resolved).await
    }
    .map_err(|err| {
        if err.kind() == std::io::ErrorKind::PermissionDenied {
            AppError::forbidden("Access denied")
        } else {
            AppError::internal(err.to_string())
        }
    })?;

    Ok(Json(SuccessPathResponse {
        success: true,
        path: to_api_path(&resolved),
    }))
}

#[derive(Debug, Deserialize)]
pub struct RenameBody {
    #[serde(rename = "oldPath")]
    pub old_path: Option<String>,
    #[serde(rename = "newPath")]
    pub new_path: Option<String>,
}

pub async fn fs_rename(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(q): Query<ProjectDirQuery>,
    Json(body): Json<RenameBody>,
) -> ApiResult<Json<SuccessPathResponse>> {
    let old_path = body
        .old_path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::bad_request("oldPath is required"))?;
    let new_path = body
        .new_path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::bad_request("newPath is required"))?;

    let (base_old, resolved_old) = resolve_workspace_path_from_context(
        state.as_ref(),
        &headers,
        q.directory.as_deref(),
        old_path,
    )
    .await?;
    let (base_new, resolved_new) = resolve_workspace_path_from_context(
        state.as_ref(),
        &headers,
        q.directory.as_deref(),
        new_path,
    )
    .await?;

    if normalize_for_workspace_compare(&base_old) != normalize_for_workspace_compare(&base_new) {
        return Err(AppError::bad_request(
            "Source and destination must share the same workspace root",
        ));
    }

    tokio::fs::rename(&resolved_old, &resolved_new)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => AppError::not_found("Source path not found"),
            std::io::ErrorKind::PermissionDenied => AppError::forbidden("Access denied"),
            _ => AppError::internal(err.to_string()),
        })?;

    Ok(Json(SuccessPathResponse {
        success: true,
        path: to_api_path(&resolved_new),
    }))
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub path: Option<String>,
    #[serde(rename = "respectGitignore")]
    pub respect_gitignore: Option<bool>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_file: bool,
    pub is_symbolic_link: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    pub path: String,
    pub entries: Vec<ListEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    pub total: usize,
    pub has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<usize>,
}

async fn git_check_ignore(dir: &Path, names: &[String]) -> HashSet<String> {
    if names.is_empty() {
        return HashSet::new();
    }

    let mut cmd = Command::new("git");
    cmd.arg("check-ignore").arg("--");
    for n in names {
        cmd.arg(n);
    }
    cmd.current_dir(dir);
    cmd.stdin(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());

    let out = match cmd.output().await {
        Ok(out) if out.status.success() => out,
        _ => return HashSet::new(),
    };

    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

pub async fn fs_list(Query(q): Query<ListQuery>) -> ApiResult<Json<ListResponse>> {
    let raw_path = q
        .path
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .unwrap_or_else(|| home_dir_env().unwrap_or_default());
    let respect_gitignore = q.respect_gitignore.unwrap_or(false);

    let resolved = resolve_path(&raw_path);
    let abs = if resolved.is_absolute() {
        resolved
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(resolved)
    };

    let meta = tokio::fs::metadata(&abs)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => AppError::not_found("Directory not found"),
            std::io::ErrorKind::PermissionDenied => {
                AppError::forbidden("Access to directory denied")
            }
            _ => AppError::internal("Failed to list directory"),
        })?;
    if !meta.is_dir() {
        return Err(AppError::bad_request("Specified path is not a directory"));
    }

    let mut rd = tokio::fs::read_dir(&abs)
        .await
        .map_err(|err| AppError::internal(err.to_string()))?;

    let mut raw_entries = Vec::new();
    let mut names = Vec::new();
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        names.push(name.clone());
        raw_entries.push(entry);
    }

    let ignored = if respect_gitignore {
        git_check_ignore(&abs, &names).await
    } else {
        HashSet::new()
    };

    let mut entries = Vec::new();
    for entry in raw_entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if respect_gitignore && ignored.contains(&name) {
            continue;
        }

        let path = entry.path();
        let ft = match entry.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let is_symbolic_link = ft.is_symlink();
        let mut is_directory = ft.is_dir();
        if !is_directory
            && is_symbolic_link
            && let Ok(st) = tokio::fs::metadata(&path).await
        {
            is_directory = st.is_dir();
        }

        entries.push(ListEntry {
            name,
            path: to_api_path(&path),
            is_directory,
            is_file: ft.is_file(),
            is_symbolic_link,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));

    let total = entries.len();
    let offset = q.offset.unwrap_or(0).min(total);
    let limit = q
        .limit
        .map(|v| v.clamp(1, MAX_FS_LIST_LIMIT))
        .filter(|v| *v > 0);

    let (page_entries, has_more, next_offset) = if let Some(limit) = limit {
        let end = offset.saturating_add(limit).min(total);
        let has_more = end < total;
        let next_offset = if has_more { Some(end) } else { None };
        (entries[offset..end].to_vec(), has_more, next_offset)
    } else if offset > 0 {
        (entries[offset..].to_vec(), false, None)
    } else {
        (entries, false, None)
    };

    Ok(Json(ListResponse {
        path: to_api_path(&abs),
        entries: page_entries,
        offset: if q.limit.is_some() || offset > 0 {
            Some(offset)
        } else {
            None
        },
        limit,
        total,
        has_more,
        next_offset,
    }))
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub root: Option<String>,
    pub directory: Option<String>,
    pub q: Option<String>,
    #[serde(rename = "includeHidden")]
    pub include_hidden: Option<bool>,
    #[serde(rename = "respectGitignore")]
    pub respect_gitignore: Option<bool>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFile {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub root: String,
    pub count: usize,
    pub files: Vec<SearchFile>,
}

fn normalize_relative_search_path(root: &Path, target: &Path) -> String {
    let rel = target
        .strip_prefix(root)
        .ok()
        .and_then(|p| {
            if p.as_os_str().is_empty() {
                None
            } else {
                Some(p)
            }
        })
        .unwrap_or_else(|| target.file_name().map(Path::new).unwrap_or(target));
    rel.to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}

fn fuzzy_match_score_normalized(query: &str, candidate: &str) -> Option<i32> {
    if query.is_empty() {
        return Some(0);
    }

    let q = query;
    let c = candidate.to_ascii_lowercase();

    if let Some(idx) = c.find(q) {
        let bonus = if idx == 0 {
            20
        } else {
            let prev = c.as_bytes()[idx.saturating_sub(1)] as char;
            if prev == '/' || prev == '_' || prev == '-' || prev == '.' || prev == ' ' {
                15
            } else {
                0
            }
        };
        let score = 100 + bonus - (idx.min(20) as i32) - ((c.len() / 5) as i32);
        return Some(score);
    }

    let mut score: i32 = 0;
    let mut last_index: i32 = -1;
    let mut consecutive: i32 = 0;

    for ch in q.chars() {
        if ch == ' ' {
            continue;
        }
        let start = (last_index + 1).max(0) as usize;
        let idx = match c[start..].find(ch) {
            Some(pos) => (start + pos) as i32,
            None => return None,
        };

        let gap = idx - last_index - 1;
        if gap == 0 {
            consecutive += 1;
        } else {
            consecutive = 0;
        }

        score += 10;
        score += (18 - idx).max(0);
        score -= gap.min(10);

        if idx == 0 {
            score += 12;
        } else {
            let prev = c.as_bytes()[(idx - 1) as usize] as char;
            if prev == '/' || prev == '_' || prev == '-' || prev == '.' || prev == ' ' {
                score += 10;
            }
        }

        if consecutive > 0 {
            score += 12;
        }

        last_index = idx;
    }

    score += (24 - (c.len() as i32 / 3)).max(0);
    Some(score)
}

pub async fn fs_search(Query(q): Query<SearchQuery>) -> ApiResult<Json<SearchResponse>> {
    let raw_root = q
        .root
        .or(q.directory)
        .unwrap_or_else(|| home_dir_env().unwrap_or_default());
    let raw_query = q.q.unwrap_or_default();
    let include_hidden = q.include_hidden.unwrap_or(false);
    let respect_gitignore = q.respect_gitignore.unwrap_or(true);

    let limit = q
        .limit
        .unwrap_or(DEFAULT_FILE_SEARCH_LIMIT)
        .clamp(1, MAX_FILE_SEARCH_LIMIT);

    let resolved_root = resolve_path(&raw_root);
    let abs_root = if resolved_root.is_absolute() {
        resolved_root
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(resolved_root)
    };

    let stats = tokio::fs::metadata(&abs_root)
        .await
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => AppError::not_found("Directory not found"),
            std::io::ErrorKind::PermissionDenied => {
                AppError::forbidden("Access to directory denied")
            }
            _ => AppError::internal("Failed to search files"),
        })?;
    if !stats.is_dir() {
        return Err(AppError::bad_request("Specified root is not a directory"));
    }

    let query_norm = raw_query.trim().to_ascii_lowercase();
    let match_all = query_norm.is_empty();
    let collect_limit = if match_all {
        limit
    } else {
        (limit * 3).max(200)
    };

    let excluded: HashSet<&'static str> = FILE_SEARCH_EXCLUDED_DIRS.iter().copied().collect();
    let started = Instant::now();

    let abs_root_for_filter = abs_root.clone();
    let mut builder = WalkBuilder::new(&abs_root);
    builder.hidden(!include_hidden);
    if !respect_gitignore {
        builder.git_ignore(false);
        builder.git_global(false);
        builder.git_exclude(false);
        builder.parents(false);
    }
    builder.follow_links(false);

    let mut candidates: Vec<(SearchFile, i32)> = Vec::new();

    for result in builder
        .filter_entry(move |entry| {
            let path = entry.path();
            if path == abs_root_for_filter {
                return true;
            }
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                return true;
            };

            let lower = name.to_ascii_lowercase();
            if excluded.contains(lower.as_str()) {
                return false;
            }
            if !include_hidden && name.starts_with('.') {
                return false;
            }
            true
        })
        .build()
    {
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }

        let path = entry.path().to_path_buf();
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }

        let relative_path = normalize_relative_search_path(&abs_root, &path);
        let extension = name
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_ascii_lowercase())
            .filter(|ext| !ext.is_empty());

        let score = if match_all {
            0
        } else {
            match fuzzy_match_score_normalized(&query_norm, &relative_path) {
                Some(score) => score,
                None => continue,
            }
        };

        candidates.push((
            SearchFile {
                name,
                path: to_api_path(&path),
                relative_path,
                extension,
            },
            score,
        ));

        if candidates.len() >= collect_limit {
            break;
        }
    }

    if !match_all {
        candidates.sort_by(|(a, sa), (b, sb)| {
            sb.cmp(sa)
                .then_with(|| a.relative_path.len().cmp(&b.relative_path.len()))
                .then_with(|| a.relative_path.cmp(&b.relative_path))
        });
    }

    let files = candidates
        .into_iter()
        .take(limit)
        .map(|(f, _)| f)
        .collect::<Vec<_>>();

    tracing::debug!(
        "fs_search root={} q='{}' count={} elapsed_ms={}",
        abs_root.to_string_lossy(),
        raw_query,
        files.len(),
        started.elapsed().as_millis()
    );

    Ok(Json(SearchResponse {
        root: to_api_path(&abs_root),
        count: files.len(),
        files,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchBody {
    pub query: Option<String>,
    pub paths: Option<Vec<String>>,
    pub include_hidden: Option<bool>,
    pub respect_gitignore: Option<bool>,
    pub is_regex: Option<bool>,
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub max_results: Option<usize>,
    pub max_matches_per_file: Option<usize>,
    pub context_chars: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchMatch {
    pub line: usize,
    pub start_column: usize,
    pub end_column: usize,
    pub start_offset: usize,
    pub end_offset: usize,
    pub before: String,
    pub matched: String,
    pub after: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchFileResult {
    pub path: String,
    pub relative_path: String,
    pub match_count: usize,
    pub matches: Vec<ContentSearchMatch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResponse {
    pub root: String,
    pub query: String,
    pub file_count: usize,
    pub match_count: usize,
    pub files: Vec<ContentSearchFileResult>,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentReplaceMatchRef {
    pub path: Option<String>,
    pub start_offset: Option<usize>,
    pub end_offset: Option<usize>,
    pub expected: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentReplaceBody {
    pub query: Option<String>,
    pub replace: Option<String>,
    pub include_hidden: Option<bool>,
    pub respect_gitignore: Option<bool>,
    pub is_regex: Option<bool>,
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub paths: Option<Vec<String>>,
    pub r#match: Option<ContentReplaceMatchRef>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentReplaceFileResult {
    pub path: String,
    pub relative_path: String,
    pub replacements: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentReplaceResponse {
    pub root: String,
    pub file_count: usize,
    pub replacement_count: usize,
    pub skipped: usize,
    pub files: Vec<ContentReplaceFileResult>,
}

fn resolve_path_within_workspace(base: &Path, target: &str) -> ApiResult<PathBuf> {
    let target_trimmed = target.trim();
    if target_trimmed.is_empty() {
        return Err(AppError::bad_request("Path is required"));
    }

    let normalized = normalize_directory_path(target_trimmed);
    let mut candidate = PathBuf::from(normalized);
    if !candidate.is_absolute() {
        candidate = base.join(candidate);
    }

    if has_parent_dir_component(&candidate) {
        return Err(AppError::bad_request(
            "Invalid path: path traversal not allowed",
        ));
    }
    ensure_within_base(base, &candidate)?;
    Ok(candidate)
}

fn build_content_regex(
    query: &str,
    is_regex: bool,
    case_sensitive: bool,
    whole_word: bool,
) -> ApiResult<Regex> {
    let q = query.trim();
    if q.is_empty() {
        return Err(AppError::bad_request("Search query is required"));
    }

    let mut pattern = if is_regex {
        q.to_string()
    } else {
        regex::escape(q)
    };

    if whole_word {
        pattern = format!(r"\b(?:{})\b", pattern);
    }

    let mut builder = RegexBuilder::new(&pattern);
    builder.case_insensitive(!case_sensitive);

    let regex = builder
        .build()
        .map_err(|err| AppError::bad_request(format!("Invalid search pattern: {}", err)))?;

    if regex.is_match("") {
        return Err(AppError::bad_request(
            "Search pattern matches empty string; refine the query",
        ));
    }

    Ok(regex)
}

fn walk_workspace_files(
    root: &Path,
    include_hidden: bool,
    respect_gitignore: bool,
    max_files: usize,
) -> Vec<PathBuf> {
    let excluded: HashSet<&'static str> = FILE_SEARCH_EXCLUDED_DIRS.iter().copied().collect();
    let root_for_filter = root.to_path_buf();

    let mut builder = WalkBuilder::new(root);
    builder.hidden(!include_hidden);
    if !respect_gitignore {
        builder.git_ignore(false);
        builder.git_global(false);
        builder.git_exclude(false);
        builder.parents(false);
    }
    builder.follow_links(false);

    let mut files = Vec::new();

    for result in builder
        .filter_entry(move |entry| {
            let path = entry.path();
            if path == root_for_filter {
                return true;
            }

            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                return true;
            };

            let lower = name.to_ascii_lowercase();
            if excluded.contains(lower.as_str()) {
                return false;
            }
            if !include_hidden && name.starts_with('.') {
                return false;
            }
            true
        })
        .build()
    {
        let entry = match result {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }

        files.push(entry.path().to_path_buf());
        if files.len() >= max_files {
            break;
        }
    }

    files
}

async fn normalize_content_scope_paths(
    root: &Path,
    paths: &[String],
    include_hidden: bool,
    respect_gitignore: bool,
) -> ApiResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for raw in paths.iter().take(MAX_CONTENT_REPLACE_PATHS) {
        let resolved = resolve_path_within_workspace(root, raw)?;

        let meta = match tokio::fs::metadata(&resolved).await {
            Ok(meta) => meta,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => continue,
            Err(err) => return Err(AppError::internal(err.to_string())),
        };

        if meta.is_file() {
            let key = resolved.to_string_lossy().into_owned();
            if seen.insert(key) {
                out.push(resolved);
            }
            continue;
        }

        if !meta.is_dir() {
            continue;
        }

        let nested = walk_workspace_files(
            &resolved,
            include_hidden,
            respect_gitignore,
            MAX_CONTENT_REPLACE_PATHS.saturating_sub(out.len()),
        );
        for file in nested {
            if !file.starts_with(root) {
                continue;
            }
            let key = file.to_string_lossy().into_owned();
            if seen.insert(key) {
                out.push(file);
            }
            if out.len() >= MAX_CONTENT_REPLACE_PATHS {
                return Ok(out);
            }
        }
    }

    Ok(out)
}

async fn read_searchable_text(path: &Path) -> Option<String> {
    let meta = tokio::fs::metadata(path).await.ok()?;
    if !meta.is_file() || meta.len() > MAX_CONTENT_SEARCH_FILE_BYTES {
        return None;
    }

    let bytes = tokio::fs::read(path).await.ok()?;
    if bytes.contains(&0) {
        return None;
    }

    String::from_utf8(bytes).ok()
}

fn line_starts(content: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (idx, b) in content.as_bytes().iter().enumerate() {
        if *b == b'\n' && idx + 1 < content.len() {
            starts.push(idx + 1);
        }
    }
    starts
}

fn line_index_for_offset(starts: &[usize], offset: usize) -> usize {
    match starts.binary_search(&offset) {
        Ok(i) => i,
        Err(i) => i.saturating_sub(1),
    }
}

fn line_bounds(content: &str, starts: &[usize], line_index: usize) -> (usize, usize) {
    let start = starts.get(line_index).copied().unwrap_or(0);
    let mut end = starts
        .get(line_index + 1)
        .copied()
        .unwrap_or(content.len())
        .min(content.len());

    if end > start && content.as_bytes().get(end.saturating_sub(1)) == Some(&b'\n') {
        end = end.saturating_sub(1);
    }
    if end > start && content.as_bytes().get(end.saturating_sub(1)) == Some(&b'\r') {
        end = end.saturating_sub(1);
    }

    (start, end)
}

fn take_last_chars(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }

    let total = input.chars().count();
    if total <= max_chars {
        return input.to_string();
    }

    let skip = total.saturating_sub(max_chars);
    input.chars().skip(skip).collect()
}

fn take_first_chars(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    input.chars().take(max_chars).collect()
}

fn collect_content_matches(
    content: &str,
    regex: &Regex,
    max_matches: usize,
    context_chars: usize,
) -> (Vec<ContentSearchMatch>, bool) {
    let mut matches = Vec::new();
    let starts = line_starts(content);
    let mut truncated = false;

    for found in regex.find_iter(content) {
        if matches.len() >= max_matches {
            truncated = true;
            break;
        }

        let start_offset = found.start();
        let end_offset = found.end();
        let line_index = line_index_for_offset(&starts, start_offset);
        let (line_start, line_end) = line_bounds(content, &starts, line_index);
        let line_text = &content[line_start..line_end];

        let start_in_line = start_offset.saturating_sub(line_start).min(line_text.len());
        let end_in_line = end_offset.saturating_sub(line_start).min(line_text.len());

        let before_full = &line_text[..start_in_line];
        let matched_full = if end_in_line > start_in_line {
            line_text[start_in_line..end_in_line].to_string()
        } else {
            found
                .as_str()
                .lines()
                .next()
                .unwrap_or_default()
                .to_string()
        };
        let after_full = if end_in_line < line_text.len() {
            &line_text[end_in_line..]
        } else {
            ""
        };

        let before = take_last_chars(before_full, context_chars);
        let after = take_first_chars(after_full, context_chars);

        let start_column = before_full.chars().count() + 1;
        let end_column = start_column + matched_full.chars().count();

        matches.push(ContentSearchMatch {
            line: line_index + 1,
            start_column,
            end_column,
            start_offset,
            end_offset,
            before,
            matched: matched_full,
            after,
        });
    }

    (matches, truncated)
}

pub async fn fs_content_search(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(q): Query<ProjectDirQuery>,
    Json(body): Json<ContentSearchBody>,
) -> ApiResult<Json<ContentSearchResponse>> {
    let root = resolve_project_directory(state.as_ref(), &headers, q.directory.as_deref()).await?;

    let query = body
        .query
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .ok_or_else(|| AppError::bad_request("Search query is required"))?
        .to_string();

    let include_hidden = body.include_hidden.unwrap_or(false);
    let respect_gitignore = body.respect_gitignore.unwrap_or(true);
    let is_regex = body.is_regex.unwrap_or(false);
    let case_sensitive = body.case_sensitive.unwrap_or(false);
    let whole_word = body.whole_word.unwrap_or(false);
    let max_results = body
        .max_results
        .unwrap_or(DEFAULT_CONTENT_SEARCH_MAX_RESULTS)
        .clamp(1, MAX_CONTENT_SEARCH_MAX_RESULTS);
    let max_matches_per_file = body
        .max_matches_per_file
        .unwrap_or(DEFAULT_CONTENT_SEARCH_MAX_MATCHES_PER_FILE)
        .clamp(1, MAX_CONTENT_SEARCH_MAX_MATCHES_PER_FILE);
    let context_chars = body
        .context_chars
        .unwrap_or(DEFAULT_CONTENT_SEARCH_CONTEXT_CHARS)
        .clamp(0, MAX_CONTENT_SEARCH_CONTEXT_CHARS);

    let regex = build_content_regex(&query, is_regex, case_sensitive, whole_word)?;
    let started = Instant::now();

    let candidates = if let Some(paths) = body.paths.as_deref() {
        normalize_content_scope_paths(&root, paths, include_hidden, respect_gitignore).await?
    } else {
        walk_workspace_files(
            &root,
            include_hidden,
            respect_gitignore,
            MAX_CONTENT_REPLACE_PATHS,
        )
    };

    let mut files = Vec::new();
    let mut total_matches = 0usize;
    let mut truncated = false;

    for path in candidates {
        if total_matches >= max_results {
            truncated = true;
            break;
        }

        let Some(content) = read_searchable_text(&path).await else {
            continue;
        };

        let remaining = max_results.saturating_sub(total_matches);
        let max_for_file = max_matches_per_file.min(remaining);
        if max_for_file == 0 {
            truncated = true;
            break;
        }

        let (matches, file_truncated) =
            collect_content_matches(&content, &regex, max_for_file, context_chars);
        if matches.is_empty() {
            continue;
        }

        total_matches += matches.len();
        truncated |= file_truncated;

        let relative_path = normalize_relative_search_path(&root, &path);
        files.push(ContentSearchFileResult {
            path: to_api_path(&path),
            relative_path,
            match_count: matches.len(),
            matches,
        });

        if total_matches >= max_results {
            truncated = true;
            break;
        }
    }

    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    tracing::debug!(
        "fs_content_search root={} q='{}' files={} matches={} truncated={} elapsed_ms={}",
        root.to_string_lossy(),
        query,
        files.len(),
        total_matches,
        truncated,
        started.elapsed().as_millis()
    );

    Ok(Json(ContentSearchResponse {
        root: to_api_path(&root),
        query,
        file_count: files.len(),
        match_count: total_matches,
        files,
        truncated,
    }))
}

pub async fn fs_content_replace(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(q): Query<ProjectDirQuery>,
    Json(body): Json<ContentReplaceBody>,
) -> ApiResult<Json<ContentReplaceResponse>> {
    let root = resolve_project_directory(state.as_ref(), &headers, q.directory.as_deref()).await?;
    let replacement = body
        .replace
        .ok_or_else(|| AppError::bad_request("Replace text is required"))?;

    if let Some(target) = body.r#match {
        let path = target
            .path
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .ok_or_else(|| AppError::bad_request("Match path is required"))?;
        let expected = target
            .expected
            .ok_or_else(|| AppError::bad_request("Match expected text is required"))?;
        let start_offset = target
            .start_offset
            .ok_or_else(|| AppError::bad_request("Match startOffset is required"))?;
        let end_offset = target
            .end_offset
            .ok_or_else(|| AppError::bad_request("Match endOffset is required"))?;

        if end_offset <= start_offset {
            return Err(AppError::bad_request("Invalid match range"));
        }

        let resolved = resolve_path_within_workspace(&root, path)?;
        let Some(content) = read_searchable_text(&resolved).await else {
            return Err(AppError::bad_request(
                "Target file is not a searchable text file",
            ));
        };

        if end_offset > content.len()
            || !content.is_char_boundary(start_offset)
            || !content.is_char_boundary(end_offset)
        {
            return Err(AppError::bad_request("Match range is no longer valid"));
        }

        let current = &content[start_offset..end_offset];
        if current != expected {
            return Err(AppError::bad_request(
                "Selected match changed; run search again before replacing",
            ));
        }

        let mut updated =
            String::with_capacity(content.len() + replacement.len().saturating_sub(expected.len()));
        updated.push_str(&content[..start_offset]);
        updated.push_str(&replacement);
        updated.push_str(&content[end_offset..]);

        tokio::fs::write(&resolved, updated)
            .await
            .map_err(|err| match err.kind() {
                std::io::ErrorKind::PermissionDenied => AppError::forbidden("Access denied"),
                _ => AppError::internal(err.to_string()),
            })?;

        let relative_path = normalize_relative_search_path(&root, &resolved);
        return Ok(Json(ContentReplaceResponse {
            root: to_api_path(&root),
            file_count: 1,
            replacement_count: 1,
            skipped: 0,
            files: vec![ContentReplaceFileResult {
                path: to_api_path(&resolved),
                relative_path,
                replacements: 1,
            }],
        }));
    }

    let query = body
        .query
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .ok_or_else(|| AppError::bad_request("Search query is required"))?;

    let include_hidden = body.include_hidden.unwrap_or(false);
    let respect_gitignore = body.respect_gitignore.unwrap_or(true);
    let is_regex = body.is_regex.unwrap_or(false);
    let case_sensitive = body.case_sensitive.unwrap_or(false);
    let whole_word = body.whole_word.unwrap_or(false);

    let regex = build_content_regex(query, is_regex, case_sensitive, whole_word)?;
    let started = Instant::now();

    let candidates = if let Some(paths) = body.paths.as_deref() {
        normalize_content_scope_paths(&root, paths, true, false).await?
    } else {
        walk_workspace_files(
            &root,
            include_hidden,
            respect_gitignore,
            MAX_CONTENT_REPLACE_PATHS,
        )
    };

    let mut files = Vec::new();
    let mut total_replacements = 0usize;
    let mut skipped = 0usize;

    for path in candidates {
        let Some(content) = read_searchable_text(&path).await else {
            skipped += 1;
            continue;
        };

        let replacements = regex.find_iter(&content).count();
        if replacements == 0 {
            continue;
        }

        let updated = regex
            .replace_all(&content, replacement.as_str())
            .into_owned();
        if updated == content {
            continue;
        }

        if let Err(err) = tokio::fs::write(&path, updated).await {
            skipped += 1;
            tracing::warn!(
                "fs_content_replace failed to write {}: {}",
                path.to_string_lossy(),
                err
            );
            continue;
        }

        total_replacements += replacements;
        let relative_path = normalize_relative_search_path(&root, &path);
        files.push(ContentReplaceFileResult {
            path: to_api_path(&path),
            relative_path,
            replacements,
        });
    }

    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    tracing::debug!(
        "fs_content_replace root={} q='{}' files={} replacements={} skipped={} elapsed_ms={}",
        root.to_string_lossy(),
        query,
        files.len(),
        total_replacements,
        skipped,
        started.elapsed().as_millis()
    );

    Ok(Json(ContentReplaceResponse {
        root: to_api_path(&root),
        file_count: files.len(),
        replacement_count: total_replacements,
        skipped,
        files,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn ensure_within_base_accepts_windows_case_and_separator_variants() {
        let base = Path::new("C:/Users/Alice/Workspace");
        let target = Path::new("c:\\users\\alice\\workspace\\project\\src\\main.rs");
        assert!(ensure_within_base(base, target).is_ok());
    }

    #[test]
    fn ensure_within_base_rejects_windows_prefix_collision() {
        let base = Path::new("C:/Users/Alice/Workspace");
        let target = Path::new("C:/Users/Alice/Workspace-archive/file.txt");
        assert!(ensure_within_base(base, target).is_err());
    }

    #[test]
    fn ensure_within_base_rejects_unix_prefix_collision() {
        let base = Path::new("/home/alice/work");
        let target = Path::new("/home/alice/workspace/readme.md");
        assert!(ensure_within_base(base, target).is_err());
    }

    #[test]
    fn to_api_path_uses_forward_slashes() {
        let path = Path::new("C:\\Users\\Alice\\workspace\\file.txt");
        assert_eq!(to_api_path(path), "C:/Users/Alice/workspace/file.txt");
    }
}
