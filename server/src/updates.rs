use std::cmp::Ordering;
use std::time::Duration;

use axum::{Json, extract::Query};
use serde::{Deserialize, Serialize};

const DEFAULT_RELEASE_REPO: &str = "canxin121/opencode-studio";
const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_WEB_BASE: &str = "https://github.com";
const SOURCE_KIND: &str = "githubRelease";

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheckQuery {
    installer_version: Option<String>,
    installer_target: Option<String>,
    installer_channel: Option<String>,
    installer_type: Option<String>,
    installer_manager: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    selection_error: Option<InstallerSelectionError>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReleaseAssetLink {
    name: String,
    url: String,
    installer_type: String,
    manager: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallerSelectionError {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_installer_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_manager: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    available_identities: Vec<AssetIdentity>,
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
            target: preferred_service_target_triple(),
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
                selection_error: None,
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
        let release_tag = release.tag_name.trim();
        let (asset_name, asset_url) = resolve_release_asset_url(
            &release.assets,
            &repo,
            release_tag,
            service_asset_candidates(target, release_tag).as_slice(),
        );
        if let Some(asset_name) = asset_name.as_deref() {
            response.service.target = service_asset_target_from_name(asset_name, release_tag)
                .or_else(|| response.service.target.clone());
        }
        response.service.asset_name = asset_name;
        response.service.asset_url = asset_url.clone();
        response.service.update_command = build_service_update_command(
            asset_url.as_deref(),
            response.service.asset_name.as_deref(),
        );
    }

    if let (Some(installer), Some(runtime)) =
        (response.installer.as_mut(), installer_runtime.as_ref())
    {
        installer.latest_version = latest_version.clone();
        let version_available = latest_version
            .as_deref()
            .map(|latest| is_newer_version(&runtime.current_version, latest))
            .unwrap_or(false);
        installer.available = false;

        let Some(target_raw) = runtime.target.as_deref() else {
            installer.selection_error = Some(missing_target_error());
            return Json(response);
        };

        let Some(target) = normalize_installer_target(target_raw) else {
            installer.selection_error = Some(unsupported_target_error(target_raw));
            return Json(response);
        };

        installer.target = Some(target.to_string());
        let mut assets = installer_assets_for_target(
            &release.assets,
            &repo,
            target,
            &runtime.channel,
            release.tag_name.trim(),
        );
        assets.sort_by(|a, b| a.name.cmp(&b.name));
        installer.assets = assets;
        let selected = select_primary_installer_asset(runtime, installer.assets.as_slice());
        installer.selection_error = selected.selection_error;
        if let Some(primary) = selected.primary_asset {
            installer.primary_asset_name = Some(primary.name.clone());
            installer.primary_asset_url = Some(primary.url.clone());
            installer.available = version_available;
        }
    }

    Json(response)
}

#[derive(Debug)]
struct InstallerRuntime {
    current_version: String,
    target: Option<String>,
    channel: String,
    installer_type: Option<String>,
    installer_manager: Option<String>,
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
            installer_type: normalize_installer_type(query.installer_type.as_deref()),
            installer_manager: normalize_installer_manager(query.installer_manager.as_deref()),
        })
    }
}

#[derive(Debug, Serialize, Clone, Eq, PartialEq, Ord, PartialOrd)]
#[serde(rename_all = "camelCase")]
struct AssetIdentity {
    installer_type: String,
    manager: String,
}

impl AssetIdentity {
    fn from_parts(installer_type: &str, manager: &str) -> Self {
        Self {
            installer_type: installer_type.to_string(),
            manager: manager.to_string(),
        }
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

fn preferred_service_target_triple() -> Option<String> {
    preferred_service_target_triple_for(std::env::consts::OS, std::env::consts::ARCH)
        .map(ToString::to_string)
}

fn preferred_service_target_triple_for(os: &str, arch: &str) -> Option<&'static str> {
    let os = normalize_runtime_os(os);
    let arch = normalize_runtime_arch(arch);

    match (os.as_str(), arch.as_str()) {
        ("linux", "x86_64") => Some("x86_64-unknown-linux-musl"),
        ("linux", "aarch64") => Some("aarch64-unknown-linux-musl"),
        ("linux", "i686") => Some("i686-unknown-linux-musl"),
        ("linux", "armv7") => Some("armv7-unknown-linux-musleabihf"),
        _ => runtime_target_triple_for(os.as_str(), arch.as_str(), cfg!(target_env = "musl")),
    }
}

fn runtime_target_triple_for(os: &str, arch: &str, musl: bool) -> Option<&'static str> {
    let os = normalize_runtime_os(os);
    let arch = normalize_runtime_arch(arch);

