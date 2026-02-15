use serde::Serialize;

use super::super::is_safe_repo_rel_path;

#[derive(Debug, Default, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PatchSummary {
    pub files: usize,
    pub hunks: usize,
    pub changed_lines: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnifiedDiffHunkMeta {
    pub id: String,
    pub header: String,
    pub range: String,
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
    pub additions: usize,
    pub deletions: usize,
    pub anchor_line: usize,
    pub lines: Vec<String>,
    pub patch: String,
    pub patch_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnifiedDiffMeta {
    pub file_header: Vec<String>,
    pub has_patch_header: bool,
    pub hunks: Vec<UnifiedDiffHunkMeta>,
    pub summary: PatchSummary,
}

#[derive(Debug, Clone, Copy)]
struct HunkHeader {
    old_start: usize,
    old_count: usize,
    new_start: usize,
    new_count: usize,
}

fn parse_hunk_header(header: &str) -> Option<HunkHeader> {
    let rest = header.strip_prefix("@@ -")?;
    let (left, right_with_tail) = rest.split_once(" +")?;
    let (right, _tail) = right_with_tail.split_once(" @@")?;

    let parse_side = |part: &str| -> Option<(usize, usize)> {
        let trimmed = part.trim();
        if let Some((start, count)) = trimmed.split_once(',') {
            Some((
                start.trim().parse::<usize>().ok()?,
                count.trim().parse::<usize>().ok()?,
            ))
        } else {
            Some((trimmed.parse::<usize>().ok()?, 1))
        }
    };

    let (old_start, old_count) = parse_side(left)?;
    let (new_start, new_count) = parse_side(right)?;
    Some(HunkHeader {
        old_start,
        old_count,
        new_start,
        new_count,
    })
}

fn parse_hunk_counts(header: &str) -> Option<(usize, usize)> {
    parse_hunk_header(header).map(|h| (h.old_count, h.new_count))
}

fn format_hunk_range(h: HunkHeader) -> String {
    format!(
        "-{},{} +{},{}",
        h.old_start, h.old_count, h.new_start, h.new_count
    )
}

fn count_hunk_changes(lines: &[String]) -> (usize, usize) {
    let mut additions = 0usize;
    let mut deletions = 0usize;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if line.starts_with("+++")
            || line.starts_with("---")
            || line.starts_with("@@")
            || line.starts_with("\\ No newline at end of file")
        {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }
    (additions, deletions)
}

fn compute_hunk_anchor_line(hunk: HunkHeader, lines: &[String]) -> usize {
    let mut new_line = std::cmp::max(1usize, hunk.new_start);
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let prefix = line.chars().next().unwrap_or('\0');
        match prefix {
            ' ' => {
                new_line += 1;
            }
            '+' | '-' => {
                return std::cmp::max(1usize, new_line);
            }
            _ => {}
        }
    }

    if hunk.new_start > 0 {
        std::cmp::max(1usize, hunk.new_start)
    } else {
        std::cmp::max(1usize, hunk.old_start)
    }
}

