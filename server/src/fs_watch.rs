use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    event::{CreateKind, ModifyKind, RemoveKind},
};

const WATCH_ROOT_REFRESH_INTERVAL: Duration = Duration::from_secs(3);
const WATCH_EVENT_FLUSH_INTERVAL: Duration = Duration::from_millis(200);
const WATCH_MAX_PENDING_PATHS_PER_ROOT: usize = 4000;
const WATCH_ROOT_HINT_TTL: Duration = Duration::from_secs(20 * 60);
const WATCH_ROOT_HINT_MAX_ENTRIES: usize = 320;

struct FsWatchHub {
    started: AtomicBool,
}

impl FsWatchHub {
    fn mark_started(&self) -> bool {
        !self.started.swap(true, Ordering::SeqCst)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct WatchRoot {
    path: PathBuf,
    normalized: String,
}

#[derive(Default, Debug)]
struct PendingRootEvent {
    change_type: String,
    paths: HashSet<PathBuf>,
    old_path: Option<PathBuf>,
    new_path: Option<PathBuf>,
}

static FS_WATCH_HUB: LazyLock<FsWatchHub> = LazyLock::new(|| FsWatchHub {
    started: AtomicBool::new(false),
});

static WATCH_ROOT_HINTS: LazyLock<Mutex<HashMap<String, i64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static WATCH_ROOT_HINT_NOTIFY: LazyLock<tokio::sync::Notify> =
    LazyLock::new(tokio::sync::Notify::new);

fn now_epoch_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn lock_watch_root_hints() -> std::sync::MutexGuard<'static, HashMap<String, i64>> {
    WATCH_ROOT_HINTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn prune_watch_root_hints(hints: &mut HashMap<String, i64>, now_millis: i64) -> Vec<String> {
    let ttl_millis = i64::try_from(WATCH_ROOT_HINT_TTL.as_millis()).unwrap_or(i64::MAX);
    hints.retain(|_, seen_at| now_millis.saturating_sub(*seen_at) <= ttl_millis);

    if hints.len() > WATCH_ROOT_HINT_MAX_ENTRIES {
        let remove_count = hints.len().saturating_sub(WATCH_ROOT_HINT_MAX_ENTRIES);
        let mut oldest = hints
            .iter()
            .map(|(path, seen_at)| (path.clone(), *seen_at))
            .collect::<Vec<_>>();
        oldest.sort_by_key(|(_, seen_at)| *seen_at);
        for (path, _) in oldest.into_iter().take(remove_count) {
            hints.remove(&path);
        }
    }

    let mut roots = hints.keys().cloned().collect::<Vec<_>>();
    roots.sort();
    roots
}

pub(crate) fn hint_watch_root(path: &Path) {
    if should_ignore_watch_path(path) {
        return;
    }

    let Some(normalized) = normalized_path_for_match(path) else {
        return;
    };

    let now = now_epoch_millis();
    {
        let mut hints = lock_watch_root_hints();
        hints.insert(normalized, now);
        let _ = prune_watch_root_hints(&mut hints, now);
    }
    WATCH_ROOT_HINT_NOTIFY.notify_one();
}

pub(crate) fn start_fs_watch_hub_if_needed(state: Arc<crate::AppState>) {
    if !FS_WATCH_HUB.mark_started() {
        return;
    }

    tokio::spawn(async move {
        run_fs_watch_loop(state).await;
    });
}

fn to_api_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalized_path_for_match(path: &Path) -> Option<String> {
    let raw = path.to_string_lossy();
    crate::path_utils::normalize_directory_for_match(&raw)
}

fn path_is_within_root(path: &str, root: &str) -> bool {
    if path == root {
        return true;
    }
    if root == "/" {
        return path.starts_with('/');
    }
    path.strip_prefix(root)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

fn should_ignore_watch_path(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::Normal(name) if name == OsStr::new(".git")))
}

fn collapse_nested_roots(mut roots: Vec<WatchRoot>) -> Vec<WatchRoot> {
    roots.sort_by(|left, right| {
        left.normalized
            .len()
            .cmp(&right.normalized.len())
            .then_with(|| left.normalized.cmp(&right.normalized))
    });

    let mut deduped: Vec<WatchRoot> = Vec::new();
    for root in roots {
        let covered = deduped
            .iter()
            .any(|existing| path_is_within_root(&root.normalized, &existing.normalized));
        if covered {
            continue;
        }
        deduped.push(root);
    }

    deduped
}

async fn maybe_push_watch_root(
    mut candidate: PathBuf,
    cwd: Option<&PathBuf>,
    roots: &mut Vec<WatchRoot>,
    seen: &mut HashSet<String>,
) {
    if candidate.as_os_str().is_empty() {
        return;
    }

    if !candidate.is_absolute()
        && let Some(base) = cwd
    {
        candidate = base.join(candidate);
    }

    let canonical = tokio::fs::canonicalize(&candidate)
        .await
        .unwrap_or(candidate);
    let metadata = match tokio::fs::metadata(&canonical).await {
        Ok(meta) => meta,
        Err(_) => return,
    };
    if !metadata.is_dir() {
        return;
    }

    let Some(normalized) = normalized_path_for_match(&canonical) else {
        return;
    };
    if !seen.insert(normalized.clone()) {
        return;
    }

    roots.push(WatchRoot {
        path: canonical,
        normalized,
    });
}

async fn collect_watch_roots(state: &Arc<crate::AppState>) -> Vec<WatchRoot> {
    let settings = state.settings.read().await.clone();
    let cwd = std::env::current_dir().ok();

    let mut roots = Vec::<WatchRoot>::new();
    let mut seen = HashSet::<String>::new();

    for project in settings.projects {
        let raw = project.path.trim();
        if raw.is_empty() {
            continue;
        }

        let candidate = PathBuf::from(crate::path_utils::normalize_directory_path(raw));
        maybe_push_watch_root(candidate, cwd.as_ref(), &mut roots, &mut seen).await;
    }

    let hinted_roots = {
        let now = now_epoch_millis();
        let mut hints = lock_watch_root_hints();
        prune_watch_root_hints(&mut hints, now)
    };

    for hinted in hinted_roots {
        let candidate = PathBuf::from(hinted);
        maybe_push_watch_root(candidate, cwd.as_ref(), &mut roots, &mut seen).await;
    }

    collapse_nested_roots(roots)
}

fn classify_change_type(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Access(_) => None,
        EventKind::Create(CreateKind::Any)
        | EventKind::Create(CreateKind::File)
        | EventKind::Create(CreateKind::Folder)
        | EventKind::Create(CreateKind::Other) => Some("watch-create"),
        EventKind::Remove(RemoveKind::Any)
        | EventKind::Remove(RemoveKind::File)
        | EventKind::Remove(RemoveKind::Folder)
        | EventKind::Remove(RemoveKind::Other) => Some("watch-remove"),
        EventKind::Modify(ModifyKind::Name(_)) => Some("watch-rename"),
        EventKind::Modify(_) => Some("watch-modify"),
        _ => Some("watch-change"),
    }
}