    match (os.as_str(), arch.as_str(), musl) {
        ("linux", "x86_64", true) => Some("x86_64-unknown-linux-musl"),
        ("linux", "x86_64", false) => Some("x86_64-unknown-linux-gnu"),
        ("linux", "aarch64", true) => Some("aarch64-unknown-linux-musl"),
        ("linux", "aarch64", false) => Some("aarch64-unknown-linux-gnu"),
        ("linux", "i686", true) => Some("i686-unknown-linux-musl"),
        ("linux", "i686", false) => Some("i686-unknown-linux-gnu"),
        // Release builds only publish armv7 hard-float for 32-bit ARM.
        ("linux", "armv7", true) => Some("armv7-unknown-linux-musleabihf"),
        ("linux", "armv7", false) => Some("armv7-unknown-linux-gnueabihf"),
        ("macos", "x86_64", _) => Some("x86_64-apple-darwin"),
        ("macos", "aarch64", _) => Some("aarch64-apple-darwin"),
        ("windows", "x86_64", _) => Some("x86_64-pc-windows-msvc"),
        ("windows", "aarch64", _) => Some("aarch64-pc-windows-msvc"),
        _ => None,
    }
}

fn normalize_runtime_os(raw: &str) -> String {
    let lower = raw.trim().to_ascii_lowercase();
    match lower.as_str() {
        "darwin" | "osx" => "macos".to_string(),
        "win32" => "windows".to_string(),
        _ => lower,
    }
}

fn normalize_runtime_arch(raw: &str) -> String {
    let lower = raw.trim().to_ascii_lowercase();
    match lower.as_str() {
        "amd64" => "x86_64".to_string(),
        "arm64" => "aarch64".to_string(),
        // Common variants from uname -m / tooling.
        "i386" => "i686".to_string(),
        "x86" => "i686".to_string(),
        "arm" => "armv7".to_string(),
        "armv7l" | "armv7" => "armv7".to_string(),
        _ => lower,
    }
}

fn service_asset_candidates(target: &str, release_tag: &str) -> Vec<String> {
    let tag = release_tag.trim();
    let (primary_ext, secondary_ext) = if is_windows_target(target) {
        ("zip", "tar.gz")
    } else {
        ("tar.gz", "zip")
    };

    let mut candidates = Vec::new();
    for candidate_target in service_target_candidates(target) {
        for ext in [primary_ext, secondary_ext] {
            candidates.push(format!(
                "opencode-studio-backend-{candidate_target}-{tag}.{ext}"
            ));
            candidates.push(format!("opencode-studio-backend-{candidate_target}.{ext}"));
            candidates.push(format!("opencode-studio-{candidate_target}-{tag}.{ext}"));
            candidates.push(format!("opencode-studio-{candidate_target}.{ext}"));
        }
    }
    candidates
}

fn service_target_candidates(target: &str) -> Vec<&str> {
    match target.trim() {
        "x86_64-unknown-linux-musl" | "x86_64-unknown-linux-gnu" => {
            vec!["x86_64-unknown-linux-musl", "x86_64-unknown-linux-gnu"]
        }
        "aarch64-unknown-linux-musl" | "aarch64-unknown-linux-gnu" => {
            vec!["aarch64-unknown-linux-musl", "aarch64-unknown-linux-gnu"]
        }
        "i686-unknown-linux-musl" | "i686-unknown-linux-gnu" => {
            vec!["i686-unknown-linux-musl", "i686-unknown-linux-gnu"]
        }
        "armv7-unknown-linux-musleabihf" | "armv7-unknown-linux-gnueabihf" => {
            vec![
                "armv7-unknown-linux-musleabihf",
                "armv7-unknown-linux-gnueabihf",
            ]
        }
        _ => vec![target.trim()],
    }
}

