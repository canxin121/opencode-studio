use std::time::Duration;

use axum::Json;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheckResponse {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    package_manager: String,
    update_command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

const PACKAGE_NAME: &str = "@opencode-studio/web";
const NPM_REGISTRY_URL: &str = "https://registry.npmjs.org/%40opencode-studio%2Fweb";
const CHANGELOG_URL: &str = "";

fn parse_version_num(raw: &str) -> Option<i64> {
    let raw = raw.trim().trim_start_matches('v');
    let mut parts = raw.split('.');
    let major: i64 = parts.next()?.parse().ok()?;
    let minor: i64 = parts.next().unwrap_or("0").parse().ok()?;
    let patch: i64 = parts.next().unwrap_or("0").parse().ok()?;
    Some(major * 10000 + minor * 100 + patch)
}

async fn try_read_web_pkg_version() -> Option<String> {
    // Dev-friendly: if the monorepo is present, reuse the web package version.
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../web/package.json");
    let raw = tokio::fs::read_to_string(path).await.ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("version")?.as_str().map(|s| s.trim().to_string())
}

async fn get_current_version() -> String {
    if let Ok(v) = std::env::var("OPENCODE_STUDIO_UPDATE_CURRENT_VERSION") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return v;
        }
    }
    try_read_web_pkg_version()
        .await
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

async fn get_latest_version() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let resp = client
        .get(NPM_REGISTRY_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: serde_json::Value = resp.json().await.ok()?;
    v.get("dist-tags")
        .and_then(|x| x.get("latest"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_update_command() -> String {
    // This repo is bun-only. Keep the UI update hint aligned with our supported tooling.
    format!("bun add -g {PACKAGE_NAME}@latest")
}

async fn fetch_changelog_notes(from_version: &str, to_version: &str) -> Option<String> {
    if CHANGELOG_URL.trim().is_empty() {
        return None;
    }

    let (from_num, to_num) = (
        parse_version_num(from_version)?,
        parse_version_num(to_version)?,
    );
    if to_num <= from_num {
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let resp = client.get(CHANGELOG_URL).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let text = resp.text().await.ok()?;

    let mut out: Vec<String> = Vec::new();
    for section in text.split("\n## ").skip(1) {
        let head = section.lines().next().unwrap_or("");
        let ver = head
            .trim()
            .trim_start_matches('[')
            .split(']')
            .next()
            .unwrap_or("");
        let Some(num) = parse_version_num(ver) else {
            continue;
        };
        if num > from_num && num <= to_num {
            out.push(format!("## {}", section.trim()));
        }
    }

    if out.is_empty() {
        None
    } else {
        Some(out.join("\n\n"))
    }
}

pub async fn update_check() -> Json<UpdateCheckResponse> {
    let current_version = get_current_version().await;
    let pm = "bun".to_string();
    let update_command = get_update_command();

    let Some(latest_version) = get_latest_version().await else {
        return Json(UpdateCheckResponse {
            available: false,
            version: None,
            current_version,
            body: None,
            package_manager: pm,
            update_command,
            error: Some("Unable to determine latest version".to_string()),
        });
    };

    let available = match (
        parse_version_num(&current_version),
        parse_version_num(&latest_version),
    ) {
        (Some(cur), Some(lat)) => lat > cur,
        _ => false,
    };

    let body = if available {
        fetch_changelog_notes(&current_version, &latest_version).await
    } else {
        None
    };

    Json(UpdateCheckResponse {
        available,
        version: Some(latest_version),
        current_version,
        body,
        package_manager: pm,
        update_command,
        error: None,
    })
}
