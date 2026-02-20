use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use dashmap::DashMap;
use tokio::process::Command;
use tokio::sync::Mutex;

const DEFAULT_GIT_TIMEOUT: Duration = Duration::from_secs(60);

fn parse_git_subcommand<'a>(args: &'a [&'a str]) -> Option<&'a str> {
    let mut i = 0usize;
    while i < args.len() {
        let token = args[i].trim();
        if token.is_empty() {
            i += 1;
            continue;
        }
        // Skip common global options before the subcommand.
        if token == "-c"
            || token == "-C"
            || token == "--git-dir"
            || token == "--work-tree"
            || token == "--namespace"
            || token == "--super-prefix"
            || token == "--config-env"
        {
            i += 2;
            continue;
        }
        if token.starts_with('-') {
            i += 1;
            continue;
        }
        return Some(token);
    }
    None
}

fn operation_from_args(args: &[&str]) -> Option<&'static str> {
    let subcommand = parse_git_subcommand(args)?;
    match subcommand {
        "commit" => Some("commit"),
        "push" => Some("push"),
        "pull" => Some("pull"),
        "fetch" => Some("fetch"),
        "rebase" => Some("rebase"),
        "merge" => Some("merge"),
        "cherry-pick" => Some("cherry-pick"),
        "revert" => Some("revert"),
        "add" => Some("stage"),
        "apply" => {
            let reverse = args.contains(&"--reverse");
            let cached = args.contains(&"--cached");
            if reverse && cached {
                Some("unstage")
            } else if reverse {
                Some("discard")
            } else if cached {
                Some("stage")
            } else {
                Some("patch")
            }
        }
        _ => None,
    }
}

fn emit_git_telemetry(args: &[&str], code: i32, stdout: &str, stderr: &str, elapsed: Duration) {
    let Some(operation) = operation_from_args(args) else {
        return;
    };

    let latency_ms = elapsed.as_secs_f64() * 1000.0;
    if code == 0 {
        tracing::info!(
            target: "opencode_studio.git.metrics",
            git_operation = operation,
            git_success = true,
            git_exit_code = code,
            git_latency_ms = latency_ms,
            "git operation finished"
        );
        return;
    }

    let classification = super::utils::classify_git_failure(code, stdout, stderr);
    let error_code = classification.map(|it| it.code).unwrap_or("git_failed");
    let error_category = classification.map(|it| it.category).unwrap_or("unknown");
    let retryable = classification.map(|it| it.retryable).unwrap_or(false);

    tracing::warn!(
        target: "opencode_studio.git.metrics",
        git_operation = operation,
        git_success = false,
        git_exit_code = code,
        git_latency_ms = latency_ms,
        git_error_code = error_code,
        git_error_category = error_category,
        git_retryable = retryable,
        "git operation failed"
    );
}

fn git_timeout() -> Duration {
    if let Ok(v) = std::env::var("OPENCODE_STUDIO_GIT_TIMEOUT_MS")
        && let Ok(ms) = v.trim().parse::<u64>()
        && ms > 0
    {
        return Duration::from_millis(ms);
    }
    DEFAULT_GIT_TIMEOUT
}

// VS Code queues git operations per repository. Do the same server-side so we don't
// race on the index/worktree (and to reduce index.lock errors under rapid UI clicks).
static REPO_LOCKS: OnceLock<DashMap<String, Arc<Mutex<()>>>> = OnceLock::new();

fn repo_lock_key(dir: &Path) -> String {
    dir.to_string_lossy().to_string()
}

pub(crate) async fn lock_repo(dir: &Path) -> Result<tokio::sync::OwnedMutexGuard<()>, Response> {
    let key = repo_lock_key(dir);
    let locks = REPO_LOCKS.get_or_init(DashMap::new);
    let m = if let Some(v) = locks.get(&key) {
        v.value().clone()
    } else {
        let v = Arc::new(Mutex::new(()));
        locks.insert(key.clone(), v.clone());
        v
    };

    match tokio::time::timeout(Duration::from_secs(10), m.clone().lock_owned()).await {
        Ok(g) => Ok(g),
        Err(_) => Err((
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "Repository is busy running another git operation",
                "code": "git_busy",
                "hint": "Wait for the current operation to finish, then retry.",
            })),
        )
            .into_response()),
    }
}

