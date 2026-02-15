use std::collections::HashMap;

use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use super::super::{
    DirectoryQuery, is_safe_repo_rel_path, lock_repo, map_git_failure, require_directory,
    require_directory_raw, run_git,
};

use super::file_diff::GitFileDiffQuery;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictsListResponse {
    pub files: Vec<String>,
}

pub async fn git_conflicts_list(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };
    // `ls-files -u` is the most reliable source for unresolved entries,
    // including cases where conflict markers are not textual.
    let (code, out, err) =
        run_git(&dir, &["ls-files", "-u"])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim()})),
        )
            .into_response();
    }
    let mut files: Vec<String> = Vec::new();
    for line in out.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let path = if let Some((_left, right)) = t.split_once('\t') {
            right.trim()
        } else {
            t.split_whitespace().last().unwrap_or("").trim()
        };
        if !path.is_empty() {
            files.push(path.to_string());
        }
    }
    files.sort();
    files.dedup();
    Json(GitConflictsListResponse { files }).into_response()
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConflictBlock {
    pub id: usize,
    pub ours_label: Option<String>,
    pub base_label: Option<String>,
    pub theirs_label: Option<String>,
    pub ours: String,
    pub base: String,
    pub theirs: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictFileResponse {
    pub path: String,
    pub text: String,
    pub blocks: Vec<ConflictBlock>,
    pub has_markers: bool,
    pub is_unmerged: bool,
}

async fn git_path_is_unmerged(dir: &std::path::Path, path: &str) -> bool {
    let (code, out, _) = run_git(dir, &["ls-files", "-u", "--", path])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    code == 0 && out.lines().any(|line| !line.trim().is_empty())
}

fn parse_conflict_markers(text: &str) -> Vec<ConflictBlock> {
    let mut blocks: Vec<ConflictBlock> = Vec::new();
    let mut state = 0;
    let mut ours: Vec<String> = Vec::new();
    let mut base: Vec<String> = Vec::new();
    let mut theirs: Vec<String> = Vec::new();
    let mut ours_label: Option<String> = None;
    let mut base_label: Option<String> = None;
    let mut id: usize = 0;

    for line in text.lines() {
        if line.starts_with("<<<<<<<") {
            state = 1;
            ours.clear();
            base.clear();
            theirs.clear();
            ours_label = line
                .strip_prefix("<<<<<<<")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            base_label = None;
            continue;
        }
        if state == 1 && line.starts_with("|||||||") {
            state = 2;
            base_label = line
                .strip_prefix("|||||||")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            continue;
        }
        if (state == 1 || state == 2) && line.starts_with("=======") {
            state = 3;
            continue;
        }
        if state == 3 && line.starts_with(">>>>>>>") {
            let theirs_label = line
                .strip_prefix(">>>>>>>")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            blocks.push(ConflictBlock {
                id,
                ours_label: ours_label.clone(),
                base_label: base_label.clone(),
                theirs_label,
                ours: ours.join("\n"),
                base: base.join("\n"),
                theirs: theirs.join("\n"),
            });
            id += 1;
            state = 0;
            continue;
        }

        if state == 1 {
            ours.push(line.to_string());
        } else if state == 2 {
            base.push(line.to_string());
        } else if state == 3 {
            theirs.push(line.to_string());
        }
    }

    blocks
}

pub async fn git_conflict_file(Query(q): Query<GitFileDiffQuery>) -> Response {
    // Reuse `GitFileDiffQuery` for directory+path query params.
    let dir = match require_directory_raw(q.directory.as_deref()) {
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
            Json(serde_json::json!({"error": "path parameter is required"})),
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

    let full = dir.join(path);
    let Ok(meta) = tokio::fs::metadata(&full).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "File not found", "code": "not_found"})),
        )
            .into_response();
    };
    if !meta.is_file() || meta.len() > (512 * 1024) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "File too large", "code": "too_large"})),
        )
            .into_response();
    }

    let is_unmerged = git_path_is_unmerged(&dir, path).await;
    let text = tokio::fs::read_to_string(&full).await.unwrap_or_default();
    let blocks = parse_conflict_markers(&text);
    let has_markers = !blocks.is_empty()
        && text.contains("<<<<<<<")
        && text.contains(">>>>>>>")
        && text.contains("=======");
    Json(GitConflictFileResponse {
        path: path.to_string(),
        text,
        blocks,
        has_markers,
        is_unmerged,
    })
    .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictResolveBody {
    pub path: Option<String>,
    // "ours" | "theirs" | "base" | "both" | "manual"
    pub strategy: Option<String>,
    #[serde(default)]
    pub stage: Option<bool>,
    // For "manual": list of (block id -> choice)
    pub choices: Option<Vec<serde_json::Value>>,
}