fn build_hunk_patch(file_header: &[String], header: &str, lines: &[String]) -> String {
    let mut out = String::new();
    for line in file_header {
        out.push_str(line);
        out.push('\n');
    }
    out.push_str(header);
    out.push('\n');
    for line in lines {
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn normalize_lines(diff: &str) -> Vec<String> {
    let mut lines: Vec<String> = diff
        .split('\n')
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect();
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    lines
}

fn push_hunk_meta(
    hunks: &mut Vec<UnifiedDiffHunkMeta>,
    file_header: &[String],
    header_text: &str,
    header_info: Option<HunkHeader>,
    lines: &[String],
) {
    let Some(info) = header_info else {
        return;
    };
    let (additions, deletions) = count_hunk_changes(lines);
    let has_patch_header = file_header
        .iter()
        .any(|line| line.starts_with("diff --git ") || line.starts_with("--- "));
    let patch = if has_patch_header {
        build_hunk_patch(file_header, header_text, lines)
    } else {
        String::new()
    };

    hunks.push(UnifiedDiffHunkMeta {
        id: (hunks.len() + 1).to_string(),
        header: header_text.to_string(),
        range: format_hunk_range(info),
        old_start: info.old_start,
        old_count: info.old_count,
        new_start: info.new_start,
        new_count: info.new_count,
        additions,
        deletions,
        anchor_line: compute_hunk_anchor_line(info, lines),
        lines: lines.to_vec(),
        patch,
        patch_ready: has_patch_header,
    });
}

pub(crate) fn parse_unified_diff_meta(diff: &str) -> UnifiedDiffMeta {
    if diff.trim().is_empty() {
        return UnifiedDiffMeta {
            file_header: Vec::new(),
            has_patch_header: false,
            hunks: Vec::new(),
            summary: PatchSummary::default(),
        };
    }

    let lines = normalize_lines(diff);
    if lines.is_empty() {
        return UnifiedDiffMeta {
            file_header: Vec::new(),
            has_patch_header: false,
            hunks: Vec::new(),
            summary: PatchSummary::default(),
        };
    }

    let mut file_header: Vec<String> = Vec::new();
    let mut hunks: Vec<UnifiedDiffHunkMeta> = Vec::new();
    let mut in_header = false;
    let mut current_header = String::new();
    let mut current_header_info: Option<HunkHeader> = None;
    let mut current_lines: Vec<String> = Vec::new();
    let mut collecting_hunk = false;
    let mut saw_file_header = false;

    for raw_line in &lines {
        let line = raw_line.as_str();

        if line.starts_with("diff --git ") {
            if collecting_hunk {
                push_hunk_meta(
                    &mut hunks,
                    &file_header,
                    &current_header,
                    current_header_info,
                    &current_lines,
                );
                current_lines.clear();
                collecting_hunk = false;
            }
            if saw_file_header {
                break;
            }
            saw_file_header = true;
            file_header = vec![line.to_string()];
            in_header = true;
            continue;
        }

        if in_header {
            if line.starts_with("@@") {
                current_header = line.to_string();
                current_header_info = parse_hunk_header(line);
                current_lines.clear();
                collecting_hunk = true;
                in_header = false;
            } else {
                file_header.push(line.to_string());
            }
            continue;
        }

        if line.starts_with("@@") {
            if collecting_hunk {
                push_hunk_meta(
                    &mut hunks,
                    &file_header,
                    &current_header,
                    current_header_info,
                    &current_lines,
                );
                current_lines.clear();
            }
            current_header = line.to_string();
            current_header_info = parse_hunk_header(line);
            collecting_hunk = true;
            continue;
        }

        if collecting_hunk {
            current_lines.push(line.to_string());
            continue;
        }

        if line.starts_with("--- ")
            || line.starts_with("+++ ")
            || line.starts_with("index ")
            || line.starts_with("new file mode")
            || line.starts_with("deleted file mode")
            || line.starts_with("similarity index")
            || line.starts_with("rename from")
            || line.starts_with("rename to")
            || line.starts_with("copy from")
            || line.starts_with("copy to")
            || line.starts_with("Binary files ")
            || line.starts_with("GIT binary patch")
        {
            file_header.push(line.to_string());
        }
    }

    if collecting_hunk {
        push_hunk_meta(
            &mut hunks,
            &file_header,
            &current_header,
            current_header_info,
            &current_lines,
        );
    }

    let has_patch_header = file_header
        .iter()
        .any(|line| line.starts_with("diff --git ") || line.starts_with("--- "));
    let hunk_count = hunks.len();
    let changed_lines = hunks
        .iter()
        .map(|hunk| hunk.additions + hunk.deletions)
        .sum::<usize>();
    let files = if !file_header.is_empty() || !hunks.is_empty() {
        1
    } else {
        0
    };

    UnifiedDiffMeta {
        file_header,
        has_patch_header,
        hunks,
        summary: PatchSummary {
            files,
            hunks: hunk_count,
            changed_lines,
        },
    }
}

fn finalize_hunk(
    summary: &mut PatchSummary,
    active_hunk: &mut Option<(usize, usize, usize, usize)>,
) -> Result<(), &'static str> {
    let Some((expected_old, expected_new, seen_old, seen_new)) = *active_hunk else {
        return Ok(());
    };
    if expected_old != seen_old || expected_new != seen_new {
        return Err("invalid_patch_hunk_counts");
    }
    summary.hunks += 1;
    *active_hunk = None;
    Ok(())
}

pub(crate) fn validate_unified_patch_hunks(patch: &str) -> Result<PatchSummary, &'static str> {
    let mut summary = PatchSummary::default();
    let mut active_hunk: Option<(usize, usize, usize, usize)> = None;
    let mut saw_old_header = false;
    let mut saw_new_header = false;

    for raw_line in patch.lines() {
        let line = raw_line.trim_end_matches('\r');

        if line.starts_with("diff --git ") {
            finalize_hunk(&mut summary, &mut active_hunk)?;
            summary.files += 1;
            continue;
        }

        if line.starts_with("--- ") {
            saw_old_header = true;
            continue;
        }
        if line.starts_with("+++ ") {
            saw_new_header = true;
            continue;
        }

        if let Some((old_count, new_count)) = parse_hunk_counts(line) {
            finalize_hunk(&mut summary, &mut active_hunk)?;
            active_hunk = Some((old_count, new_count, 0, 0));
            continue;
        }

        if let Some((_, _, seen_old, seen_new)) = active_hunk.as_mut() {
            if line.starts_with(' ') {
                *seen_old += 1;
                *seen_new += 1;
                continue;
            }
            if line.starts_with('+') {
                *seen_new += 1;
                summary.changed_lines += 1;
                continue;
            }
            if line.starts_with('-') {
                *seen_old += 1;
                summary.changed_lines += 1;
                continue;
            }
            if line.starts_with("\\ No newline at end of file") {
                continue;
            }
            return Err("invalid_patch_hunk_line");
        }

        if line.is_empty()
            || line.starts_with("index ")
            || line.starts_with("new file mode ")
            || line.starts_with("deleted file mode ")
            || line.starts_with("old mode ")
            || line.starts_with("new mode ")
            || line.starts_with("similarity index ")
            || line.starts_with("rename from ")
            || line.starts_with("rename to ")
            || line.starts_with("copy from ")
            || line.starts_with("copy to ")
            || line.starts_with("Binary files ")
            || line.starts_with("GIT binary patch")
        {
            continue;
        }

        return Err("invalid_patch_format");
    }

    finalize_hunk(&mut summary, &mut active_hunk)?;

    if summary.files == 0 && saw_old_header && saw_new_header {
        summary.files = 1;
    }
    if summary.files == 0 {
        return Err("invalid_patch_missing_file");
    }
    if summary.hunks == 0 {
        return Err("invalid_patch_missing_hunks");
    }
    if summary.changed_lines == 0 {
        return Err("invalid_patch_no_changes");
    }

    Ok(summary)
}