fn service_asset_target_from_name(asset_name: &str, release_tag: &str) -> Option<String> {
    let tag = release_tag.trim();
    for prefix in ["opencode-studio-backend-", "opencode-studio-"] {
        let Some(rest) = asset_name.strip_prefix(prefix) else {
            continue;
        };
        for suffix in [
            format!("-{tag}.tar.gz"),
            ".tar.gz".to_string(),
            format!("-{tag}.zip"),
            ".zip".to_string(),
        ] {
            if let Some(target) = rest.strip_suffix(&suffix)
                && !target.is_empty()
            {
                return Some(target.to_string());
            }
        }
    }

    None
}

fn resolve_release_asset_url(
    assets: &[GithubReleaseAsset],
    repo: &str,
    release_tag: &str,
    candidates: &[String],
) -> (Option<String>, Option<String>) {
    for name in candidates {
        if let Some(url) = find_asset_url(assets, name) {
            return (Some(name.clone()), Some(url));
        }
    }

    // If GitHub returned an explicit asset list, fail fast instead of guessing.
    if !assets.is_empty() {
        return (None, None);
    }

    let primary = candidates.first().cloned();
    let url = primary
        .as_deref()
        .map(|name| release_asset_url(repo, release_tag, name));
    (primary, url)
}

fn find_asset_url(assets: &[GithubReleaseAsset], name: &str) -> Option<String> {
    assets
        .iter()
        .find(|asset| asset.name == name)
        .and_then(|asset| nonempty(Some(asset.browser_download_url.as_str())))
}

fn build_service_update_command(
    asset_url: Option<&str>,
    asset_name: Option<&str>,
) -> Option<String> {
    let url = nonempty(asset_url)?;
    Some(build_service_update_command_for(
        std::env::consts::OS,
        asset_name,
        &url,
    ))
}

fn build_service_update_command_for(os: &str, asset_name: Option<&str>, url: &str) -> String {
    let guessed_name = asset_name.unwrap_or("");
    let lower = guessed_name.to_ascii_lowercase();
    let out = if lower.ends_with(".zip") || os == "windows" {
        "opencode-studio.zip"
    } else {
        "opencode-studio.tar.gz"
    };
    format!("curl -fL \"{url}\" -o {out}")
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

fn normalize_installer_type(raw: Option<&str>) -> Option<String> {
    let value = nonempty(raw)?;
    match value.to_ascii_lowercase().as_str() {
        "exe" | "msi" | "dmg" | "appimage" | "deb" | "rpm" | "pkg" => {
            Some(value.to_ascii_lowercase())
        }
        _ => None,
    }
}

fn normalize_installer_manager(raw: Option<&str>) -> Option<String> {
    let value = nonempty(raw)?;
    match value.to_ascii_lowercase().as_str() {
        "direct" | "winget" | "choco" | "scoop" | "brew" | "apt" | "dnf" | "pacman" => {
            Some(value.to_ascii_lowercase())
        }
        _ => None,
    }
}

fn installer_assets_for_target(
    assets: &[GithubReleaseAsset],
    repo: &str,
    target: &str,
    channel: &str,
    release_tag: &str,
) -> Vec<ReleaseAssetLink> {
    let prefix = installer_asset_prefix(target, channel, release_tag);

    let mut links = assets
        .iter()
        .filter(|asset| asset.name.starts_with(&prefix))
        .filter_map(|asset| {
            let url = nonempty(Some(asset.browser_download_url.as_str()))?;
            let identity = classify_asset_identity(&asset.name)?;
            Some(ReleaseAssetLink {
                name: asset.name.clone(),
                url,
                installer_type: identity.installer_type,
                manager: identity.manager,
            })
        })
        .collect::<Vec<_>>();

    // Only guess URLs when we do not have an asset listing (web fallback mode).
    if links.is_empty() && assets.is_empty() {
        links = installer_expected_asset_names(target, channel, release_tag)
            .into_iter()
            .filter_map(|name| {
                let identity = classify_asset_identity(&name)?;
                Some(ReleaseAssetLink {
                    url: release_asset_url(repo, release_tag, &name),
                    name,
                    installer_type: identity.installer_type,
                    manager: identity.manager,
                })
            })
            .collect();
    }

    links
}

const SUPPORTED_INSTALLER_TARGETS: &[&str] = &[
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
    "x86_64-pc-windows-msvc",
    "aarch64-pc-windows-msvc",
];

fn normalize_installer_target(raw: &str) -> Option<&'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    SUPPORTED_INSTALLER_TARGETS
        .iter()
        .copied()
        .find(|candidate| trimmed.eq_ignore_ascii_case(candidate))
}