fn apply_conflict_choices(
    text: &str,
    choices: &HashMap<usize, String>,
    default_choice: &str,
) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut state = 0;
    let mut ours: Vec<String> = Vec::new();
    let mut base: Vec<String> = Vec::new();
    let mut theirs: Vec<String> = Vec::new();
    let mut id: usize = 0;

    for line in text.lines() {
        if line.starts_with("<<<<<<<") {
            state = 1;
            ours.clear();
            base.clear();
            theirs.clear();
            continue;
        }
        if state == 1 && line.starts_with("|||||||") {
            state = 2;
            continue;
        }
        if (state == 1 || state == 2) && line.starts_with("=======") {
            state = 3;
            continue;
        }
        if state == 3 && line.starts_with(">>>>>>>") {
            let choice = choices
                .get(&id)
                .map(|s| s.as_str())
                .unwrap_or(default_choice);
            if choice == "ours" {
                out.extend(ours.clone());
            } else if choice == "base" {
                out.extend(base.clone());
            } else if choice == "theirs" {
                out.extend(theirs.clone());
            } else {
                // both
                out.extend(ours.clone());
                out.extend(theirs.clone());
            }
            id += 1;
            state = 0;
            continue;
        }

        if state == 0 {
            out.push(line.to_string());
        } else if state == 1 {
            ours.push(line.to_string());
        } else if state == 2 {
            base.push(line.to_string());
        } else {
            theirs.push(line.to_string());
        }
    }

    out.join("\n") + "\n"
}

pub async fn git_conflict_resolve(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitConflictResolveBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let _guard = match lock_repo(&dir).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let Some(path) = body
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
    let strategy = body
        .strategy
        .as_deref()
        .unwrap_or("manual")
        .trim()
        .to_ascii_lowercase();
    let stage = body.stage.unwrap_or(true);

    if strategy == "ours" || strategy == "theirs" {
        let flag = if strategy == "ours" {
            "--ours"
        } else {
            "--theirs"
        };
        let (code, out, err) = run_git(&dir, &["checkout", flag, "--", path])
            .await
            .unwrap_or((1, "".to_string(), "".to_string()));
        if code != 0 {
            if let Some(resp) = map_git_failure(code, &out, &err) {
                return resp;
            }
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": err.trim(),
                    "code": "checkout_conflict_failed"
                })),
            )
                .into_response();
        }
    } else {
        let full = dir.join(path);
        let text = tokio::fs::read_to_string(&full).await.unwrap_or_default();
        if !text.contains("<<<<<<<") {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "No conflict markers found",
                    "code": "no_markers"
                })),
            )
                .into_response();
        }

        let mut map: HashMap<usize, String> = HashMap::new();
        if let Some(list) = body.choices {
            for item in list {
                let Some(id) = item.get("id").and_then(|v| v.as_u64()) else {
                    continue;
                };
                let Some(choice) = item.get("choice").and_then(|v| v.as_str()) else {
                    continue;
                };
                let c = choice.trim().to_ascii_lowercase();
                if c == "ours" || c == "theirs" || c == "base" || c == "both" {
                    map.insert(id as usize, c);
                }
            }
        }

        let default_choice = if strategy == "both" {
            "both"
        } else if strategy == "base" {
            "base"
        } else {
            "ours"
        };
        let new_text = apply_conflict_choices(&text, &map, default_choice);
        if let Err(e) = tokio::fs::write(&full, new_text).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string(), "code": "write_failed"})),
            )
                .into_response();
        }
    }

    if stage {
        let (code, out, err) = run_git(&dir, &["add", "--", path]).await.unwrap_or((
            1,
            "".to_string(),
            "".to_string(),
        ));
        if code != 0 {
            if let Some(resp) = map_git_failure(code, &out, &err) {
                return resp;
            }
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": err.trim(), "code": "stage_failed"})),
            )
                .into_response();
        }
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[cfg(test)]
mod tests {
    use super::{apply_conflict_choices, parse_conflict_markers};
    use std::collections::HashMap;

    #[test]
    fn parse_diff3_markers_extracts_base_section() {
        let text =
            "a\n<<<<<<< ours\nleft\n||||||| base\ncommon\n=======\nright\n>>>>>>> theirs\nz\n";
        let blocks = parse_conflict_markers(text);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].ours, "left");
        assert_eq!(blocks[0].base, "common");
        assert_eq!(blocks[0].theirs, "right");
    }

    #[test]
    fn apply_choices_supports_base_pick() {
        let text =
            "x\n<<<<<<< ours\nleft\n||||||| base\ncommon\n=======\nright\n>>>>>>> theirs\ny\n";
        let mut picks: HashMap<usize, String> = HashMap::new();
        picks.insert(0, "base".to_string());
        let resolved = apply_conflict_choices(text, &picks, "ours");
        assert_eq!(resolved, "x\ncommon\ny\n");
    }
}