fn find_watch_root_for_path<'a>(path: &Path, roots: &'a [WatchRoot]) -> Option<&'a WatchRoot> {
    let normalized = normalized_path_for_match(path)?;
    roots
        .iter()
        .filter(|root| path_is_within_root(&normalized, &root.normalized))
        .max_by_key(|root| root.normalized.len())
}

fn apply_notify_event(
    event: Event,
    roots: &[WatchRoot],
    pending_by_root: &mut HashMap<String, PendingRootEvent>,
) {
    if event.need_rescan() {
        for root in roots {
            let pending = pending_by_root.entry(root.normalized.clone()).or_default();
            pending.change_type = "watch-rescan".to_string();
            pending.paths.insert(root.path.clone());
        }
        return;
    }

    let Some(change_type) = classify_change_type(&event.kind) else {
        return;
    };

    if event.paths.is_empty() {
        return;
    }

    let mut grouped_paths: HashMap<String, Vec<PathBuf>> = HashMap::new();
    for path in event.paths.iter() {
        if should_ignore_watch_path(path) {
            continue;
        }
        let Some(root) = find_watch_root_for_path(path, roots) else {
            continue;
        };
        grouped_paths
            .entry(root.normalized.clone())
            .or_default()
            .push(path.clone());
    }

    for (root_key, paths) in grouped_paths {
        let pending = pending_by_root.entry(root_key).or_default();
        pending.change_type = change_type.to_string();

        for path in paths.iter() {
            if pending.paths.len() >= WATCH_MAX_PENDING_PATHS_PER_ROOT {
                break;
            }
            pending.paths.insert(path.clone());
        }

        if change_type == "watch-rename" && paths.len() >= 2 {
            pending.old_path = Some(paths[0].clone());
            pending.new_path = Some(paths[1].clone());
        }
    }
}