fn unsupported_target_error(raw: &str) -> InstallerSelectionError {
    InstallerSelectionError {
        code: "unsupportedTarget".to_string(),
        message: format!(
            "unsupported installer target: {raw}; expected one of: {}",
            SUPPORTED_INSTALLER_TARGETS.join(", ")
        ),
        expected_target: nonempty(Some(raw)),
        expected_installer_type: None,
        expected_manager: None,
        available_identities: Vec::new(),
    }
}

fn installer_asset_prefix(target: &str, channel: &str, release_tag: &str) -> String {
    let suffix = if channel == "cef" { "-cef" } else { "" };
    format!("opencode-studio-desktop-{target}{suffix}-{release_tag}.")
}

fn installer_expected_asset_names(target: &str, channel: &str, release_tag: &str) -> Vec<String> {
    let suffix = if channel == "cef" { "-cef" } else { "" };
    let stem = format!("opencode-studio-desktop-{target}{suffix}-{release_tag}");

    if is_windows_target(target) {
        if release_tag.contains('-') {
            return vec![format!("{stem}.exe")];
        }
        return vec![format!("{stem}.msi"), format!("{stem}.exe")];
    }

    if is_macos_target(target) {
        return vec![format!("{stem}.dmg")];
    }

    vec![
        format!("{stem}.AppImage"),
        format!("{stem}.deb"),
        format!("{stem}.rpm"),
    ]
}

fn release_asset_url(repo: &str, release_tag: &str, asset_name: &str) -> String {
    format!("{GITHUB_WEB_BASE}/{repo}/releases/download/{release_tag}/{asset_name}")
}

fn is_windows_target(target: &str) -> bool {
    target.to_ascii_lowercase().contains("windows")
}

fn is_macos_target(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    lower.contains("apple") || lower.contains("darwin")
}

fn classify_asset_identity(asset_name: &str) -> Option<AssetIdentity> {
    let lower = asset_name.to_ascii_lowercase();
    let installer_type = if lower.ends_with(".msi") {
        "msi"
    } else if lower.ends_with(".exe") {
        "exe"
    } else if lower.ends_with(".dmg") {
        "dmg"
    } else if lower.ends_with(".appimage") {
        "appimage"
    } else if lower.ends_with(".deb") {
        "deb"
    } else if lower.ends_with(".rpm") {
        "rpm"
    } else if lower.ends_with(".pkg.tar.zst") {
        "pkg"
    } else {
        return None;
    };

    let manager = parse_manager_from_asset_name(&lower).unwrap_or(match installer_type {
        "deb" => "apt",
        "rpm" => "dnf",
        "pkg" => "pacman",
        _ => "direct",
    });

    Some(AssetIdentity::from_parts(installer_type, manager))
}

fn parse_manager_from_asset_name(lower: &str) -> Option<&'static str> {
    for manager in ["winget", "choco", "scoop", "brew", "apt", "dnf", "pacman"] {
        if lower.contains(&format!("-{manager}-"))
            || lower.contains(&format!(".{manager}."))
            || lower.contains(&format!("_{manager}_"))
            || lower.ends_with(&format!("-{manager}"))
        {
            return Some(manager);
        }
    }
    None
}

struct InstallerSelection {
    primary_asset: Option<ReleaseAssetLink>,
    selection_error: Option<InstallerSelectionError>,
}

