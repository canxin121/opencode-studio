use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::{
    DirectoryQuery, abs_path, is_safe_repo_rel_path, map_git_failure, require_directory, run_git,
};

#[derive(Debug, Deserialize)]
pub struct GitBlameQuery {
    pub directory: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLine {
    pub line: usize,
    pub hash: String,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct GitBlameResponse {
    pub lines: Vec<GitBlameLine>,
}

const NOT_COMMITTED_HASH: &str = "0000000000000000000000000000000000000000";
const NOT_COMMITTED_AUTHOR: &str = "Not Committed Yet";
const NOT_COMMITTED_SUMMARY: &str = "Uncommitted changes";

fn is_hash(s: &str) -> bool {
    if s.len() != 40 {
        return false;
    }
    s.chars().all(|c| c.is_ascii_hexdigit())
}

#[derive(Debug, Clone, Default)]
struct BlameMeta {
    author: String,
    author_email: String,
    author_time: i64,
    summary: String,
}

fn parse_blame_header(line: &str) -> Option<(String, usize, usize)> {
    let mut parts = line.split_whitespace();
    let hash = parts.next()?;
    if !is_hash(hash) {
        return None;
    }

    let _orig_line = parts.next()?;
    let final_line = parts
        .next()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    let group_count = parts
        .next()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);

    Some((hash.to_string(), final_line, group_count))
}

fn has_meta(meta: &BlameMeta) -> bool {
    !meta.author.is_empty()
        || !meta.author_email.is_empty()
        || meta.author_time != 0
        || !meta.summary.is_empty()
}

fn parse_blame_porcelain(output: &str) -> Vec<GitBlameLine> {
    let mut lines = Vec::new();
    let mut meta_by_hash: HashMap<String, BlameMeta> = HashMap::new();

    let mut current_hash = String::new();
    let mut current_meta = BlameMeta::default();

    let mut remaining: usize = 0;
    let mut next_line: usize = 0;

    for line in output.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.starts_with('\t') {
            if remaining == 0 || current_hash.is_empty() {
                continue;
            }

            let meta = if has_meta(&current_meta) {
                current_meta.clone()
            } else {
                meta_by_hash.get(&current_hash).cloned().unwrap_or_default()
            };

            lines.push(GitBlameLine {
                line: next_line,
                hash: current_hash.clone(),
                author: meta.author.clone(),
                author_email: meta.author_email.clone(),
                author_time: meta.author_time,
                summary: meta.summary.clone(),
            });
            if has_meta(&meta) {
                meta_by_hash.insert(current_hash.clone(), meta);
            }

            next_line = next_line.saturating_add(1);
            remaining = remaining.saturating_sub(1);
            continue;
        }

        if let Some((hash, final_line, group_count)) = parse_blame_header(trimmed) {
            current_hash = hash;
            next_line = final_line;
            remaining = group_count;
            current_meta = meta_by_hash.get(&current_hash).cloned().unwrap_or_default();
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("author ") {
            current_meta.author = rest.to_string();
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("author-mail ") {
            current_meta.author_email = rest
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_string();
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("author-time ") {
            current_meta.author_time = rest.trim().parse::<i64>().unwrap_or(0);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("summary ") {
            current_meta.summary = rest.to_string();
            continue;
        }
    }

    lines.retain(|line| line.line > 0);
    lines
}

fn should_fallback_to_uncommitted_blame(stdout: &str, stderr: &str) -> bool {
    let combined = format!("{}\n{}", stdout, stderr).to_ascii_lowercase();
    combined.contains("no such path")
        && (combined.contains(" in head") || combined.contains(" in commit"))
}

fn build_uncommitted_blame_lines_from_content(content: &str) -> Vec<GitBlameLine> {
    let line_count = content.lines().count();
    (1..=line_count)
        .map(|line| GitBlameLine {
            line,
            hash: NOT_COMMITTED_HASH.to_string(),
            author: NOT_COMMITTED_AUTHOR.to_string(),
            author_email: String::new(),
            author_time: 0,
            summary: NOT_COMMITTED_SUMMARY.to_string(),
        })
        .collect()
}

fn build_uncommitted_blame_lines(path: &Path) -> Option<Vec<GitBlameLine>> {
    let bytes = std::fs::read(path).ok()?;
    let content = std::str::from_utf8(&bytes).ok()?;
    Some(build_uncommitted_blame_lines_from_content(content))
}

fn file_dir(path: &Path) -> PathBuf {
    path.parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| path.to_path_buf())
}

pub async fn git_blame(Query(q): Query<GitBlameQuery>) -> Response {
    let dir = match require_directory(&DirectoryQuery {
        directory: q.directory.clone(),
    }) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let Some(path) = q
        .path
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "path is required", "code": "missing_path"})),
        )
            .into_response();
    };

    if !is_safe_repo_rel_path(path) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
        )
            .into_response();
    }

    let abs = dir.join(path);
    if !abs.starts_with(&dir) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid path", "code": "invalid_path"})),
        )
            .into_response();
    }

    let cwd = file_dir(&abs);
    let (c0, o0, e0) = run_git(&cwd, &["rev-parse", "--show-toplevel"])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if c0 != 0 {
        if let Some(resp) = map_git_failure(c0, &o0, &e0) {
            return resp;
        }
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": e0.trim(), "code": "not_git_repo"})),
        )
            .into_response();
    }

    let repo_root = abs_path(o0.trim());
    if !abs.starts_with(&repo_root) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Path outside repo", "code": "invalid_path"})),
        )
            .into_response();
    }

    let rel = abs.strip_prefix(&repo_root).unwrap_or(&abs);
    let rel = rel
        .to_string_lossy()
        .trim_start_matches('/')
        .replace('\\', "/");

    let (code, out, err) = run_git(&repo_root, &["blame", "--line-porcelain", "--", &rel])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if should_fallback_to_uncommitted_blame(&out, &err)
            && let Some(lines) = build_uncommitted_blame_lines(&abs)
        {
            return Json(GitBlameResponse { lines }).into_response();
        }

        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_blame_failed"})),
        )
            .into_response();
    }

    let lines = parse_blame_porcelain(&out);
    Json(GitBlameResponse { lines }).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash_a() -> &'static str {
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }

    fn hash_b() -> &'static str {
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }

    #[test]
    fn parse_line_porcelain_with_repeated_headers() {
        let output = format!(
            "{h} 1 1 2\n\
author Alice\n\
author-mail <alice@example.com>\n\
author-time 1700000000\n\
summary Init\n\
filename src/main.rs\n\
\tline 1\n\
{h} 2 2\n\
author Alice\n\
author-mail <alice@example.com>\n\
author-time 1700000000\n\
summary Init\n\
filename src/main.rs\n\
\tline 2\n\
{h2} 3 3 1\n\
author Bob\n\
author-mail <bob@example.com>\n\
author-time 1700001000\n\
summary Update\n\
filename src/main.rs\n\
\tline 3\n",
            h = hash_a(),
            h2 = hash_b()
        );

        let lines = parse_blame_porcelain(&output);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].line, 1);
        assert_eq!(lines[0].hash, hash_a());
        assert_eq!(lines[0].author, "Alice");
        assert_eq!(lines[1].line, 2);
        assert_eq!(lines[1].author_email, "alice@example.com");
        assert_eq!(lines[2].line, 3);
        assert_eq!(lines[2].hash, hash_b());
        assert_eq!(lines[2].summary, "Update");
    }

    #[test]
    fn parse_porcelain_reuses_cached_metadata() {
        let output = format!(
            "{h} 10 10 2\n\
author Alice\n\
author-mail <alice@example.com>\n\
author-time 1700000000\n\
summary Init\n\
filename src/main.rs\n\
\tline 10\n\
\tline 11\n\
{h} 20 20 1\n\
\tline 20\n",
            h = hash_a()
        );

        let lines = parse_blame_porcelain(&output);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[2].line, 20);
        assert_eq!(lines[2].author, "Alice");
        assert_eq!(lines[2].summary, "Init");
    }

    #[test]
    fn fallback_blame_for_uncommitted_content_counts_lines() {
        let lines = build_uncommitted_blame_lines_from_content("one\ntwo\nthree\n");
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].line, 1);
        assert_eq!(lines[2].line, 3);
        assert_eq!(lines[0].author, NOT_COMMITTED_AUTHOR);
        assert_eq!(lines[0].hash, NOT_COMMITTED_HASH);
    }

    #[test]
    fn detects_missing_path_failure_for_fallback() {
        assert!(should_fallback_to_uncommitted_blame(
            "",
            "fatal: no such path 'foo.txt' in HEAD"
        ));
        assert!(!should_fallback_to_uncommitted_blame(
            "",
            "fatal: bad revision"
        ));
    }
}
