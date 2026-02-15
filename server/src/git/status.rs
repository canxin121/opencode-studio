use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::path::Path;
use std::time::Duration;

use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
};
use serde::{Deserialize, Serialize};

use crate::git2_utils;

use super::{MAX_BLOB_BYTES, git2_open_error_response, require_directory_raw, run_git};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusFile {
    pub path: String,
    pub index: String,
    pub working_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResponse {
    pub current: String,
    pub tracking: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    pub files: Vec<GitStatusFile>,
    pub is_clean: bool,
    pub total_files: usize,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub untracked_count: usize,
    pub merge_count: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_stats: Option<HashMap<String, DiffStat>>,
}

#[derive(Debug, Serialize, Clone, Copy)]
pub struct DiffStat {
    pub insertions: i32,
    pub deletions: i32,
}

fn parse_numstat(raw: &str, map: &mut HashMap<String, DiffStat>) {
    for line in raw.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let ins_raw = parts[0];
        let del_raw = parts[1];
        let path = parts[2..].join("\t");
        if path.is_empty() {
            continue;
        }
        let ins = if ins_raw == "-" {
            0
        } else {
            ins_raw.parse::<i32>().unwrap_or(0)
        };
        let del = if del_raw == "-" {
            0
        } else {
            del_raw.parse::<i32>().unwrap_or(0)
        };
        let entry = map.entry(path).or_insert(DiffStat {
            insertions: 0,
            deletions: 0,
        });
        entry.insertions += ins;
        entry.deletions += del;
    }
}

async fn estimate_new_file_lines(repo: &Path, file_rel: &str) -> Option<DiffStat> {
    let full = repo.join(file_rel);
    let meta = tokio::fs::metadata(&full).await.ok()?;
    if !meta.is_file() || meta.len() > MAX_BLOB_BYTES as u64 {
        return None;
    }
    let data = tokio::fs::read(&full).await.ok()?;
    if data.contains(&0) {
        return Some(DiffStat {
            insertions: 0,
            deletions: 0,
        });
    }
    let s = String::from_utf8_lossy(&data).replace("\r\n", "\n");
    if s.is_empty() {
        return Some(DiffStat {
            insertions: 0,
            deletions: 0,
        });
    }
    let mut lines = s.split('\n').count() as i32;
    if s.ends_with('\n') {
        lines -= 1;
    }
    Some(DiffStat {
        insertions: lines.max(0),
        deletions: 0,
    })
}