fn select_primary_installer_asset(
    runtime: &InstallerRuntime,
    assets: &[ReleaseAssetLink],
) -> InstallerSelection {
    let Some(expected_installer_type) = runtime.installer_type.as_deref() else {
        return InstallerSelection {
            primary_asset: None,
            selection_error: Some(missing_identity_error(runtime, assets)),
        };
    };
    let Some(expected_manager) = runtime.installer_manager.as_deref() else {
        return InstallerSelection {
            primary_asset: None,
            selection_error: Some(missing_identity_error(runtime, assets)),
        };
    };

    let mut exact = assets
        .iter()
        .filter(|asset| {
            asset.installer_type == expected_installer_type && asset.manager == expected_manager
        })
        .cloned()
        .collect::<Vec<_>>();
    exact.sort_by(|a, b| a.name.cmp(&b.name));

    if let Some(primary) = exact.first() {
        return InstallerSelection {
            primary_asset: Some(primary.clone()),
            selection_error: None,
        };
    }

    InstallerSelection {
        primary_asset: None,
        selection_error: Some(mismatch_identity_error(runtime, assets)),
    }
}

fn missing_target_error() -> InstallerSelectionError {
    InstallerSelectionError {
        code: "missingTarget".to_string(),
        message: "installer target is required to resolve a compatible update package".to_string(),
        expected_target: None,
        expected_installer_type: None,
        expected_manager: None,
        available_identities: Vec::new(),
    }
}

fn missing_identity_error(
    runtime: &InstallerRuntime,
    assets: &[ReleaseAssetLink],
) -> InstallerSelectionError {
    InstallerSelectionError {
        code: "missingInstallContext".to_string(),
        message: "installer manager/type is required to avoid cross-manager updates".to_string(),
        expected_target: runtime.target.clone(),
        expected_installer_type: runtime.installer_type.clone(),
        expected_manager: runtime.installer_manager.clone(),
        available_identities: collect_available_identities(assets),
    }
}

fn mismatch_identity_error(
    runtime: &InstallerRuntime,
    assets: &[ReleaseAssetLink],
) -> InstallerSelectionError {
    InstallerSelectionError {
        code: "noCompatibleInstaller".to_string(),
        message:
            "no installer candidate matches current platform/arch/manager/installer-type context"
                .to_string(),
        expected_target: runtime.target.clone(),
        expected_installer_type: runtime.installer_type.clone(),
        expected_manager: runtime.installer_manager.clone(),
        available_identities: collect_available_identities(assets),
    }
}

fn collect_available_identities(assets: &[ReleaseAssetLink]) -> Vec<AssetIdentity> {
    let mut identities = assets
        .iter()
        .map(|asset| AssetIdentity::from_parts(&asset.installer_type, &asset.manager))
        .collect::<Vec<_>>();
    identities.sort();
    identities.dedup();
    identities
}

async fn fetch_latest_release(repo: &str) -> Result<GithubRelease, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|err| format!("build http client: {err}"))?;

    match fetch_latest_release_via_api(&client, repo).await {
        Ok(release) => Ok(release),
        Err(api_err) => fetch_latest_release_via_web(repo)
            .await
            .map_err(|web_err| format!("{api_err}; fallback failed: {web_err}")),
    }
}

async fn fetch_latest_release_via_api(
    client: &reqwest::Client,
    repo: &str,
) -> Result<GithubRelease, String> {
    let url = format!("{GITHUB_API_BASE}/repos/{repo}/releases/latest");
    let mut request = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, "opencode-studio-update-check")
        .header("X-GitHub-Api-Version", "2022-11-28");

    if let Some(token) = github_api_token() {
        request = request.bearer_auth(token);
    }

    let resp = request
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

async fn fetch_latest_release_via_web(repo: &str) -> Result<GithubRelease, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|err| format!("build fallback client: {err}"))?;

    let latest_url = format!("{GITHUB_WEB_BASE}/{repo}/releases/latest");
    let resp = client
        .get(latest_url)
        .header(reqwest::header::USER_AGENT, "opencode-studio-update-check")
        .send()
        .await
        .map_err(|err| format!("request GitHub release page: {err}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "request GitHub release page failed ({})",
            resp.status()
        ));
    }

    let final_url = resp.url().clone();
    let tag_name = release_tag_from_url(&final_url)
        .ok_or_else(|| format!("resolve latest release tag from {}", final_url))?;

    Ok(GithubRelease {
        tag_name,
        html_url: Some(final_url.to_string()),
        body: None,
        published_at: None,
        assets: Vec::new(),
    })
}

fn release_tag_from_url(url: &reqwest::Url) -> Option<String> {
    let parts = url.path_segments()?.collect::<Vec<_>>();
    let idx = parts.iter().position(|segment| *segment == "tag")?;
    nonempty(Some(parts.get(idx + 1)?))
}