pub(crate) fn patch_paths_are_safe(patch: &str) -> bool {
    let mut found = false;
    for line in patch.lines() {
        let path = if let Some(rest) = line.strip_prefix("--- ") {
            rest
        } else if let Some(rest) = line.strip_prefix("+++ ") {
            rest
        } else {
            continue;
        };
        let token = path.split('\t').next().unwrap_or(path).trim();
        if token == "/dev/null" {
            continue;
        }
        let cleaned = token
            .strip_prefix("a/")
            .or_else(|| token.strip_prefix("b/"))
            .unwrap_or(token)
            .trim();
        if cleaned.is_empty() {
            return false;
        }
        if !is_safe_repo_rel_path(cleaned) {
            return false;
        }
        found = true;
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_PATCH: &str = "diff --git a/a.txt b/a.txt\nindex 1111111..2222222 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-old\n+new\n keep\n";

    #[test]
    fn validates_hunk_counts() {
        let summary = validate_unified_patch_hunks(SAMPLE_PATCH).expect("valid patch");
        assert_eq!(summary.files, 1);
        assert_eq!(summary.hunks, 1);
        assert_eq!(summary.changed_lines, 2);
    }

    #[test]
    fn rejects_bad_hunk_counts() {
        let bad = SAMPLE_PATCH.replace("@@ -1,2 +1,2 @@", "@@ -1,1 +1,1 @@");
        assert_eq!(
            validate_unified_patch_hunks(&bad).err(),
            Some("invalid_patch_hunk_counts")
        );
    }

    #[test]
    fn parses_diff_meta_for_editor_actions() {
        let meta = parse_unified_diff_meta(SAMPLE_PATCH);
        assert_eq!(meta.summary.files, 1);
        assert_eq!(meta.summary.hunks, 1);
        assert!(meta.has_patch_header);
        assert_eq!(meta.hunks.len(), 1);
        let hunk = &meta.hunks[0];
        assert_eq!(hunk.range, "-1,2 +1,2");
        assert_eq!(hunk.additions, 1);
        assert_eq!(hunk.deletions, 1);
        assert!(hunk.patch.contains("@@ -1,2 +1,2 @@"));
        assert!(hunk.patch_ready);
    }

    #[test]
    fn rejects_unsafe_patch_paths() {
        let bad = SAMPLE_PATCH
            .replace("--- a/a.txt", "--- a/../../etc/passwd")
            .replace("+++ b/a.txt", "+++ b/../../etc/passwd");
        assert!(!patch_paths_are_safe(&bad));
    }
}