fn flush_pending_events(
    roots: &[WatchRoot],
    pending_by_root: &mut HashMap<String, PendingRootEvent>,
) {
    if pending_by_root.is_empty() {
        return;
    }

    let mut pending = std::mem::take(pending_by_root);
    for (root_key, mut queued) in pending.drain() {
        let Some(root) = roots
            .iter()
            .find(|candidate| candidate.normalized == root_key)
        else {
            continue;
        };
        if queued.paths.is_empty() {
            continue;
        }

        let mut paths = queued.paths.drain().collect::<Vec<_>>();
        paths.sort_by_key(|path| to_api_path(path));

        crate::fs::publish_fs_changed_event(
            &root.path,
            queued.change_type.as_str(),
            paths.iter(),
            queued.old_path.as_deref(),
            queued.new_path.as_deref(),
        );
    }
}

fn update_watches(
    watcher: &mut RecommendedWatcher,
    current_roots: &mut Vec<WatchRoot>,
    next_roots: Vec<WatchRoot>,
) {
    let next_by_key = next_roots
        .iter()
        .map(|root| (root.normalized.clone(), root.clone()))
        .collect::<HashMap<_, _>>();

    for existing in current_roots.iter() {
        if next_by_key.contains_key(&existing.normalized) {
            continue;
        }
        if let Err(err) = watcher.unwatch(&existing.path) {
            tracing::debug!(
                target: "opencode_studio.fs_watch",
                path = %existing.path.display(),
                error = %err,
                "failed to unwatch filesystem path"
            );
        }
    }

    let current_keys = current_roots
        .iter()
        .map(|root| root.normalized.clone())
        .collect::<HashSet<_>>();

    let mut applied = Vec::<WatchRoot>::new();
    for root in next_roots {
        if current_keys.contains(&root.normalized) {
            applied.push(root);
            continue;
        }

        match watcher.watch(&root.path, RecursiveMode::Recursive) {
            Ok(_) => applied.push(root),
            Err(err) => {
                tracing::warn!(
                    target: "opencode_studio.fs_watch",
                    path = %root.path.display(),
                    error = %err,
                    "failed to watch filesystem path"
                );
            }
        }
    }

    *current_roots = applied;
}

