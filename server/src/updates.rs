use std::cmp::Ordering;
use std::time::Duration;

use axum::{Json, extract::Query};
use serde::{Deserialize, Serialize};

const DEFAULT_RELEASE_REPO: &str = "canxin121/opencode-studio";
const GITHUB_API_BASE: &str = "https://api.github.com";
const SOURCE_KIND: &str = "githubRelease";

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheckQuery {
    installer_version: Option<String>,
    installer_target: Option<String>,
    installer_channel: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheckResponse {
    source: &'static str,
    repo: String,
    checked_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    release: Option<ReleaseSummary>,
    service: ServiceUpdateStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    installer: Option<InstallerUpdateStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseSummary {
    tag: String,
    version: String,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    published_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceUpdateStatus {
    current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest_version: Option<String>,
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    asset_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    asset_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    update_command: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallerUpdateStatus {
    current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest_version: Option<String>,
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    channel: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    assets: Vec<ReleaseAssetLink>,
    #[serde(skip_serializing_if = "Option::is_none")]
    primary_asset_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    primary_asset_url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReleaseAssetLink {
    name: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct VersionKey {
    major: u64,
    minor: u64,
    patch: u64,
    pre: Option<String>,
}

impl Ord for VersionKey {
    fn cmp(&self, other: &Self) -> Ordering {
        let core =
            (self.major, self.minor, self.patch).cmp(&(other.major, other.minor, other.patch));
        if core != Ordering::Equal {
            return core;
        }

        match (&self.pre, &other.pre) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(a), Some(b)) => compare_prerelease(a, b),
        }
    }
}

impl PartialOrd for VersionKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub async fn update_check(Query(query): Query<UpdateCheckQuery>) -> Json<UpdateCheckResponse> {
    let repo = release_repo();
    let checked_at = now_rfc3339();
    let service_current_version = current_service_version();
    let installer_runtime = InstallerRuntime::from_query(query);

    let mut response = UpdateCheckResponse {
        source: SOURCE_KIND,
        repo: repo.clone(),
        checked_at,
        release: None,
        service: ServiceUpdateStatus {
            current_version: service_current_version.clone(),
            latest_version: None,
            available: false,
            target: runtime_target_triple(),
            asset_name: None,
            asset_url: None,
            update_command: None,
        },
        installer: installer_runtime
            .as_ref()
            .map(|runtime| InstallerUpdateStatus {
                current_version: runtime.current_version.clone(),
                latest_version: None,
                available: false,
                target: runtime.target.clone(),
                channel: runtime.channel.clone(),
                assets: Vec::new(),
                primary_asset_name: None,
                primary_asset_url: None,
            }),
        error: None,
    };

    let release = match fetch_latest_release(&repo).await {
        Ok(value) => value,
        Err(err) => {
            response.error = Some(err);
            return Json(response);
        }
    };

    let latest_version = release_version(&release.tag_name);
    let release_url = nonempty(release.html_url.as_deref()).unwrap_or_else(|| {
        format!(
            "https://github.com/{}/releases/tag/{}",
            repo,
            release.tag_name.trim()
        )
    });
    let summary_version = latest_version
        .clone()
        .unwrap_or_else(|| normalize_release_tag(&release.tag_name));

    response.release = Some(ReleaseSummary {
        tag: release.tag_name.clone(),
        version: summary_version,
        url: release_url,
        body: nonempty(release.body.as_deref()),
        published_at: nonempty(release.published_at.as_deref()),
    });

    let service_target = response.service.target.clone();
    response.service.latest_version = latest_version.clone();
    response.service.available = latest_version
        .as_deref()
        .map(|latest| is_newer_version(&service_current_version, latest))
        .unwrap_or(false);

    if let Some(target) = service_target.as_deref() {
        let asset_name = service_asset_name(target);
        let asset_url = find_asset_url(&release.assets, &asset_name);
        response.service.asset_name = Some(asset_name);
        response.service.asset_url = asset_url.clone();
        response.service.update_command = build_service_update_command(asset_url.as_deref());
    }

    if let (Some(installer), Some(runtime)) =
        (response.installer.as_mut(), installer_runtime.as_ref())
    {
        installer.latest_version = latest_version.clone();
        installer.available = latest_version
            .as_deref()
            .map(|latest| is_newer_version(&runtime.current_version, latest))
            .unwrap_or(false);

        if let Some(target) = runtime.target.as_deref() {
            let mut assets = installer_assets_for_target(
                &release.assets,
                target,
                &runtime.channel,
                release.tag_name.trim(),
            );
            assets.sort_by(|a, b| {
                installer_asset_rank(&a.name, target)
                    .cmp(&installer_asset_rank(&b.name, target))
                    .then_with(|| a.name.cmp(&b.name))
            });
            installer.assets = assets;
            if let Some(primary) = installer.assets.first() {
                installer.primary_asset_name = Some(primary.name.clone());
                installer.primary_asset_url = Some(primary.url.clone());
            }
        }
    }

    Json(response)
}

#[derive(Debug)]
struct InstallerRuntime {
    current_version: String,
    target: Option<String>,
    channel: String,
}

impl InstallerRuntime {
    fn from_query(query: UpdateCheckQuery) -> Option<Self> {
        let current_version = nonempty(query.installer_version.as_deref())?;
        let target = nonempty(query.installer_target.as_deref());
        let channel = normalize_installer_channel(query.installer_channel.as_deref());
        Some(Self {
            current_version,
            target,
            channel,
        })
    }
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

fn nonempty(raw: Option<&str>) -> Option<String> {
    let txt = raw?.trim();
    if txt.is_empty() {
        None
    } else {
        Some(txt.to_string())
    }
}

fn release_repo() -> String {
    let Some(raw) = nonempty(
        std::env::var("OPENCODE_STUDIO_RELEASE_REPO")
            .ok()
            .as_deref(),
    ) else {
        return DEFAULT_RELEASE_REPO.to_string();
    };

    normalize_repo(&raw).unwrap_or_else(|| DEFAULT_RELEASE_REPO.to_string())
}

fn normalize_repo(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let (owner, name) = trimmed.split_once('/')?;
    if owner.is_empty() || name.is_empty() {
        return None;
    }
    if !owner
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return None;
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return None;
    }
    Some(format!("{owner}/{name}"))
}

fn current_service_version() -> String {
    nonempty(
        std::env::var("OPENCODE_STUDIO_UPDATE_SERVICE_VERSION")
            .ok()
            .as_deref(),
    )
    .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

fn normalize_release_tag(raw: &str) -> String {
    raw.trim().trim_start_matches(['v', 'V']).to_string()
}

fn release_version(tag: &str) -> Option<String> {
    let normalized = normalize_release_tag(tag);
    if normalized.is_empty() {
        return None;
    }
    parse_version(&normalized).map(|_| normalized)
}

fn parse_version(raw: &str) -> Option<VersionKey> {
    let normalized = normalize_release_tag(raw);
    let core_and_build = normalized.split('+').next().unwrap_or("");
    let (core, pre) = match core_and_build.split_once('-') {
        Some((left, right)) => (left, nonempty(Some(right))),
        None => (core_and_build, None),
    };

    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    if parts.next().is_some() {
        return None;
    }

    Some(VersionKey {
        major,
        minor,
        patch,
        pre,
    })
}

fn is_newer_version(current: &str, latest: &str) -> bool {
    match (parse_version(current), parse_version(latest)) {
        (Some(cur), Some(lat)) => lat > cur,
        _ => false,
    }
}

#[derive(Debug, Eq, PartialEq)]
enum PreIdentifier {
    Numeric(u64),
    Alpha(String),
}

fn parse_pre_identifiers(input: &str) -> Vec<PreIdentifier> {
    input
        .split('.')
        .filter_map(|part| {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                return None;
            }
            if trimmed.chars().all(|c| c.is_ascii_digit()) {
                return match trimmed.parse::<u64>() {
                    Ok(num) => Some(PreIdentifier::Numeric(num)),
                    Err(_) => Some(PreIdentifier::Alpha(trimmed.to_ascii_lowercase())),
                };
            }
            Some(PreIdentifier::Alpha(trimmed.to_ascii_lowercase()))
        })
        .collect()
}

fn compare_prerelease(a: &str, b: &str) -> Ordering {
    let left = parse_pre_identifiers(a);
    let right = parse_pre_identifiers(b);
    let max_len = left.len().max(right.len());

    for idx in 0..max_len {
        match (left.get(idx), right.get(idx)) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(PreIdentifier::Numeric(x)), Some(PreIdentifier::Numeric(y))) => {
                let ord = x.cmp(y);
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(PreIdentifier::Numeric(_)), Some(PreIdentifier::Alpha(_))) => {
                return Ordering::Less;
            }
            (Some(PreIdentifier::Alpha(_)), Some(PreIdentifier::Numeric(_))) => {
                return Ordering::Greater;
            }
            (Some(PreIdentifier::Alpha(x)), Some(PreIdentifier::Alpha(y))) => {
                let ord = x.cmp(y);
                if ord != Ordering::Equal {
                    return ord;
                }
            }
        }
    }

    Ordering::Equal
}

fn runtime_target_triple() -> Option<String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu".to_string()),
        ("macos", "x86_64") => Some("x86_64-apple-darwin".to_string()),
        ("macos", "aarch64") => Some("aarch64-apple-darwin".to_string()),
        ("windows", "x86_64") => Some("x86_64-pc-windows-msvc".to_string()),
        _ => None,
    }
}