async fn select_base_ref_for_unpublished(dir: &Path) -> Option<String> {
    let candidates = {
        let mut out = Vec::new();
        if let Ok((code, stdout, _)) =
            run_git(dir, &["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]).await
            && code == 0
        {
            let s = stdout.trim();
            if !s.is_empty() {
                out.push(s.replace("refs/remotes/", ""));
            }
        }
        out.extend(
            ["origin/main", "origin/master", "main", "master"]
                .into_iter()
                .map(|s| s.to_string()),
        );
        out
    };

    for r in candidates {
        if let Ok((code, stdout, _)) = run_git(dir, &["rev-parse", "--verify", &r]).await
            && code == 0
            && !stdout.trim().is_empty()
        {
            return Some(r);
        }
    }
    None
}

#[derive(Debug, Deserialize)]
pub struct GitStatusQuery {
    pub directory: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
    // "all" (default) | "staged" | "unstaged" | "merge" | "untracked"
    pub scope: Option<String>,
    // If true, return counts/branch info only (no file list).
    pub summary: Option<bool>,
    // If true, include per-file diff stats (can be expensive for large repos).
    #[serde(rename = "includeDiffStats")]
    pub include_diff_stats: Option<bool>,
}

pub async fn git_status(Query(q): Query<GitStatusQuery>) -> Response {
    let dir = match require_directory_raw(q.directory.as_deref()) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    // Use libgit2 for stable, structured status.
    // Keep output compatible with our current UI (porcelain-like index + working_dir codes).
    let snapshot = tokio::task::spawn_blocking({
        let dir = dir.clone();
        move || {
            use git2::{BranchType, Status, StatusOptions};

            let repo = match git2_utils::open_repo_discover(&dir) {
                Ok(r) => r,
                Err(e) => return Err(e),
            };

            let mut current = String::new();
            let mut tracking: Option<String> = None;
            let mut ahead: i32 = 0;
            let mut behind: i32 = 0;

            // Current branch + upstream tracking.
            if let Ok(head) = repo.head() {
                if head.is_branch() {
                    current = head.shorthand().unwrap_or("").to_string();
                    if let Some(cur_name) = head.shorthand()
                        && let Ok(branch) = repo.find_branch(cur_name, BranchType::Local)
                        && let Ok(up) = branch.upstream()
                    {
                        tracking = up.get().shorthand().map(|s| s.to_string());
                        if let (Some(h), Some(u)) = (head.target(), up.get().target())
                            && let Ok((a, b)) = repo.graph_ahead_behind(h, u)
                        {
                            ahead = a as i32;
                            behind = b as i32;
                        }
                    }
                } else {
                    // Detached HEAD.
                    current = "HEAD".to_string();
                }
            }

            let mut opts = StatusOptions::new();
            opts.include_untracked(true)
                .recurse_untracked_dirs(true)
                .include_ignored(false)
                .include_unmodified(false);

            let statuses = repo
                .statuses(Some(&mut opts))
                .map_err(|e| git2_utils::Git2OpenError::Other(e.message().to_string()))?;

            fn idx_code(st: Status) -> &'static str {
                if st.is_conflicted() {
                    return "U";
                }
                if st.contains(Status::INDEX_NEW) {
                    return "A";
                }
                if st.contains(Status::INDEX_MODIFIED) {
                    return "M";
                }
                if st.contains(Status::INDEX_DELETED) {
                    return "D";
                }
                if st.contains(Status::INDEX_RENAMED) {
                    return "R";
                }
                if st.contains(Status::INDEX_TYPECHANGE) {
                    return "T";
                }
                ""
            }
            fn wt_code(st: Status) -> &'static str {
                if st.is_conflicted() {
                    return "U";
                }
                if st.contains(Status::WT_NEW) {
                    return "?";
                }
                if st.contains(Status::WT_MODIFIED) {
                    return "M";
                }
                if st.contains(Status::WT_DELETED) {
                    return "D";
                }
                if st.contains(Status::WT_RENAMED) {
                    return "R";
                }
                if st.contains(Status::WT_TYPECHANGE) {
                    return "T";
                }
                ""
            }

            let mut files: Vec<GitStatusFile> = Vec::new();
            for entry in statuses.iter() {
                let Some(path) = entry.path() else {
                    continue;
                };
                let st = entry.status();
                let x = idx_code(st).to_string();
                let y = wt_code(st).to_string();
                if x.is_empty() && y.is_empty() {
                    continue;
                }
                // libgit2 uses WT_NEW for untracked. Match porcelain "??".
                let (x, y) = if y == "?" {
                    ("?".to_string(), "?".to_string())
                } else {
                    (x, y)
                };
                files.push(GitStatusFile {
                    path: path.to_string(),
                    index: x,
                    working_dir: y,
                });
            }
            files.sort_by(|a, b| a.path.cmp(&b.path));

            Ok((current, tracking, ahead, behind, files))
        }
    })
    .await;

    let (current, tracking, mut ahead, mut behind, files) = match snapshot {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => return git2_open_error_response(e),
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string(), "code": "git2_task_failed"})),
            )
                .into_response();
        }
    };

    let is_merge = |f: &GitStatusFile| f.index.trim() == "U" || f.working_dir.trim() == "U";
    let is_untracked = |f: &GitStatusFile| f.index.trim() == "?" && f.working_dir.trim() == "?";
    // Match VS Code Git view grouping semantics:
    // - Merge changes are separate.
    // - Untracked is separate.
    // - Staged vs unstaged can overlap for the same path (e.g. "MM").
    let is_staged = |f: &GitStatusFile| {
        if is_merge(f) {
            return false;
        }
        let x = f.index.trim();
        !x.is_empty() && x != "?"
    };
    let is_unstaged = |f: &GitStatusFile| {
        if is_merge(f) || is_untracked(f) {
            return false;
        }
        let y = f.working_dir.trim();
        !y.is_empty()
    };

    let total_files = files.len();
    let staged_count = files.iter().filter(|f| is_staged(f)).count();
    let unstaged_count = files.iter().filter(|f| is_unstaged(f)).count();
    let untracked_count = files.iter().filter(|f| is_untracked(f)).count();
    let merge_count = files.iter().filter(|f| is_merge(f)).count();

    let summary = q.summary.unwrap_or(false);
    let scope = q
        .scope
        .as_deref()
        .unwrap_or("all")
        .trim()
        .to_ascii_lowercase();

    let mut scoped: Vec<GitStatusFile> = match scope.as_str() {
        "staged" => files.into_iter().filter(|f| is_staged(f)).collect(),
        "unstaged" => files.into_iter().filter(|f| is_unstaged(f)).collect(),
        "merge" => files.into_iter().filter(|f| is_merge(f)).collect(),
        "untracked" => files.into_iter().filter(|f| is_untracked(f)).collect(),
        _ => files,
    };

    let scope_total = scoped.len();
    let offset = if summary { 0 } else { q.offset.unwrap_or(0) };
    // Default to a bounded page size; callers can page via offset/limit.
    let mut limit = if summary { 0 } else { q.limit.unwrap_or(200) };
    // Guardrails for request size.
    limit = limit.min(500);

    let end = offset.saturating_add(limit).min(scope_total);
    let has_more = end < scope_total;
    let page_files = if limit == 0 || offset >= scope_total {
        Vec::new()
    } else {
        scoped.drain(offset..end).collect::<Vec<_>>()
    };

    let mut diff_stats: Option<HashMap<String, DiffStat>> = None;
    let include_diff_stats = q.include_diff_stats.unwrap_or(false);

    if include_diff_stats && !summary && !page_files.is_empty() {
        let mut map: HashMap<String, DiffStat> = HashMap::new();
        let mut paths: Vec<String> = page_files
            .iter()
            .map(|f| f.path.trim().to_string())
            .filter(|p| !p.is_empty())
            .collect();
        paths.sort();
        paths.dedup();

        if !paths.is_empty() {
            let mut staged_args: Vec<String> = vec![
                "diff".into(),
                "--cached".into(),
                "--numstat".into(),
                "--".into(),
            ];
            staged_args.extend(paths.iter().cloned());
            let staged_refs: Vec<&str> = staged_args.iter().map(|s| s.as_str()).collect();
            if let Ok((_, staged, _)) = run_git(&dir, &staged_refs).await {
                parse_numstat(&staged, &mut map);
            }

            let mut working_args: Vec<String> =
                vec!["diff".into(), "--numstat".into(), "--".into()];
            working_args.extend(paths.iter().cloned());
            let working_refs: Vec<&str> = working_args.iter().map(|s| s.as_str()).collect();
            if let Ok((_, working, _)) = run_git(&dir, &working_refs).await {
                parse_numstat(&working, &mut map);
            }
        }

        // Estimate new file insertions for untracked/added where numstat didn't include content.
        // Limit this to the returned page so paging stays cheap.
        for f in &page_files {
            let status_code = if f.working_dir.trim().is_empty() {
                &f.index
            } else {
                &f.working_dir
            };
            if status_code != "?" && status_code != "A" {
                continue;
            }
            if let Some(existing) = map.get(&f.path)
                && existing.insertions > 0
            {
                continue;
            }
            if let Some(stat) = estimate_new_file_lines(&dir, &f.path).await {
                map.insert(f.path.clone(), stat);
            }
        }

        // Only return stats for paths in this page to keep the response bounded.
        let allowed: HashSet<String> = page_files.iter().map(|f| f.path.clone()).collect();
        map.retain(|k, _| allowed.contains(k));
        diff_stats = Some(map);
    }

    // If no upstream tracking but we know current branch, estimate unpublished commits.
    if tracking.is_none()
        && !current.is_empty()
        && let Some(base) = select_base_ref_for_unpublished(&dir).await
        && let Ok((c, out, _)) =
            run_git(&dir, &["rev-list", "--count", &format!("{base}..HEAD")]).await
        && c == 0
        && let Ok(count) = out.trim().parse::<i32>()
    {
        ahead = count;
        behind = 0;
    }

    let is_clean = total_files == 0;

    Json(GitStatusResponse {
        current,
        tracking,
        ahead,
        behind,
        files: page_files,
        is_clean,
        total_files,
        staged_count,
        unstaged_count,
        untracked_count,
        merge_count,
        offset,
        limit,
        has_more,
        scope,
        diff_stats,
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
pub struct GitWatchQuery {
    pub directory: Option<String>,
    #[serde(rename = "intervalMs")]
    pub interval_ms: Option<u64>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct GitWatchStatusPayload {
    current: String,
    tracking: Option<String>,
    ahead: i32,
    behind: i32,
    staged_count: usize,
    unstaged_count: usize,
    untracked_count: usize,
    merge_count: usize,
    is_clean: bool,
}

pub async fn git_watch(Query(q): Query<GitWatchQuery>) -> Response {
    let dir = match require_directory_raw(q.directory.as_deref()) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    // Validate repository early so the client gets a normal JSON response.
    let probe = tokio::task::spawn_blocking({
        let dir = dir.clone();
        move || git2_utils::open_repo_discover(&dir).map(|_| ())
    })
    .await;
    match probe {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => return git2_open_error_response(e),
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string(), "code": "git2_task_failed"})),
            )
                .into_response();
        }
    }

    let interval_ms = q.interval_ms.unwrap_or(1500).clamp(500, 10_000);
    let stream = async_stream::stream! {
        let mut last: Option<GitWatchStatusPayload> = None;
        let mut ticker = tokio::time::interval(Duration::from_millis(interval_ms));

        loop {
            ticker.tick().await;

            let snapshot = tokio::task::spawn_blocking({
                let dir = dir.clone();
                move || -> Result<GitWatchStatusPayload, git2_utils::Git2OpenError> {
                    use git2::{BranchType, Status, StatusOptions};

                    let repo = git2_utils::open_repo_discover(&dir)?;

                    let mut current = String::new();
                    let mut tracking: Option<String> = None;
                    let mut ahead: i32 = 0;
                    let mut behind: i32 = 0;

                    if let Ok(head) = repo.head() {
                        if head.is_branch() {
                            current = head.shorthand().unwrap_or("").to_string();
                            if let Some(cur_name) = head.shorthand()
                                && let Ok(branch) = repo.find_branch(cur_name, BranchType::Local)
                                && let Ok(up) = branch.upstream()
                            {
                                tracking = up.get().shorthand().map(|s| s.to_string());
                                if let (Some(h), Some(u)) = (head.target(), up.get().target())
                                    && let Ok((a, b)) = repo.graph_ahead_behind(h, u)
                                {
                                    ahead = a as i32;
                                    behind = b as i32;
                                }
                            }
                        } else {
                            current = "HEAD".to_string();
                        }
                    }

                    let mut opts = StatusOptions::new();
                    opts.include_untracked(true)
                        .recurse_untracked_dirs(true)
                        .include_ignored(false)
                        .include_unmodified(false);

                    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| {
                        git2_utils::Git2OpenError::Other(e.message().to_string())
                    })?;

                    fn idx_code(st: Status) -> &'static str {
                        if st.is_conflicted() {
                            return "U";
                        }
                        if st.contains(Status::INDEX_NEW) {
                            return "A";
                        }
                        if st.contains(Status::INDEX_MODIFIED) {
                            return "M";
                        }
                        if st.contains(Status::INDEX_DELETED) {
                            return "D";
                        }
                        if st.contains(Status::INDEX_RENAMED) {
                            return "R";
                        }
                        if st.contains(Status::INDEX_TYPECHANGE) {
                            return "T";
                        }
                        ""
                    }
                    fn wt_code(st: Status) -> &'static str {
                        if st.is_conflicted() {
                            return "U";
                        }
                        if st.contains(Status::WT_NEW) {
                            return "?";
                        }
                        if st.contains(Status::WT_MODIFIED) {
                            return "M";
                        }
                        if st.contains(Status::WT_DELETED) {
                            return "D";
                        }
                        if st.contains(Status::WT_RENAMED) {
                            return "R";
                        }
                        if st.contains(Status::WT_TYPECHANGE) {
                            return "T";
                        }
                        ""
                    }

                    let mut staged_count: usize = 0;
                    let mut unstaged_count: usize = 0;
                    let mut untracked_count: usize = 0;
                    let mut merge_count: usize = 0;
                    let mut total_files: usize = 0;

                    for entry in statuses.iter() {
                        let Some(_path) = entry.path() else {
                            continue;
                        };
                        let st = entry.status();
                        let mut x = idx_code(st);
                        let mut y = wt_code(st);

                        if x.is_empty() && y.is_empty() {
                            continue;
                        }

                        // libgit2 uses WT_NEW for untracked. Match porcelain "??".
                        if y == "?" {
                            x = "?";
                            y = "?";
                        }

                        total_files += 1;

                        let is_merge = x == "U" || y == "U";
                        let is_untracked = x == "?" && y == "?";
                        let is_staged = !is_merge && !x.is_empty() && x != "?";
                        let is_unstaged = !is_merge && !is_untracked && !y.is_empty();

                        if is_merge {
                            merge_count += 1;
                        }
                        if is_staged {
                            staged_count += 1;
                        }
                        if is_unstaged {
                            unstaged_count += 1;
                        }
                        if is_untracked {
                            untracked_count += 1;
                        }
                    }

                    Ok(GitWatchStatusPayload {
                        current,
                        tracking,
                        ahead,
                        behind,
                        staged_count,
                        unstaged_count,
                        untracked_count,
                        merge_count,
                        is_clean: total_files == 0,
                    })
                }
            })
            .await;

            let payload = match snapshot {
                Ok(Ok(v)) => v,
                Ok(Err(e)) => {
                    let msg = format!("git2 error: {e:?}");
                    yield Ok::<Event, Infallible>(Event::default().event("error").data(msg));
                    break;
                }
                Err(e) => {
                    yield Ok::<Event, Infallible>(Event::default().event("error").data(e.to_string()));
                    break;
                }
            };

            if last.as_ref().is_some_and(|prev| prev == &payload) {
                continue;
            }
            last = Some(payload.clone());

            let json = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
            yield Ok::<Event, Infallible>(Event::default().event("status").data(json));
        }
    };

    let keep = KeepAlive::new()
        .interval(Duration::from_secs(15))
        .text("ping");
    Sse::new(stream).keep_alive(keep).into_response()
}
