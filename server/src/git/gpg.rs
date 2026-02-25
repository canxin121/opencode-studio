use std::path::PathBuf;
use std::process::Stdio;

use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use tokio::process::Command;

use super::{DirectoryQuery, map_git_failure, require_directory, run_git};

fn hex_encode_utf8(s: &str) -> String {
    s.as_bytes().iter().map(|b| format!("{:02x}", b)).collect()
}

#[derive(Debug, Default, Clone)]
struct GpgSecretKeyInfo {
    keyid: Option<String>,
    fpr: Option<String>,
    grip: Option<String>,
}

async fn gpg_list_secret_keys_with_grip() -> Result<Vec<GpgSecretKeyInfo>, String> {
    let output = Command::new("gpg")
        .args(["--with-colons", "--with-keygrip", "--list-secret-keys"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let code = output.status.code().unwrap_or(1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if code != 0 {
        return Err(stderr.trim().to_string());
    }

    let mut out: Vec<GpgSecretKeyInfo> = Vec::new();
    let mut cur: Option<GpgSecretKeyInfo> = None;
    for line in stdout.lines() {
        let mut parts = line.split(':');
        let kind = parts.next().unwrap_or("");
        if kind == "sec" || kind == "ssb" {
            if let Some(prev) = cur.take() {
                out.push(prev);
            }
            let keyid = parts
                .nth(3)
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            cur = Some(GpgSecretKeyInfo {
                keyid,
                ..Default::default()
            });
            continue;
        }
        if kind == "fpr" {
            let fpr = parts
                .nth(8)
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            if let Some(c) = cur.as_mut() {
                c.fpr = fpr;
            }
            continue;
        }
        if kind == "grp" {
            let grip = parts
                .next()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            if let Some(c) = cur.as_mut() {
                c.grip = grip;
            }
            continue;
        }
    }
    if let Some(prev) = cur.take() {
        out.push(prev);
    }
    out.retain(|k| k.grip.as_deref().is_some_and(|g| !g.trim().is_empty()));
    Ok(out)
}

fn pick_keygrip(keys: &[GpgSecretKeyInfo], signing_key: Option<&str>) -> Option<String> {
    let needle = signing_key.unwrap_or("").trim().to_ascii_lowercase();
    if !needle.is_empty() {
        for k in keys {
            let keyid = k.keyid.as_deref().unwrap_or("").to_ascii_lowercase();
            let fpr = k.fpr.as_deref().unwrap_or("").to_ascii_lowercase();
            if ((!keyid.is_empty() && (keyid == needle || keyid.ends_with(&needle)))
                || (!fpr.is_empty() && (fpr == needle || fpr.ends_with(&needle))))
                && let Some(g) = k.grip.as_deref()
            {
                return Some(g.to_string());
            }
        }
    }
    keys.first().and_then(|k| k.grip.clone())
}

async fn gpg_preset_passphrase(keygrip: &str, passphrase: &str) -> Result<(), String> {
    let hex = hex_encode_utf8(passphrase);
    let cmd = format!("PRESET_PASSPHRASE {} -1 {}", keygrip, hex);
    let output = Command::new("gpg-connect-agent")
        .arg(cmd)
        .arg("/bye")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "gpg-agent preset failed".to_string()
        } else {
            err
        });
    }
    Ok(())
}

fn gpg_agent_conf_path() -> Option<PathBuf> {
    let home = crate::path_utils::home_dir_path()?;
    Some(home.join(".gnupg").join("gpg-agent.conf"))
}

async fn gpg_agent_enable_allow_preset_passphrase() -> Result<bool, String> {
    let Some(conf) = gpg_agent_conf_path() else {
        return Err("Home directory is not set; cannot locate ~/.gnupg/gpg-agent.conf".to_string());
    };

    if let Some(parent) = conf.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let existing = tokio::fs::read_to_string(&conf).await.unwrap_or_default();
    let has = existing
        .lines()
        .any(|l| l.trim() == "allow-preset-passphrase");
    if !has {
        let mut next = existing;
        if !next.ends_with('\n') && !next.is_empty() {
            next.push('\n');
        }
        next.push_str("# Added by OpenCode Studio to allow UI passphrase presetting\n");
        next.push_str("allow-preset-passphrase\n");
        tokio::fs::write(&conf, next)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Restart agent so the config applies.
    let out = Command::new("gpgconf")
        .args(["--kill", "gpg-agent"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "Failed to restart gpg-agent".to_string()
        } else {
            err
        });
    }

    Ok(!has)
}

pub async fn git_gpg_enable_preset_passphrase(Query(q): Query<DirectoryQuery>) -> Response {
    // Keep the directory requirement for consistent UI auth / routing, but the operation
    // is effectively user-global (gpg-agent is per-user).
    let _ = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    match gpg_agent_enable_allow_preset_passphrase().await {
        Ok(changed) => {
            Json(serde_json::json!({"success": true, "changed": changed})).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e, "code": "gpg_agent_config_failed"})),
        )
            .into_response(),
    }
}

pub async fn git_gpg_disable_signing(Query(q): Query<DirectoryQuery>) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };

    let (code, out, err) = run_git(&dir, &["config", "--local", "commit.gpgsign", "false"])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_config_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGpgSetSigningKeyBody {
    pub signing_key: Option<String>,
}

pub async fn git_gpg_set_signing_key(
    Query(q): Query<DirectoryQuery>,
    Json(body): Json<GitGpgSetSigningKeyBody>,
) -> Response {
    let dir = match require_directory(&q) {
        Ok(d) => d,
        Err(resp) => return *resp,
    };
    let Some(key) = body
        .signing_key
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "signingKey is required",
                "code": "missing_signing_key"
            })),
        )
            .into_response();
    };

    let (code, out, err) = run_git(&dir, &["config", "--local", "user.signingkey", key])
        .await
        .unwrap_or((1, "".to_string(), "".to_string()));
    if code != 0 {
        if let Some(resp) = map_git_failure(code, &out, &err) {
            return resp;
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": err.trim(), "code": "git_config_failed"})),
        )
            .into_response();
    }

    Json(serde_json::json!({"success": true})).into_response()
}

// Internal helpers used by commit signing.
pub(crate) async fn gpg_list_keys_for_signing()
-> Result<Vec<(Option<String>, Option<String>, Option<String>)>, String> {
    let keys = gpg_list_secret_keys_with_grip().await?;
    Ok(keys.into_iter().map(|k| (k.keyid, k.fpr, k.grip)).collect())
}

pub(crate) async fn gpg_preset_for_signing(
    signing_key: Option<&str>,
    passphrase: &str,
) -> Result<(), String> {
    let keys = gpg_list_secret_keys_with_grip().await?;
    let Some(grip) = pick_keygrip(&keys, signing_key) else {
        return Err("No GPG secret key with keygrip found".to_string());
    };
    gpg_preset_passphrase(&grip, passphrase).await
}
