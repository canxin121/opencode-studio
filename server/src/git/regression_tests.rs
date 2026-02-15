use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use axum::{Json, body::to_bytes, extract::Query, http::StatusCode, response::Response};
use serde_json::Value;
use tempfile::TempDir;

use super::{
    CheckoutBody, CreateBranchBody, DirectoryQuery, GitAbortBody, GitConflictResolveBody,
    GitDiffQuery, GitFetchBody, GitFileDiffQuery, GitPullBody, GitRemoteBranchesQuery,
    GitStatusQuery, GitTagCreateBody, GitTagDeleteBody, git_check, git_checkout, git_conflict_file,
    git_conflict_resolve, git_conflicts_list, git_create_branch, git_diff, git_fetch, git_pull,
    git_rebase_abort, git_remote_branches_list, git_stash_list, git_state, git_status,
    git_tags_create, git_tags_delete,
};

fn run_git(cwd: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap_or_else(|err| panic!("failed to run git {:?}: {err}", args))
}

fn run_git_ok(cwd: &Path, args: &[&str]) -> String {
    let out = run_git(cwd, args);
    if !out.status.success() {
        panic!(
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn run_git_expect_fail(cwd: &Path, args: &[&str]) {
    let out = run_git(cwd, args);
    assert!(
        !out.status.success(),
        "expected git {:?} to fail\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

fn write_file(path: &Path, content: &str) {
    fs::write(path, content).unwrap_or_else(|err| panic!("write {} failed: {err}", path.display()));
}

fn append_file(path: &Path, content: &str) {
    let mut f = fs::OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap_or_else(|err| panic!("open {} failed: {err}", path.display()));
    f.write_all(content.as_bytes())
        .unwrap_or_else(|err| panic!("append {} failed: {err}", path.display()));
}

fn init_repo(dir: &Path) {
    fs::create_dir_all(dir).unwrap_or_else(|err| panic!("mkdir {} failed: {err}", dir.display()));
    run_git_ok(dir, &["init", "-q"]);
    run_git_ok(dir, &["branch", "-M", "main"]);
    run_git_ok(dir, &["config", "user.name", "OpenCode Studio Fixture"]);
    run_git_ok(
        dir,
        &["config", "user.email", "fixture@opencode-studio.local"],
    );
    run_git_ok(dir, &["config", "commit.gpgsign", "false"]);
}

fn mk_basic_repo(root: &Path) -> PathBuf {
    let repo = root.join("basic");
    init_repo(&repo);

    write_file(&repo.join("a.txt"), "line1\nline2\nline3\nline4\n");
    write_file(&repo.join("staged.txt"), "s0\n");
    write_file(&repo.join("stashme.txt"), "keep\n");
    run_git_ok(&repo, &["add", "a.txt", "staged.txt", "stashme.txt"]);
    run_git_ok(&repo, &["commit", "-q", "-m", "init"]);

    append_file(&repo.join("stashme.txt"), "stash-change\n");
    write_file(&repo.join("stash_untracked.txt"), "untracked-to-stash\n");
    run_git_ok(
        &repo,
        &[
            "stash",
            "push",
            "-q",
            "--include-untracked",
            "-m",
            "fixture stash",
        ],
    );

    write_file(&repo.join("staged.txt"), "s1\n");
    run_git_ok(&repo, &["add", "staged.txt"]);

    write_file(
        &repo.join("a.txt"),
        "line1\nline2-changed\nline3\nline4\nline5-added\n",
    );
    write_file(&repo.join("b.txt"), "newfile\n");

    repo
}

fn mk_conflict_repo(root: &Path) -> PathBuf {
    let repo = root.join("conflict");
    init_repo(&repo);

    write_file(&repo.join("conflict.txt"), "base\n");
    run_git_ok(&repo, &["add", "conflict.txt"]);
    run_git_ok(&repo, &["commit", "-q", "-m", "base"]);

    run_git_ok(&repo, &["checkout", "-q", "-b", "theirs"]);
    write_file(&repo.join("conflict.txt"), "theirs\n");
    run_git_ok(&repo, &["add", "conflict.txt"]);
    run_git_ok(&repo, &["commit", "-q", "-m", "theirs change"]);

    run_git_ok(&repo, &["checkout", "-q", "main"]);
    write_file(&repo.join("conflict.txt"), "ours\n");
    run_git_ok(&repo, &["add", "conflict.txt"]);
    run_git_ok(&repo, &["commit", "-q", "-m", "ours change"]);

    run_git_expect_fail(&repo, &["merge", "-q", "theirs"]);
    repo
}

fn mk_rebase_repo(root: &Path) -> PathBuf {
    let repo = root.join("rebase");
    init_repo(&repo);

    write_file(&repo.join("rebase.txt"), "base\n");
    run_git_ok(&repo, &["add", "rebase.txt"]);
    run_git_ok(&repo, &["commit", "-q", "-m", "base"]);

    run_git_ok(&repo, &["checkout", "-q", "-b", "topic"]);
    write_file(&repo.join("rebase.txt"), "topic\n");
    run_git_ok(&repo, &["add", "rebase.txt"]);
    run_git_ok(&repo, &["commit", "-q", "-m", "topic change"]);

    run_git_ok(&repo, &["checkout", "-q", "main"]);
    write_file(&repo.join("rebase.txt"), "main\n");
    run_git_ok(&repo, &["add", "rebase.txt"]);
    run_git_ok(&repo, &["commit", "-q", "-m", "main change"]);

    run_git_ok(&repo, &["checkout", "-q", "topic"]);
    run_git_expect_fail(&repo, &["rebase", "-q", "main"]);
    repo
}

fn mk_remote_suite(root: &Path) -> PathBuf {
    let remote = root.join("remote.git");
    let repo_a = root.join("repo_a");
    let repo_b = root.join("repo_b");

    fs::create_dir_all(root).unwrap_or_else(|err| panic!("mkdir {} failed: {err}", root.display()));

    let remote_s = remote.to_string_lossy().to_string();
    let repo_a_s = repo_a.to_string_lossy().to_string();
    let repo_b_s = repo_b.to_string_lossy().to_string();

    run_git_ok(root, &["init", "-q", "--bare", remote_s.as_str()]);
    run_git_ok(root, &["clone", "-q", remote_s.as_str(), repo_a_s.as_str()]);

    run_git_ok(&repo_a, &["branch", "-M", "main"]);
    run_git_ok(&repo_a, &["config", "user.name", "OC2 Fixture"]);
    run_git_ok(
        &repo_a,
        &["config", "user.email", "fixture@opencode-studio.local"],
    );
    run_git_ok(&repo_a, &["config", "commit.gpgsign", "false"]);

    write_file(&repo_a.join("base.txt"), "base\n");
    run_git_ok(&repo_a, &["add", "base.txt"]);
    run_git_ok(&repo_a, &["commit", "-q", "-m", "init"]);
    run_git_ok(&repo_a, &["push", "-q", "-u", "origin", "main"]);

    write_file(&repo_a.join("local.txt"), "local\n");
    run_git_ok(&repo_a, &["add", "local.txt"]);
    run_git_ok(&repo_a, &["commit", "-q", "-m", "local commit"]);

    run_git_ok(root, &["clone", "-q", remote_s.as_str(), repo_b_s.as_str()]);
    run_git_ok(&repo_b, &["checkout", "-q", "main"]);
    run_git_ok(&repo_b, &["config", "user.name", "OC2 Fixture"]);
    run_git_ok(
        &repo_b,
        &["config", "user.email", "fixture@opencode-studio.local"],
    );
    run_git_ok(&repo_b, &["config", "commit.gpgsign", "false"]);

    write_file(&repo_b.join("remote.txt"), "remote\n");
    run_git_ok(&repo_b, &["add", "remote.txt"]);
    run_git_ok(&repo_b, &["commit", "-q", "-m", "remote commit"]);
    run_git_ok(&repo_b, &["push", "-q"]);

    repo_a
}

async fn response_json(resp: Response) -> (StatusCode, Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .expect("read response body");
    let value = serde_json::from_slice::<Value>(&bytes).unwrap_or_else(|err| {
        panic!(
            "invalid json response ({status}): {err}; body={} ",
            String::from_utf8_lossy(&bytes)
        )
    });
    (status, value)
}

async fn expect_ok_json(resp: Response) -> Value {
    let (status, value) = response_json(resp).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "unexpected status {status}: {value}"
    );
    value
}

fn value_i64(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}

#[tokio::test]
async fn git_basic_endpoints_are_covered_by_automated_test() {
    let tmp = TempDir::new().expect("tempdir");
    let repo = mk_basic_repo(tmp.path());
    let repo_s = repo.to_string_lossy().to_string();

    let check = expect_ok_json(
        git_check(Query(DirectoryQuery {
            directory: Some(repo_s.clone()),
        }))
        .await,
    )
    .await;
    assert_eq!(
        check.get("isGitRepository").and_then(Value::as_bool),
        Some(true)
    );

    let status = expect_ok_json(
        git_status(Query(GitStatusQuery {
            directory: Some(repo_s.clone()),
            offset: None,
            limit: None,
            scope: None,
            summary: Some(true),
            include_diff_stats: None,
        }))
        .await,
    )
    .await;
    assert!(value_i64(&status, "stagedCount") >= 1);
    assert!(value_i64(&status, "unstagedCount") >= 1);
    assert!(value_i64(&status, "untrackedCount") >= 1);

    let stash = expect_ok_json(
        git_stash_list(Query(DirectoryQuery {
            directory: Some(repo_s.clone()),
        }))
        .await,
    )
    .await;
    let stashes = stash
        .get("stashes")
        .and_then(Value::as_array)
        .expect("stashes should be an array");
    assert!(!stashes.is_empty());

    let diff = expect_ok_json(
        git_diff(Query(GitDiffQuery {
            directory: Some(repo_s.clone()),
            path: Some("a.txt".to_string()),
            staged: Some("false".to_string()),
            context_lines: Some("3".to_string()),
            include_meta: None,
        }))
        .await,
    )
    .await;
    let diff_text = diff
        .get("diff")
        .and_then(Value::as_str)
        .expect("diff text should exist");
    assert!(diff_text.contains("@@"));

    let tag_create = expect_ok_json(
        git_tags_create(
            Query(DirectoryQuery {
                directory: Some(repo_s.clone()),
            }),
            Json(GitTagCreateBody {
                name: Some("v0.0.0-smoke".to_string()),
                r#ref: Some("HEAD".to_string()),
                message: Some("smoke".to_string()),
            }),
        )
        .await,
    )
    .await;
    assert_eq!(
        tag_create.get("success").and_then(Value::as_bool),
        Some(true)
    );

    let tag_delete = expect_ok_json(
        git_tags_delete(
            Query(DirectoryQuery {
                directory: Some(repo_s.clone()),
            }),
            Json(GitTagDeleteBody {
                name: Some("v0.0.0-smoke".to_string()),
            }),
        )
        .await,
    )
    .await;
    assert_eq!(
        tag_delete.get("success").and_then(Value::as_bool),
        Some(true)
    );

    let branch_create = expect_ok_json(
        git_create_branch(
            Query(DirectoryQuery {
                directory: Some(repo_s.clone()),
            }),
            Json(CreateBranchBody {
                name: Some("fixture-branch".to_string()),
                start_point: Some("HEAD".to_string()),
            }),
        )
        .await,
    )
    .await;
    assert_eq!(
        branch_create.get("success").and_then(Value::as_bool),
        Some(true)
    );

    let checkout = expect_ok_json(
        git_checkout(
            Query(DirectoryQuery {
                directory: Some(repo_s),
            }),
            Json(CheckoutBody {
                branch: Some("main".to_string()),
            }),
        )
        .await,
    )
    .await;
    assert_eq!(checkout.get("success").and_then(Value::as_bool), Some(true));
}

#[tokio::test]
async fn git_conflict_endpoints_are_covered_by_automated_test() {
    let tmp = TempDir::new().expect("tempdir");
    let repo = mk_conflict_repo(tmp.path());
    let repo_s = repo.to_string_lossy().to_string();

    let status = expect_ok_json(
        git_status(Query(GitStatusQuery {
            directory: Some(repo_s.clone()),
            offset: None,
            limit: None,
            scope: None,
            summary: Some(true),
            include_diff_stats: None,
        }))
        .await,
    )
    .await;
    assert!(value_i64(&status, "mergeCount") >= 1);

    let conflicts = expect_ok_json(
        git_conflicts_list(Query(DirectoryQuery {
            directory: Some(repo_s.clone()),
        }))
        .await,
    )
    .await;
    let files = conflicts
        .get("files")
        .and_then(Value::as_array)
        .expect("files should be an array");
    assert!(files.iter().any(|v| v.as_str() == Some("conflict.txt")));

    let conflict_file = expect_ok_json(
        git_conflict_file(Query(GitFileDiffQuery {
            directory: Some(repo_s.clone()),
            path: Some("conflict.txt".to_string()),
            staged: None,
        }))
        .await,
    )
    .await;
    let blocks = conflict_file
        .get("blocks")
        .and_then(Value::as_array)
        .expect("blocks should be an array");
    assert!(!blocks.is_empty());

    let resolved = expect_ok_json(
        git_conflict_resolve(
            Query(DirectoryQuery {
                directory: Some(repo_s.clone()),
            }),
            Json(GitConflictResolveBody {
                path: Some("conflict.txt".to_string()),
                strategy: Some("ours".to_string()),
                stage: Some(true),
                choices: None,
            }),
        )
        .await,
    )
    .await;
    assert_eq!(resolved.get("success").and_then(Value::as_bool), Some(true));

    let conflicts_after = expect_ok_json(
        git_conflicts_list(Query(DirectoryQuery {
            directory: Some(repo_s),
        }))
        .await,
    )
    .await;
    let files_after = conflicts_after
        .get("files")
        .and_then(Value::as_array)
        .expect("files should be an array");
    assert!(files_after.is_empty());
}

#[tokio::test]
async fn git_rebase_abort_is_covered_by_automated_test() {
    let tmp = TempDir::new().expect("tempdir");
    let repo = mk_rebase_repo(tmp.path());
    let repo_s = repo.to_string_lossy().to_string();

    let state_before = expect_ok_json(
        git_state(Query(DirectoryQuery {
            directory: Some(repo_s.clone()),
        }))
        .await,
    )
    .await;
    assert_eq!(
        state_before
            .get("rebaseInProgress")
            .and_then(Value::as_bool),
        Some(true)
    );

    let abort = expect_ok_json(
        git_rebase_abort(
            Query(DirectoryQuery {
                directory: Some(repo_s.clone()),
            }),
            Json(GitAbortBody { _dummy: None }),
        )
        .await,
    )
    .await;
    assert_eq!(abort.get("success").and_then(Value::as_bool), Some(true));

    let state_after = expect_ok_json(
        git_state(Query(DirectoryQuery {
            directory: Some(repo_s),
        }))
        .await,
    )
    .await;
    assert_eq!(
        state_after.get("rebaseInProgress").and_then(Value::as_bool),
        Some(false)
    );
}

#[tokio::test]
async fn git_remote_fetch_pull_and_remote_branches_are_automated() {
    let tmp = TempDir::new().expect("tempdir");
    let repo = mk_remote_suite(tmp.path());
    let repo_s = repo.to_string_lossy().to_string();

    let fetch = expect_ok_json(
        git_fetch(
            Query(DirectoryQuery {
                directory: Some(repo_s.clone()),
            }),
            Json(GitFetchBody {
                remote: Some("origin".to_string()),
                branch: None,
                prune: None,
                all: None,
                r#ref: None,
                auth: None,
            }),
        )
        .await,
    )
    .await;
    assert_eq!(fetch.get("success").and_then(Value::as_bool), Some(true));

    let status_after_fetch = expect_ok_json(
        git_status(Query(GitStatusQuery {
            directory: Some(repo_s.clone()),
            offset: None,
            limit: None,
            scope: None,
            summary: Some(true),
            include_diff_stats: None,
        }))
        .await,
    )
    .await;
    assert!(value_i64(&status_after_fetch, "ahead") >= 1);
    assert!(value_i64(&status_after_fetch, "behind") >= 1);

    let pull = expect_ok_json(
        git_pull(
            Query(DirectoryQuery {
                directory: Some(repo_s.clone()),
            }),
            Json(GitPullBody {
                remote: None,
                branch: None,
                rebase: Some(true),
                r#ref: None,
                auth: None,
            }),
        )
        .await,
    )
    .await;
    assert_eq!(pull.get("success").and_then(Value::as_bool), Some(true));

    let status_after_pull = expect_ok_json(
        git_status(Query(GitStatusQuery {
            directory: Some(repo_s.clone()),
            offset: None,
            limit: None,
            scope: None,
            summary: Some(true),
            include_diff_stats: None,
        }))
        .await,
    )
    .await;
    assert_eq!(value_i64(&status_after_pull, "behind"), 0);

    let remote_branches = expect_ok_json(
        git_remote_branches_list(Query(GitRemoteBranchesQuery {
            directory: Some(repo_s),
            remote: Some("origin".to_string()),
        }))
        .await,
    )
    .await;
    let branches = remote_branches
        .get("branches")
        .and_then(Value::as_array)
        .expect("branches should be an array");
    assert!(branches.iter().any(|v| v.as_str() == Some("main")));
}
