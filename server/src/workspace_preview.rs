use std::time::Duration;

use axum::{
    Json,
    body::Body,
    extract::Query,
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::Response,
};
use serde::{Deserialize, Serialize};
use url::{Host, Url};

use crate::{ApiResult, AppError};

const PREVIEW_PROBE_CANDIDATES: [&str; 6] = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
];

#[derive(Debug, Deserialize)]
pub(crate) struct WorkspacePreviewQuery {
    pub(crate) directory: Option<String>,
    pub(crate) target: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WorkspacePreviewProxyQuery {
    pub(crate) target: String,
    pub(crate) refresh: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct WorkspacePreviewResponse {
    pub(crate) url: String,
}

pub(crate) async fn workspace_preview_get(
    Query(query): Query<WorkspacePreviewQuery>,
) -> ApiResult<Json<WorkspacePreviewResponse>> {
    if let Some(raw_target) = query.target.as_deref() {
        let target = validate_preview_target(raw_target)?;
        return Ok(Json(WorkspacePreviewResponse {
            url: target.to_string(),
        }));
    }

    let _ = query.directory;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(350))
        .timeout(Duration::from_millis(700))
        .build()
        .map_err(|err| {
            AppError::internal(format!("failed to build preview probe client: {err}"))
        })?;

    for candidate in PREVIEW_PROBE_CANDIDATES {
        let Ok(response) = client.get(candidate).send().await else {
            continue;
        };

        if response.status().is_success() || response.status().is_redirection() {
            return Ok(Json(WorkspacePreviewResponse {
                url: candidate.to_string(),
            }));
        }
    }

    Err(AppError::not_found(
        "No reachable local preview target found",
    ))
}

pub(crate) async fn workspace_preview_url_get(
    query: Query<WorkspacePreviewQuery>,
) -> ApiResult<Json<WorkspacePreviewResponse>> {
    workspace_preview_get(query).await
}

pub(crate) async fn workspace_preview_proxy_get(
    Query(query): Query<WorkspacePreviewProxyQuery>,
) -> ApiResult<Response> {
    let _ = query.refresh;
    let target = validate_preview_target(&query.target)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| {
            AppError::internal(format!("failed to build preview proxy client: {err}"))
        })?;

    let upstream = client.get(target.clone()).send().await.map_err(|err| {
        AppError::bad_gateway(format!("failed to fetch preview target {target}: {err}"))
    })?;

    let status = StatusCode::from_u16(upstream.status().as_u16())
        .map_err(|err| AppError::internal(format!("invalid upstream status code: {err}")))?;

    let mut response_headers = HeaderMap::new();
    copy_safe_response_headers(upstream.headers(), &mut response_headers);
    response_headers.insert(
        header::X_FRAME_OPTIONS,
        HeaderValue::from_static("SAMEORIGIN"),
    );
    response_headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("frame-ancestors 'self'"),
    );

    let body = upstream.bytes().await.map_err(|err| {
        AppError::bad_gateway(format!("failed to read preview response body: {err}"))
    })?;

    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    *response.headers_mut() = response_headers;
    Ok(response)
}

fn copy_safe_response_headers(from: &HeaderMap, to: &mut HeaderMap) {
    for (name, value) in from {
        if should_strip_response_header(name) {
            continue;
        }
        to.append(name, value.clone());
    }
}

fn should_strip_response_header(header_name: &HeaderName) -> bool {
    let key = header_name.as_str().to_ascii_lowercase();
    matches!(
        key.as_str(),
        "set-cookie"
            | "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn validate_preview_target(raw: &str) -> ApiResult<Url> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_request("target is required"));
    }

    let url = Url::parse(trimmed)
        .map_err(|err| AppError::bad_request(format!("invalid target URL: {err}")))?;

    match url.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(AppError::bad_request(
                "target URL must use http or https protocol",
            ));
        }
    }

    let host = url
        .host()
        .ok_or_else(|| AppError::bad_request("target URL host is required"))?;
    if !is_allowed_loopback_host(host) {
        return Err(AppError::bad_request(
            "target URL must use localhost, 127.0.0.1, or [::1]",
        ));
    }

    if url.path().is_empty() {
        let mut normalized = url;
        normalized.set_path("/");
        return Ok(normalized);
    }

    Ok(url)
}

fn is_allowed_loopback_host(host: Host<&str>) -> bool {
    match host {
        Host::Domain(domain) => domain.eq_ignore_ascii_case("localhost"),
        Host::Ipv4(ipv4) => ipv4.octets() == [127, 0, 0, 1],
        Host::Ipv6(ipv6) => ipv6.is_loopback(),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_preview_target;

    #[test]
    fn validate_preview_target_accepts_loopback_hosts() {
        assert!(validate_preview_target("http://localhost:5173").is_ok());
        assert!(validate_preview_target("https://127.0.0.1:8080/path").is_ok());
        assert!(validate_preview_target("http://[::1]:3000").is_ok());
    }

    #[test]
    fn validate_preview_target_rejects_non_loopback_hosts() {
        assert!(validate_preview_target("http://example.com:5173").is_err());
        assert!(validate_preview_target("http://127.0.0.2:5173").is_err());
        assert!(validate_preview_target("http://[::2]:5173").is_err());
    }

    #[test]
    fn validate_preview_target_rejects_invalid_urls() {
        assert!(validate_preview_target("").is_err());
        assert!(validate_preview_target("localhost:5173").is_err());
        assert!(validate_preview_target("ftp://localhost:21").is_err());
        assert!(validate_preview_target("http://localhost:99999").is_err());
    }
}
