use std::path::PathBuf;

use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitAuthInput {
    pub username: Option<String>,
    pub password: Option<String>,
}

pub(crate) fn normalize_http_auth(auth: &GitAuthInput) -> Option<(String, String)> {
    let username = auth.username.as_deref().unwrap_or("").trim().to_string();
    let password = auth.password.as_deref().unwrap_or("").trim().to_string();
    if username.is_empty() || password.is_empty() {
        return None;
    }
    Some((username, password))
}

fn git_http_auth_options(username: &str, password: &str) -> Vec<String> {
    // Avoid putting secrets directly into argv.
    // We still disable credential helpers so the operation is predictable.
    let _ = (username, password);
    vec!["-c".into(), "credential.helper=".into()]
}

pub(crate) struct TempGitAskpass {
    pub(crate) path: PathBuf,
}

impl Drop for TempGitAskpass {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

async fn create_git_askpass_script() -> Result<TempGitAskpass, String> {
    // This script contains no secrets; it reads them from env vars.
    // Using a temp file is not ideal, but keeps credentials out of argv.
    let mut path = std::env::temp_dir();
    path.push(format!(
        "opencode-studio-git-askpass-{}.sh",
        crate::issue_token()
    ));

    let body = "#!/usr/bin/env sh\n\
set -e\n\
prompt=\"$1\"\n\
case \"$prompt\" in\n\
  *Username*|*username*) printf '%s' \"${OC_GIT_ASKPASS_USERNAME:-}\" ;;\n\
  *) printf '%s' \"${OC_GIT_ASKPASS_PASSWORD:-}\" ;;\n\
esac\n";

    tokio::fs::write(&path, body)
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o700);
        std::fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
    }

    Ok(TempGitAskpass { path })
}

pub(crate) async fn git_http_auth_env(
    username: &str,
    password: &str,
) -> Result<(Vec<String>, Vec<(String, String)>, TempGitAskpass), String> {
    let args = git_http_auth_options(username, password);
    let askpass = create_git_askpass_script().await?;
    let env = vec![
        (
            "GIT_ASKPASS".to_string(),
            askpass.path.to_string_lossy().into_owned(),
        ),
        (
            "OC_GIT_ASKPASS_USERNAME".to_string(),
            username.trim().to_string(),
        ),
        (
            "OC_GIT_ASKPASS_PASSWORD".to_string(),
            password.trim().to_string(),
        ),
    ];
    Ok((args, env, askpass))
}