fn github_api_token() -> Option<String> {
    let primary = std::env::var("OPENCODE_STUDIO_GITHUB_TOKEN").ok();
    if let Some(token) = nonempty(primary.as_deref()) {
        return Some(token);
    }
    let secondary = std::env::var("GITHUB_TOKEN").ok();
    nonempty(secondary.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime_with(identity_type: &str, manager: &str) -> InstallerRuntime {
        InstallerRuntime {
            current_version: "0.1.0".to_string(),
            target: Some("x86_64-pc-windows-msvc".to_string()),
            channel: "main".to_string(),
            installer_type: Some(identity_type.to_string()),
            installer_manager: Some(manager.to_string()),
        }
    }

    fn asset(name: &str, installer_type: &str, manager: &str) -> ReleaseAssetLink {
        ReleaseAssetLink {
            name: name.to_string(),
            url: format!("https://example.invalid/{name}"),
            installer_type: installer_type.to_string(),
            manager: manager.to_string(),
        }
    }

    #[test]
    fn select_primary_installer_prefers_exact_exe_match() {
        let runtime = runtime_with("exe", "direct");
        let assets = vec![
            asset(
                "opencode-studio-desktop-x86_64-pc-windows-msvc-v1.2.0.msi",
                "msi",
                "direct",
            ),
            asset(
                "opencode-studio-desktop-x86_64-pc-windows-msvc-v1.2.0.exe",
                "exe",
                "direct",
            ),
        ];

        let selected = select_primary_installer_asset(&runtime, assets.as_slice());
        assert_eq!(
            selected
                .primary_asset
                .as_ref()
                .map(|item| item.name.as_str()),
            Some("opencode-studio-desktop-x86_64-pc-windows-msvc-v1.2.0.exe")
        );
        assert!(selected.selection_error.is_none());
    }

    #[test]
    fn select_primary_installer_rejects_cross_manager_match() {
        let runtime = runtime_with("exe", "winget");
        let assets = vec![asset(
            "opencode-studio-desktop-x86_64-pc-windows-msvc-v1.2.0.exe",
            "exe",
            "direct",
        )];

        let selected = select_primary_installer_asset(&runtime, assets.as_slice());
        assert!(selected.primary_asset.is_none());
        let error = selected
            .selection_error
            .expect("selection error should be present");
        assert_eq!(error.code, "noCompatibleInstaller");
        assert_eq!(error.expected_manager.as_deref(), Some("winget"));
        assert_eq!(error.expected_installer_type.as_deref(), Some("exe"));
    }

    #[test]
    fn select_primary_installer_requires_identity_context() {
        let runtime = InstallerRuntime {
            current_version: "0.1.0".to_string(),
            target: Some("x86_64-pc-windows-msvc".to_string()),
            channel: "main".to_string(),
            installer_type: None,
            installer_manager: Some("direct".to_string()),
        };
        let assets = vec![asset(
            "opencode-studio-desktop-x86_64-pc-windows-msvc-v1.2.0.exe",
            "exe",
            "direct",
        )];

        let selected = select_primary_installer_asset(&runtime, assets.as_slice());
        assert!(selected.primary_asset.is_none());
        let error = selected
            .selection_error
            .expect("selection error should be present");
        assert_eq!(error.code, "missingInstallContext");
    }

    #[test]
    fn classify_asset_identity_infers_extension_defaults() {
        let deb =
            classify_asset_identity("opencode-studio-desktop-x86_64-unknown-linux-gnu-v1.2.0.deb")
                .expect("deb identity");
        assert_eq!(deb.installer_type, "deb");
        assert_eq!(deb.manager, "apt");

        let rpm =
            classify_asset_identity("opencode-studio-desktop-x86_64-unknown-linux-gnu-v1.2.0.rpm")
                .expect("rpm identity");
        assert_eq!(rpm.installer_type, "rpm");
        assert_eq!(rpm.manager, "dnf");
    }

    #[test]
    fn runtime_target_triple_for_maps_linux_and_macos_variants() {
        assert_eq!(
            runtime_target_triple_for("linux", "x86_64", false),
            Some("x86_64-unknown-linux-gnu")
        );
        assert_eq!(
            runtime_target_triple_for("linux", "aarch64", false),
            Some("aarch64-unknown-linux-gnu")
        );
        assert_eq!(
            runtime_target_triple_for("macos", "x86_64", false),
            Some("x86_64-apple-darwin")
        );
        assert_eq!(
            runtime_target_triple_for("macos", "aarch64", false),
            Some("aarch64-apple-darwin")
        );
    }

    #[test]
    fn preferred_service_target_triple_for_prefers_linux_musl_defaults() {
        assert_eq!(
            preferred_service_target_triple_for("linux", "x86_64"),
            Some("x86_64-unknown-linux-musl")
        );
        assert_eq!(
            preferred_service_target_triple_for("linux", "aarch64"),
            Some("aarch64-unknown-linux-musl")
        );
        assert_eq!(
            preferred_service_target_triple_for("linux", "arm"),
            Some("armv7-unknown-linux-musleabihf")
        );
        assert_eq!(
            preferred_service_target_triple_for("darwin", "arm64"),
            Some("aarch64-apple-darwin")
        );
    }

    #[test]
    fn runtime_target_triple_for_maps_linux_musl_variants() {
        assert_eq!(
            runtime_target_triple_for("linux", "x86_64", true),
            Some("x86_64-unknown-linux-musl")
        );
        assert_eq!(
            runtime_target_triple_for("linux", "aarch64", true),
            Some("aarch64-unknown-linux-musl")
        );
        assert_eq!(
            runtime_target_triple_for("linux", "x86", true),
            Some("i686-unknown-linux-musl")
        );
        assert_eq!(
            runtime_target_triple_for("linux", "arm", true),
            Some("armv7-unknown-linux-musleabihf")
        );
    }

    #[test]
    fn installer_expected_asset_names_match_macos_and_linux_formats() {
        let mac_assets = installer_expected_asset_names("aarch64-apple-darwin", "main", "v1.2.0");
        assert_eq!(
            mac_assets,
            vec!["opencode-studio-desktop-aarch64-apple-darwin-v1.2.0.dmg".to_string()]
        );

        let linux_assets =
            installer_expected_asset_names("aarch64-unknown-linux-gnu", "main", "v1.2.0");
        assert_eq!(
            linux_assets,
            vec![
                "opencode-studio-desktop-aarch64-unknown-linux-gnu-v1.2.0.AppImage".to_string(),
                "opencode-studio-desktop-aarch64-unknown-linux-gnu-v1.2.0.deb".to_string(),
                "opencode-studio-desktop-aarch64-unknown-linux-gnu-v1.2.0.rpm".to_string(),
            ]
        );
    }

    #[test]
    fn runtime_target_triple_for_maps_windows_and_unknown() {
        assert_eq!(
            runtime_target_triple_for("windows", "x86_64", false),
            Some("x86_64-pc-windows-msvc")
        );
        assert_eq!(
            runtime_target_triple_for("windows", "aarch64", false),
            Some("aarch64-pc-windows-msvc")
        );
        assert_eq!(runtime_target_triple_for("freebsd", "x86_64", false), None);
    }

    #[test]
    fn service_asset_candidates_prefer_backend_names_and_platform_extensions() {
        assert_eq!(
            service_asset_candidates("x86_64-pc-Windows-msvc", "v1.2.0")[0],
            "opencode-studio-backend-x86_64-pc-Windows-msvc-v1.2.0.zip"
        );
        assert_eq!(
            service_asset_candidates("x86_64-unknown-linux-gnu", "v1.2.0")[0],
            "opencode-studio-backend-x86_64-unknown-linux-musl-v1.2.0.tar.gz"
        );
        assert_eq!(
            service_asset_candidates("x86_64-unknown-linux-gnu", "v1.2.0")[8],
            "opencode-studio-backend-x86_64-unknown-linux-gnu-v1.2.0.tar.gz"
        );
    }

    #[test]
    fn service_asset_target_from_name_extracts_selected_target() {
        assert_eq!(
            service_asset_target_from_name(
                "opencode-studio-backend-aarch64-unknown-linux-gnu-v1.2.0.tar.gz",
                "v1.2.0"
            ),
            Some("aarch64-unknown-linux-gnu".to_string())
        );
        assert_eq!(
            service_asset_target_from_name(
                "opencode-studio-x86_64-unknown-linux-musl.zip",
                "v1.2.0"
            ),
            Some("x86_64-unknown-linux-musl".to_string())
        );
    }

    #[test]
    fn runtime_target_triple_for_normalizes_common_aliases() {
        assert_eq!(
            runtime_target_triple_for("linux", "amd64", false),
            Some("x86_64-unknown-linux-gnu")
        );
        assert_eq!(
            runtime_target_triple_for("darwin", "arm64", false),
            Some("aarch64-apple-darwin")
        );
        assert_eq!(
            runtime_target_triple_for("win32", "arm64", false),
            Some("aarch64-pc-windows-msvc")
        );
    }

    #[test]
    fn normalize_installer_target_accepts_supported_targets_case_insensitive() {
        assert_eq!(
            normalize_installer_target("X86_64-pc-Windows-msvc"),
            Some("x86_64-pc-windows-msvc")
        );
        assert_eq!(
            normalize_installer_target("aarch64-apple-darwin"),
            Some("aarch64-apple-darwin")
        );
        assert_eq!(normalize_installer_target(""), None);
        assert_eq!(
            normalize_installer_target("x86_64-unknown-linux-musl"),
            None
        );
    }

    #[test]
    fn installer_expected_asset_names_use_case_insensitive_target_detection() {
        let windows = installer_expected_asset_names("x86_64-pc-Windows-msvc", "main", "v1.2.0");
        assert_eq!(
            windows,
            vec![
                "opencode-studio-desktop-x86_64-pc-Windows-msvc-v1.2.0.msi".to_string(),
                "opencode-studio-desktop-x86_64-pc-Windows-msvc-v1.2.0.exe".to_string(),
            ]
        );

        let mac = installer_expected_asset_names("AARCH64-APPLE-DARWIN", "main", "v1.2.0");
        assert_eq!(
            mac,
            vec!["opencode-studio-desktop-AARCH64-APPLE-DARWIN-v1.2.0.dmg".to_string()]
        );
    }

    #[test]
    fn installer_expected_asset_names_prerelease_windows_prefers_exe_only() {
        let assets =
            installer_expected_asset_names("x86_64-pc-windows-msvc", "main", "v1.2.0-rc.1");
        assert_eq!(
            assets,
            vec!["opencode-studio-desktop-x86_64-pc-windows-msvc-v1.2.0-rc.1.exe".to_string()]
        );
    }

    #[test]
    fn parse_manager_from_asset_name_supports_multiple_patterns() {
        assert_eq!(
            parse_manager_from_asset_name(
                "opencode-studio-desktop-x86_64-pc-windows-msvc-v1.2.0-winget-.exe"
            ),
            Some("winget")
        );
        assert_eq!(
            parse_manager_from_asset_name("opencode-studio.desktop.scoop.installer.exe"),
            Some("scoop")
        );
        assert_eq!(
            parse_manager_from_asset_name("opencode_studio_brew_pkg.dmg"),
            Some("brew")
        );
    }

    #[test]
    fn build_service_update_command_for_varies_by_os() {
        assert_eq!(
            build_service_update_command_for("windows", None, "https://example.invalid/a.zip"),
            "curl -fL \"https://example.invalid/a.zip\" -o opencode-studio.zip"
        );
        assert_eq!(
            build_service_update_command_for("linux", None, "https://example.invalid/a.tar.gz"),
            "curl -fL \"https://example.invalid/a.tar.gz\" -o opencode-studio.tar.gz"
        );
    }

    #[test]
    fn installer_assets_for_target_falls_back_to_expected_urls() {
        let assets = installer_assets_for_target(
            &[],
            "canxin121/opencode-studio",
            "x86_64-pc-windows-msvc",
            "main",
            "v1.2.0",
        );

        assert_eq!(assets.len(), 2);
        assert_eq!(assets[0].installer_type, "msi");
        assert_eq!(assets[0].manager, "direct");
        assert_eq!(
            assets[0].url,
            "https://github.com/canxin121/opencode-studio/releases/download/v1.2.0/opencode-studio-desktop-x86_64-pc-windows-msvc-v1.2.0.msi"
        );
        assert_eq!(assets[1].installer_type, "exe");
    }
}