fn service_asset_name(target: &str) -> String {
    if target.contains("windows") {
        format!("opencode-studio-{target}.zip")
    } else {
        format!("opencode-studio-{target}.tar.gz")
    }
}

fn find_asset_url(assets: &[GithubReleaseAsset], name: &str) -> Option<String> {
    assets
        .iter()
        .find(|asset| asset.name == name)
        .and_then(|asset| nonempty(Some(asset.browser_download_url.as_str())))
}

fn build_service_update_command(asset_url: Option<&str>) -> Option<String> {
    let url = nonempty(asset_url)?;
    if std::env::consts::OS == "windows" {
        Some(format!("curl -fL \"{url}\" -o opencode-studio.zip"))
    } else {
        Some(format!("curl -fL \"{url}\" -o opencode-studio.tar.gz"))
    }
}

fn normalize_installer_channel(raw: Option<&str>) -> String {
    let Some(value) = nonempty(raw) else {
        return "main".to_string();
    };
    if value.eq_ignore_ascii_case("cef") {
        "cef".to_string()
    } else {
        "main".to_string()
    }
}

fn installer_assets_for_target(
    assets: &[GithubReleaseAsset],
    target: &str,
    channel: &str,
    release_tag: &str,
) -> Vec<ReleaseAssetLink> {
    let suffix = if channel == "cef" { "-cef" } else { "" };
    let prefix = format!("opencode-studio-desktop-full-{target}{suffix}-{release_tag}.");

    assets
        .iter()
        .filter(|asset| asset.name.starts_with(&prefix))
        .filter_map(|asset| {
            let url = nonempty(Some(asset.browser_download_url.as_str()))?;
            Some(ReleaseAssetLink {
                name: asset.name.clone(),
                url,
            })
        })
        .collect()
}

fn installer_asset_rank(name: &str, target: &str) -> usize {
    let lower = name.to_ascii_lowercase();
    if target.contains("windows") {
        if lower.ends_with(".msi") {
            return 0;
        }
        if lower.ends_with(".exe") {
            return 1;
        }
        return 99;
    }

    if target.contains("apple") || target.contains("darwin") {
        if lower.ends_with(".dmg") {
            return 0;
        }
        return 99;
    }

    if lower.ends_with(".appimage") {
        return 0;
    }
    if lower.ends_with(".deb") {
        return 1;
    }
    if lower.ends_with(".rpm") {
        return 2;
    }
    99
}

async fn fetch_latest_release(repo: &str) -> Result<GithubRelease, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|err| format!("build http client: {err}"))?;

    let url = format!("{GITHUB_API_BASE}/repos/{repo}/releases/latest");
    let resp = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, "opencode-studio-update-check")
        .send()
        .await
        .map_err(|err| format!("request GitHub release: {err}"))?;

    if !resp.status().is_success() {
        return Err(format!("request GitHub release failed ({})", resp.status()));
    }

    resp.json::<GithubRelease>()
        .await
        .map_err(|err| format!("decode GitHub release payload: {err}"))
}