pub(crate) async fn run_git_env(
    directory: &Path,
    args: &[&str],
    extra_env: &[(&str, &str)],
) -> Result<(i32, String, String), String> {
    use tokio::io::AsyncReadExt;
    let started_at = Instant::now();

    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(directory)
        // Prevent hanging on interactive credential prompts.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        // Prevent spawning an interactive editor in server mode.
        .env("GIT_EDITOR", "true")
        .env("EDITOR", "true")
        // Ensure that non-interactive git operations never steal the server's TTY
        // (e.g. pinentry-tty printing a passphrase prompt in the server console).
        .env("GPG_TTY", "")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        use std::io;

        unsafe {
            cmd.pre_exec(|| {
                // Detach from the parent's controlling terminal so /dev/tty is unavailable.
                let rc = libc::setsid();
                if rc == -1 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    for (k, v) in extra_env {
        cmd.env(k, v);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();

    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(s) = stdout.as_mut() {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(s) = stderr.as_mut() {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    });

    let timeout = git_timeout();
    let mut timed_out = false;
    let status = tokio::select! {
        status = child.wait() => status,
        _ = tokio::time::sleep(timeout) => {
            timed_out = true;
            let _ = child.kill().await;
            child.wait().await
        }
    };

    let stdout_bytes = stdout_task.await.unwrap_or_default();
    let stderr_bytes = stderr_task.await.unwrap_or_default();
    let stdout_text = String::from_utf8_lossy(&stdout_bytes).to_string();
    let mut stderr_text = String::from_utf8_lossy(&stderr_bytes).to_string();

    let mut code = status.ok().and_then(|s| s.code()).unwrap_or(1);
    if timed_out {
        // Use a conventional timeout exit code so callers can classify.
        code = 124;
        let prefix = format!("git command timed out after {}ms\n", timeout.as_millis());
        if stderr_text.trim().is_empty() {
            stderr_text = prefix;
        } else {
            stderr_text = format!("{}{}", prefix, stderr_text);
        }
    }

    emit_git_telemetry(args, code, &stdout_text, &stderr_text, started_at.elapsed());
    Ok((code, stdout_text, stderr_text))
}

pub(crate) async fn run_git_input(
    directory: &Path,
    args: &[&str],
    extra_env: &[(&str, &str)],
    input: &str,
) -> Result<(i32, String, String), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let started_at = Instant::now();

    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(directory)
        // Prevent hanging on interactive credential prompts.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        // Prevent spawning an interactive editor in server mode.
        .env("GIT_EDITOR", "true")
        .env("EDITOR", "true")
        // Ensure that non-interactive git operations never steal the server's TTY
        // (e.g. pinentry-tty printing a passphrase prompt in the server console).
        .env("GPG_TTY", "")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        use std::io;

        unsafe {
            cmd.pre_exec(|| {
                let rc = libc::setsid();
                if rc == -1 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    for (k, v) in extra_env {
        cmd.env(k, v);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes()).await;
    }

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();

    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(s) = stdout.as_mut() {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(s) = stderr.as_mut() {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    });

    let timeout = git_timeout();
    let mut timed_out = false;
    let status = tokio::select! {
        status = child.wait() => status,
        _ = tokio::time::sleep(timeout) => {
            timed_out = true;
            let _ = child.kill().await;
            child.wait().await
        }
    };

    let stdout_bytes = stdout_task.await.unwrap_or_default();
    let stderr_bytes = stderr_task.await.unwrap_or_default();
    let stdout_text = String::from_utf8_lossy(&stdout_bytes).to_string();
    let mut stderr_text = String::from_utf8_lossy(&stderr_bytes).to_string();

    let mut code = status.ok().and_then(|s| s.code()).unwrap_or(1);
    if timed_out {
        code = 124;
        let prefix = format!("git command timed out after {}ms\n", timeout.as_millis());
        if stderr_text.trim().is_empty() {
            stderr_text = prefix;
        } else {
            stderr_text = format!("{}{}", prefix, stderr_text);
        }
    }

    emit_git_telemetry(args, code, &stdout_text, &stderr_text, started_at.elapsed());
    Ok((code, stdout_text, stderr_text))
}

pub(crate) async fn run_git_with_input(
    directory: &Path,
    args: &[&str],
    input: &str,
) -> Result<(i32, String, String), String> {
    run_git_input(directory, args, &[], input).await
}

pub(crate) async fn run_git(
    directory: &Path,
    args: &[&str],
) -> Result<(i32, String, String), String> {
    run_git_env(directory, args, &[]).await
}