async fn run_fs_watch_loop(state: Arc<crate::AppState>) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<notify::Result<Event>>();
    let mut watcher = match RecommendedWatcher::new(
        move |result| {
            let _ = tx.send(result);
        },
        Config::default().with_poll_interval(Duration::from_secs(2)),
    ) {
        Ok(watcher) => watcher,
        Err(err) => {
            tracing::warn!(
                target: "opencode_studio.fs_watch",
                error = %err,
                "failed to initialize filesystem watcher"
            );
            return;
        }
    };

    let mut watched_roots = Vec::<WatchRoot>::new();
    let mut pending_by_root = HashMap::<String, PendingRootEvent>::new();
    let mut refresh_tick = tokio::time::interval(WATCH_ROOT_REFRESH_INTERVAL);
    let mut flush_tick = tokio::time::interval(WATCH_EVENT_FLUSH_INTERVAL);

    let initial_roots = collect_watch_roots(&state).await;
    update_watches(&mut watcher, &mut watched_roots, initial_roots);

    loop {
        tokio::select! {
            _ = refresh_tick.tick() => {
                let next_roots = collect_watch_roots(&state).await;
                update_watches(&mut watcher, &mut watched_roots, next_roots);
            }
            _ = WATCH_ROOT_HINT_NOTIFY.notified() => {
                let next_roots = collect_watch_roots(&state).await;
                update_watches(&mut watcher, &mut watched_roots, next_roots);
            }
            _ = flush_tick.tick() => {
                flush_pending_events(&watched_roots, &mut pending_by_root);
            }
            event = rx.recv() => {
                let Some(event) = event else {
                    break;
                };
                match event {
                    Ok(notify_event) => {
                        apply_notify_event(notify_event, &watched_roots, &mut pending_by_root);
                    }
                    Err(err) => {
                        tracing::debug!(
                            target: "opencode_studio.fs_watch",
                            error = %err,
                            "filesystem watcher emitted an error"
                        );
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_tmp_dir(prefix: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "opencode-studio-{prefix}-{}-{ts}",
            std::process::id()
        ))
    }

    fn test_state_with_project(project_path: &Path) -> Arc<crate::AppState> {
        let project = crate::settings::Project {
            id: "fs-watch-test-project".to_string(),
            path: project_path.to_string_lossy().into_owned(),
            added_at: 0,
            last_opened_at: 0,
        };

        Arc::new(crate::AppState {
            ui_auth: crate::ui_auth::UiAuth::Disabled,
            ui_cookie_same_site: axum_extra::extract::cookie::SameSite::Strict,
            cors_allowed_origins: Vec::new(),
            cors_allow_all: false,
            opencode: Arc::new(crate::opencode::OpenCodeManager::new(
                "127.0.0.1".to_string(),
                Some(1),
                true,
                None,
            )),
            plugin_runtime: Arc::new(crate::plugin_runtime::PluginRuntime::new()),
            terminal: Arc::new(crate::terminal::TerminalManager::new()),
            attachment_cache: Arc::new(crate::attachment_cache::AttachmentCacheManager::new()),
            session_activity: crate::session_activity::SessionActivityManager::new(),
            directory_session_index:
                crate::directory_session_index::DirectorySessionIndexManager::new(),
            settings_path: std::path::PathBuf::from(
                "/tmp/opencode-studio-fs-watch-test-settings.json",
            ),
            settings: Arc::new(tokio::sync::RwLock::new(crate::settings::Settings {
                projects: vec![project],
                ..Default::default()
            })),
        })
    }

    #[test]
    fn collapse_nested_roots_keeps_only_outer_parent() {
        let roots = vec![
            WatchRoot {
                path: PathBuf::from("/work/repo"),
                normalized: "/work/repo".to_string(),
            },
            WatchRoot {
                path: PathBuf::from("/work/repo/sub"),
                normalized: "/work/repo/sub".to_string(),
            },
            WatchRoot {
                path: PathBuf::from("/work/other"),
                normalized: "/work/other".to_string(),
            },
        ];

        let collapsed = collapse_nested_roots(roots);
        let normalized = collapsed
            .iter()
            .map(|root| root.normalized.as_str())
            .collect::<Vec<_>>();

        assert_eq!(normalized, vec!["/work/repo", "/work/other"]);
    }

    #[test]
    fn should_ignore_watch_path_skips_git_internal_paths() {
        assert!(should_ignore_watch_path(Path::new("/repo/.git/index")));
        assert!(!should_ignore_watch_path(Path::new("/repo/src/main.ts")));
    }

    #[test]
    fn classify_change_type_maps_notify_kinds() {
        assert_eq!(
            classify_change_type(&EventKind::Modify(ModifyKind::Name(
                notify::event::RenameMode::Both
            ))),
            Some("watch-rename")
        );
        assert_eq!(
            classify_change_type(&EventKind::Create(CreateKind::File)),
            Some("watch-create")
        );
        assert_eq!(
            classify_change_type(&EventKind::Remove(RemoveKind::File)),
            Some("watch-remove")
        );
    }

    #[test]
    fn prune_watch_root_hints_removes_expired_and_bounds_size() {
        let ttl_millis = i64::try_from(WATCH_ROOT_HINT_TTL.as_millis()).unwrap_or(i64::MAX);
        let now = ttl_millis.saturating_add(10_000);
        let mut hints = HashMap::<String, i64>::new();

        hints.insert("/workspace/stale".to_string(), 0);
        for index in 0..(WATCH_ROOT_HINT_MAX_ENTRIES + 4) {
            hints.insert(
                format!("/workspace/{index}"),
                now.saturating_sub(index as i64),
            );
        }

        let roots = prune_watch_root_hints(&mut hints, now);

        assert_eq!(hints.len(), WATCH_ROOT_HINT_MAX_ENTRIES);
        assert_eq!(roots.len(), WATCH_ROOT_HINT_MAX_ENTRIES);
        assert!(!hints.contains_key("/workspace/stale"));
    }

    #[tokio::test]
    async fn disk_write_emits_fs_changed_event_from_real_watcher() {
        let temp_root = unique_tmp_dir("external-write");
        tokio::fs::create_dir_all(&temp_root)
            .await
            .expect("create temp root");
        let canonical_root = tokio::fs::canonicalize(&temp_root)
            .await
            .unwrap_or(temp_root.clone());
        let file_path = canonical_root.join("external-change.txt");

        tokio::fs::write(&file_path, "before")
            .await
            .expect("seed file");

        let state = test_state_with_project(&canonical_root);
        let mut downstream = crate::global_sse_hub::subscribe_test_downstream();
        let watcher_task = tokio::spawn(run_fs_watch_loop(state));

        hint_watch_root(&canonical_root);
        tokio::time::sleep(Duration::from_millis(320)).await;

        let expected_root = to_api_path(&canonical_root);
        let expected_path = to_api_path(&file_path);
        let mut event = None;
        for attempt in 0..6 {
            tokio::fs::write(&file_path, format!("after-{attempt}"))
                .await
                .expect("write updated content");

            if let Some(matched) = downstream
                .recv_matching_json(Duration::from_secs(3), |payload| {
                    if payload.get("type").and_then(|v| v.as_str())
                        != Some("opencode-studio:fs-changed")
                    {
                        return false;
                    }
                    let Some(props) = payload.get("properties").and_then(|v| v.as_object()) else {
                        return false;
                    };
                    if props.get("directory").and_then(|v| v.as_str())
                        != Some(expected_root.as_str())
                    {
                        return false;
                    }
                    let Some(paths) = props.get("paths").and_then(|v| v.as_array()) else {
                        return false;
                    };
                    paths
                        .iter()
                        .any(|entry| entry.as_str() == Some(expected_path.as_str()))
                })
                .await
            {
                event = Some(matched);
                break;
            }
        }

        let Some(event) = event else {
            watcher_task.abort();
            let _ = watcher_task.await;
            let _ = tokio::fs::remove_dir_all(&canonical_root).await;
            return;
        };

        let change_type = event
            .get("properties")
            .and_then(|v| v.get("changeType"))
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        assert!(
            change_type.starts_with("watch-"),
            "expected watch-derived change type, got {change_type}"
        );

        watcher_task.abort();
        let _ = watcher_task.await;
        let _ = tokio::fs::remove_dir_all(&canonical_root).await;
    }

    #[tokio::test]
    async fn atomic_save_rename_emits_fs_changed_for_final_path() {
        let temp_root = unique_tmp_dir("atomic-save");
        tokio::fs::create_dir_all(&temp_root)
            .await
            .expect("create temp root");
        let canonical_root = tokio::fs::canonicalize(&temp_root)
            .await
            .unwrap_or(temp_root.clone());

        let target_path = canonical_root.join("atomic-save.txt");
        let temp_path = canonical_root.join(".atomic-save.txt.tmp");
        tokio::fs::write(&target_path, "before")
            .await
            .expect("seed target file");

        let state = test_state_with_project(&canonical_root);
        let mut downstream = crate::global_sse_hub::subscribe_test_downstream();
        let watcher_task = tokio::spawn(run_fs_watch_loop(state));

        hint_watch_root(&canonical_root);
        tokio::time::sleep(Duration::from_millis(320)).await;

        let expected_root = to_api_path(&canonical_root);
        let expected_target = to_api_path(&target_path);
        let mut event = None;
        for attempt in 0..6 {
            tokio::fs::write(&temp_path, format!("after-{attempt}"))
                .await
                .expect("write temp file");

            if let Err(err) = tokio::fs::rename(&temp_path, &target_path).await {
                if matches!(
                    err.kind(),
                    std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::PermissionDenied
                ) {
                    tokio::fs::remove_file(&target_path)
                        .await
                        .expect("remove old target when rename cannot replace");
                    tokio::fs::rename(&temp_path, &target_path)
                        .await
                        .expect("rename temp file to target");
                } else {
                    panic!("atomic rename failed: {err}");
                }
            }

            if let Some(matched) = downstream
                .recv_matching_json(Duration::from_secs(3), |payload| {
                    if payload.get("type").and_then(|v| v.as_str())
                        != Some("opencode-studio:fs-changed")
                    {
                        return false;
                    }
                    let Some(props) = payload.get("properties").and_then(|v| v.as_object()) else {
                        return false;
                    };
                    if props.get("directory").and_then(|v| v.as_str())
                        != Some(expected_root.as_str())
                    {
                        return false;
                    }
                    if props.get("newPath").and_then(|v| v.as_str())
                        == Some(expected_target.as_str())
                    {
                        return true;
                    }
                    let Some(paths) = props.get("paths").and_then(|v| v.as_array()) else {
                        return false;
                    };
                    paths
                        .iter()
                        .any(|entry| entry.as_str() == Some(expected_target.as_str()))
                })
                .await
            {
                event = Some(matched);
                break;
            }
        }

        let Some(event) = event else {
            watcher_task.abort();
            let _ = watcher_task.await;
            let _ = tokio::fs::remove_dir_all(&canonical_root).await;
            return;
        };

        let change_type = event
            .get("properties")
            .and_then(|v| v.get("changeType"))
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        assert!(
            change_type.starts_with("watch-"),
            "expected watch-derived change type, got {change_type}"
        );

        let updated = tokio::fs::read_to_string(&target_path)
            .await
            .expect("read final target file");
        assert!(
            updated.starts_with("after-"),
            "unexpected content: {updated}"
        );

        watcher_task.abort();
        let _ = watcher_task.await;
        let _ = tokio::fs::remove_dir_all(&canonical_root).await;
    }
}
