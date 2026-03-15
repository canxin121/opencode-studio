use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::Json;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, OriginalUri, Path, Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode, Uri, header};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::{
    CloseFrame as TungsteniteCloseFrame, Message as TungsteniteMessage,
};
use url::{Host, Url};

use crate::workspace_preview_registry::{
    PreviewSessionRecord, PreviewSessionsResponse, build_proxy_target_url,
    preview_target_from_record, validate_preview_target_url, websocket_target_url,
};
use crate::{ApiResult, AppError, AppState};

const PREVIEW_DISCOVERY_HOSTS: [&str; 2] = ["127.0.0.1", "localhost"];
const PREVIEW_DISCOVERY_PORTS: [u16; 8] = [5173, 3000, 4173, 8080, 8000, 4200, 4321, 5174];
const PREVIEW_PROXY_BASE_PREFIX: &str = "/api/workspace/preview/s/";

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspacePreviewSessionCreateBody {
    pub(crate) directory: Option<String>,
    pub(crate) opencode_session_id: Option<String>,
    pub(crate) target_url: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspacePreviewSessionDiscoverBody {
    pub(crate) directory: Option<String>,
    pub(crate) opencode_session_id: Option<String>,
}

pub(crate) async fn workspace_preview_get(
    Query(query): Query<WorkspacePreviewQuery>,
) -> ApiResult<Json<WorkspacePreviewResponse>> {
    if let Some(raw_target) = query.target.as_deref() {
        let target = validate_preview_target_url(raw_target)?;
        return Ok(Json(WorkspacePreviewResponse {
            url: target.to_string(),
        }));
    }

    let _ = query.directory;
    if let Some(target) = discover_preview_target().await? {
        return Ok(Json(WorkspacePreviewResponse {
            url: target.to_string(),
        }));
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
    let target = validate_preview_target_url(&query.target)?;
    let client = preview_proxy_client()?;

    let upstream = client.get(target.clone()).send().await.map_err(|err| {
        AppError::bad_gateway(format!("failed to fetch preview target {target}: {err}"))
    })?;

    response_from_upstream(upstream).await
}

pub(crate) async fn workspace_preview_sessions_get(
    State(state): State<std::sync::Arc<AppState>>,
) -> ApiResult<Json<PreviewSessionsResponse>> {
    Ok(Json(state.workspace_preview_registry.list_all().await))
}

pub(crate) async fn workspace_preview_sessions_post(
    State(state): State<Arc<AppState>>,
    Json(body): Json<WorkspacePreviewSessionCreateBody>,
) -> ApiResult<Json<PreviewSessionRecord>> {
    let session = create_studio_preview_session(
        &state,
        body.directory,
        body.opencode_session_id,
        &body.target_url,
    )
    .await?;
    Ok(Json(session))
}

pub(crate) async fn workspace_preview_sessions_discover_post(
    State(state): State<Arc<AppState>>,
    Json(body): Json<WorkspacePreviewSessionDiscoverBody>,
) -> ApiResult<Json<PreviewSessionRecord>> {
    let Some(target) = discover_preview_target().await? else {
        return Err(AppError::not_found(
            "No reachable local preview target found",
        ));
    };
    let session = state
        .workspace_preview_registry
        .create_studio_session(body.directory, body.opencode_session_id, target)
        .await?;
    Ok(Json(session))
}

pub(crate) async fn workspace_preview_session_proxy_root(
    state: State<std::sync::Arc<AppState>>,
    Path(id): Path<String>,
    request: Request<Body>,
) -> ApiResult<Response> {
    proxy_preview_session(state, id, None, request).await
}

pub(crate) async fn workspace_preview_session_proxy_path(
    state: State<std::sync::Arc<AppState>>,
    Path((id, path)): Path<(String, String)>,
    request: Request<Body>,
) -> ApiResult<Response> {
    proxy_preview_session(state, id, Some(path), request).await
}

async fn proxy_preview_session(
    State(state): State<std::sync::Arc<AppState>>,
    id: String,
    path: Option<String>,
    request: Request<Body>,
) -> ApiResult<Response> {
    let record = state
        .workspace_preview_registry
        .get_by_id(&id)
        .await
        .ok_or_else(|| AppError::not_found(format!("preview session not found: {id}")))?;
    let proxy_base_path = record.proxy_base_path.clone();
    let target = preview_target_from_record(&record)?;

    let (parts, body) = request.into_parts();
    let original_uri = parts
        .extensions
        .get::<OriginalUri>()
        .map(|uri| uri.0.clone())
        .unwrap_or_else(|| parts.uri.clone());

    if is_websocket_upgrade_request(&parts.headers, &parts.method) {
        return proxy_preview_session_websocket(state, parts, path, target, original_uri).await;
    }

    proxy_preview_session_http(parts, body, path, target, original_uri, &proxy_base_path).await
}

async fn proxy_preview_session_http(
    parts: axum::http::request::Parts,
    body: Body,
    path: Option<String>,
    target: Url,
    original_uri: Uri,
    proxy_base_path: &str,
) -> ApiResult<Response> {
    let client = preview_proxy_client()?;
    let upstream_url = build_proxy_target_url(&target, path.as_deref(), original_uri.query());
    let upstream = client
        .request(parts.method, upstream_url.clone())
        .headers(filtered_request_headers(&parts.headers))
        .body(reqwest::Body::wrap_stream(body.into_data_stream()))
        .send()
        .await
        .map_err(|err| {
            AppError::bad_gateway(format!(
                "failed to reach preview target {upstream_url}: {err}"
            ))
        })?;

    response_from_upstream_for_session(upstream, proxy_base_path, &target).await
}

fn normalize_proxy_base_path(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() || !trimmed.starts_with('/') {
        return String::new();
    }
    if trimmed.ends_with('/') {
        trimmed.to_string()
    } else {
        format!("{trimmed}/")
    }
}

fn should_rewrite_root_absolute(value: &str, proxy_base_path: &str) -> bool {
    if value.starts_with(proxy_base_path) {
        return false;
    }
    if value.starts_with(PREVIEW_PROXY_BASE_PREFIX) {
        return false;
    }
    true
}

fn rewrite_root_absolute(value: &str, proxy_base_path: &str) -> String {
    format!("{proxy_base_path}{}", value.trim_start_matches('/'))
}

fn rewrite_html_proxy_root_urls(html: &str, proxy_base_path: &str) -> String {
    let base = normalize_proxy_base_path(proxy_base_path);
    if base.is_empty() {
        return html.to_string();
    }

    static DOUBLE_QUOTED: OnceLock<Regex> = OnceLock::new();
    static SINGLE_QUOTED: OnceLock<Regex> = OnceLock::new();
    let double_quoted = DOUBLE_QUOTED.get_or_init(|| {
        Regex::new(r#"(?i)\b(src|href)\s*=\s*"(/[^/][^"]*|/)""#)
            .expect("preview proxy html rewrite regex (double-quoted)")
    });
    let single_quoted = SINGLE_QUOTED.get_or_init(|| {
        Regex::new(r#"(?i)\b(src|href)\s*=\s*'(/[^/][^']*|/)'"#)
            .expect("preview proxy html rewrite regex (single-quoted)")
    });

    let out = double_quoted
        .replace_all(html, |caps: &regex::Captures<'_>| {
            let attr = caps.get(1).map(|m| m.as_str()).unwrap_or("src");
            let value = caps.get(2).map(|m| m.as_str()).unwrap_or("/");
            if should_rewrite_root_absolute(value, &base) {
                format!("{attr}=\"{}\"", rewrite_root_absolute(value, &base))
            } else {
                caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string()
            }
        })
        .into_owned();

    single_quoted
        .replace_all(&out, |caps: &regex::Captures<'_>| {
            let attr = caps.get(1).map(|m| m.as_str()).unwrap_or("src");
            let value = caps.get(2).map(|m| m.as_str()).unwrap_or("/");
            if should_rewrite_root_absolute(value, &base) {
                format!("{attr}='{}'", rewrite_root_absolute(value, &base))
            } else {
                caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string()
            }
        })
        .into_owned()
}

fn is_html_content_type(value: &HeaderValue) -> bool {
    let Ok(raw) = value.to_str() else {
        return false;
    };
    let lower = raw.trim().to_ascii_lowercase();
    lower.starts_with("text/html") || lower.starts_with("application/xhtml+xml")
}

fn is_css_content_type(value: &HeaderValue) -> bool {
    let Ok(raw) = value.to_str() else {
        return false;
    };
    raw.trim().to_ascii_lowercase().starts_with("text/css")
}

fn rewrite_css_proxy_root_urls(css: &str, proxy_base_path: &str) -> String {
    let base = normalize_proxy_base_path(proxy_base_path);
    if base.is_empty() {
        return css.to_string();
    }

    static URL_DQ: OnceLock<Regex> = OnceLock::new();
    static URL_SQ: OnceLock<Regex> = OnceLock::new();
    static URL_BARE: OnceLock<Regex> = OnceLock::new();

    let url_dq = URL_DQ.get_or_init(|| {
        Regex::new(r#"(?i)url\(\s*\"(/[^/][^\"]*|/)\"\s*\)"#)
            .expect("preview proxy css rewrite regex (double-quoted)")
    });
    let url_sq = URL_SQ.get_or_init(|| {
        Regex::new(r#"(?i)url\(\s*'(/[^/][^']*|/)'\s*\)"#)
            .expect("preview proxy css rewrite regex (single-quoted)")
    });
    let url_bare = URL_BARE.get_or_init(|| {
        Regex::new(r#"(?i)url\(\s*(/[^/\s][^)\s]*|/)\s*\)"#)
            .expect("preview proxy css rewrite regex (bare)")
    });

    let out = url_dq
        .replace_all(css, |caps: &regex::Captures<'_>| {
            let value = caps.get(1).map(|m| m.as_str()).unwrap_or("/");
            if should_rewrite_root_absolute(value, &base) {
                format!("url(\"{}\")", rewrite_root_absolute(value, &base))
            } else {
                caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string()
            }
        })
        .into_owned();

    let out = url_sq
        .replace_all(&out, |caps: &regex::Captures<'_>| {
            let value = caps.get(1).map(|m| m.as_str()).unwrap_or("/");
            if should_rewrite_root_absolute(value, &base) {
                format!("url('{}')", rewrite_root_absolute(value, &base))
            } else {
                caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string()
            }
        })
        .into_owned();

    url_bare
        .replace_all(&out, |caps: &regex::Captures<'_>| {
            let value = caps.get(1).map(|m| m.as_str()).unwrap_or("/");
            if should_rewrite_root_absolute(value, &base) {
                format!("url({})", rewrite_root_absolute(value, &base))
            } else {
                caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string()
            }
        })
        .into_owned()
}

fn is_loopback_host(host: Host<&str>) -> bool {
    match host {
        Host::Domain(domain) => domain.eq_ignore_ascii_case("localhost"),
        Host::Ipv4(ipv4) => ipv4.octets() == [127, 0, 0, 1],
        Host::Ipv6(ipv6) => ipv6.is_loopback(),
    }
}

fn is_same_loopback_origin(left: &Url, right: &Url) -> bool {
    let left_port = left.port_or_known_default();
    let right_port = right.port_or_known_default();
    if left_port.is_none() || right_port.is_none() {
        return false;
    }
    if left_port != right_port {
        return false;
    }
    let Some(left_host) = left.host() else {
        return false;
    };
    let Some(right_host) = right.host() else {
        return false;
    };
    is_loopback_host(left_host) && is_loopback_host(right_host)
}

fn normalize_path_prefix(input: &str) -> String {
    if input.trim().is_empty() {
        return "/".to_string();
    }
    if input.ends_with('/') {
        input.to_string()
    } else {
        format!("{input}/")
    }
}

fn try_rewrite_location_header(raw: &str, proxy_base_path: &str, target: &Url) -> Option<String> {
    let base = normalize_proxy_base_path(proxy_base_path);
    if base.is_empty() {
        return None;
    }

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with(&base) || trimmed.starts_with(PREVIEW_PROXY_BASE_PREFIX) {
        return None;
    }

    if trimmed.starts_with("//") {
        return None;
    }

    if trimmed.starts_with('/') {
        return Some(rewrite_root_absolute(trimmed, &base));
    }

    let Ok(url) = Url::parse(trimmed) else {
        return None;
    };

    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }

    if !is_same_loopback_origin(&url, target) {
        return None;
    }

    let target_prefix = normalize_path_prefix(target.path());
    let location_path = url.path();
    let relative = location_path
        .strip_prefix(&target_prefix)
        .unwrap_or_else(|| location_path.trim_start_matches('/'))
        .trim_start_matches('/');
    let mut rewritten = format!("{base}{relative}");
    if let Some(query) = url.query() {
        rewritten.push('?');
        rewritten.push_str(query);
    }
    if let Some(fragment) = url.fragment() {
        rewritten.push('#');
        rewritten.push_str(fragment);
    }
    Some(rewritten)
}

async fn response_from_upstream_for_session(
    upstream: reqwest::Response,
    proxy_base_path: &str,
    target: &Url,
) -> ApiResult<Response> {
    let status = StatusCode::from_u16(upstream.status().as_u16())
        .map_err(|err| AppError::internal(format!("invalid upstream status code: {err}")))?;

    let upstream_headers = upstream.headers().clone();
    let should_rewrite_html = upstream_headers
        .get(header::CONTENT_TYPE)
        .is_some_and(is_html_content_type);
    let should_rewrite_css = upstream_headers
        .get(header::CONTENT_TYPE)
        .is_some_and(is_css_content_type);

    let mut response_headers = HeaderMap::new();
    copy_safe_response_headers(&upstream_headers, &mut response_headers);

    if let Some(value) = upstream_headers
        .get(header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| try_rewrite_location_header(value, proxy_base_path, target))
        .and_then(|value| HeaderValue::from_str(&value).ok())
    {
        response_headers.insert(header::LOCATION, value);
    }

    if should_rewrite_html || should_rewrite_css {
        let bytes = upstream.bytes().await.map_err(|err| {
            AppError::bad_gateway(format!("failed to read preview upstream response: {err}"))
        })?;
        let text = String::from_utf8_lossy(&bytes);
        let rewritten = if should_rewrite_html {
            rewrite_html_proxy_root_urls(&text, proxy_base_path)
        } else {
            rewrite_css_proxy_root_urls(&text, proxy_base_path)
        };

        response_headers.remove(header::ETAG);
        response_headers.remove(header::LAST_MODIFIED);

        let mut response = Response::new(Body::from(rewritten));
        *response.status_mut() = status;
        *response.headers_mut() = response_headers;
        return Ok(with_preview_frame_headers(response));
    }

    let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
    *response.status_mut() = status;
    *response.headers_mut() = response_headers;
    Ok(with_preview_frame_headers(response))
}

async fn proxy_preview_session_websocket(
    state: std::sync::Arc<AppState>,
    mut parts: axum::http::request::Parts,
    path: Option<String>,
    target: Url,
    original_uri: Uri,
) -> ApiResult<Response> {
    let websocket = WebSocketUpgrade::from_request_parts(&mut parts, &state)
        .await
        .map_err(|err| AppError::bad_request(format!("invalid websocket upgrade: {err}")))?;

    let upstream_url = websocket_target_url(&target, path.as_deref(), original_uri.query());
    let mut upstream_request = upstream_url
        .as_str()
        .into_client_request()
        .map_err(|err| AppError::bad_gateway(format!("invalid upstream websocket URL: {err}")))?;
    apply_filtered_websocket_headers(upstream_request.headers_mut(), &parts.headers)?;

    let (upstream_socket, upstream_response) =
        connect_async(upstream_request).await.map_err(|err| {
            AppError::bad_gateway(format!(
                "failed to connect websocket preview target {upstream_url}: {err}"
            ))
        })?;

    let websocket = if let Some(protocol) = upstream_response
        .headers()
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        websocket.protocols([protocol.to_string()])
    } else {
        websocket
    };

    Ok(with_preview_frame_headers(websocket.on_upgrade(
        move |socket| async move {
            bridge_websocket(socket, upstream_socket).await;
        },
    )))
}

async fn bridge_websocket(
    downstream: WebSocket,
    upstream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) {
    let (mut downstream_sender, mut downstream_receiver) = downstream.split();
    let (mut upstream_sender, mut upstream_receiver) = upstream.split();

    let downstream_to_upstream = async {
        while let Some(message) = downstream_receiver.next().await {
            let Ok(message) = message else {
                break;
            };
            let Ok(message) = downstream_message_to_upstream(message) else {
                break;
            };
            if upstream_sender.send(message).await.is_err() {
                break;
            }
        }
        let _ = upstream_sender.close().await;
    };

    let upstream_to_downstream = async {
        while let Some(message) = upstream_receiver.next().await {
            let Ok(message) = message else {
                break;
            };
            let Some(message) = upstream_message_to_downstream(message) else {
                continue;
            };
            if downstream_sender.send(message).await.is_err() {
                break;
            }
        }
        let _ = downstream_sender.close().await;
    };

    tokio::select! {
        _ = downstream_to_upstream => {}
        _ = upstream_to_downstream => {}
    }
}

fn downstream_message_to_upstream(message: Message) -> Result<TungsteniteMessage, ()> {
    match message {
        Message::Text(text) => Ok(TungsteniteMessage::Text(text.to_string().into())),
        Message::Binary(bytes) => Ok(TungsteniteMessage::Binary(bytes)),
        Message::Ping(bytes) => Ok(TungsteniteMessage::Ping(bytes)),
        Message::Pong(bytes) => Ok(TungsteniteMessage::Pong(bytes)),
        Message::Close(frame) => Ok(TungsteniteMessage::Close(frame.map(|frame| {
            TungsteniteCloseFrame {
                code: frame.code.into(),
                reason: frame.reason.to_string().into(),
            }
        }))),
    }
}

fn upstream_message_to_downstream(message: TungsteniteMessage) -> Option<Message> {
    match message {
        TungsteniteMessage::Text(text) => Some(Message::Text(text.to_string().into())),
        TungsteniteMessage::Binary(bytes) => Some(Message::Binary(bytes)),
        TungsteniteMessage::Ping(bytes) => Some(Message::Ping(bytes)),
        TungsteniteMessage::Pong(bytes) => Some(Message::Pong(bytes)),
        TungsteniteMessage::Close(frame) => Some(Message::Close(frame.map(|frame| {
            axum::extract::ws::CloseFrame {
                code: frame.code.into(),
                reason: frame.reason.to_string().into(),
            }
        }))),
        TungsteniteMessage::Frame(_) => None,
    }
}

fn apply_filtered_websocket_headers(to: &mut HeaderMap, from: &HeaderMap) -> ApiResult<()> {
    for (name, value) in from {
        if should_strip_request_header(name) {
            continue;
        }
        if is_websocket_handshake_header(name) {
            if name == header::SEC_WEBSOCKET_PROTOCOL {
                to.append(name, value.clone());
            }
            continue;
        }
        to.append(name, value.clone());
    }
    Ok(())
}

fn filtered_request_headers(from: &HeaderMap) -> HeaderMap {
    let mut to = HeaderMap::new();
    for (name, value) in from {
        if should_strip_request_header(name) {
            continue;
        }
        to.append(name, value.clone());
    }
    to
}

async fn create_studio_preview_session(
    state: &Arc<AppState>,
    directory: Option<String>,
    opencode_session_id: Option<String>,
    raw_target_url: &str,
) -> ApiResult<PreviewSessionRecord> {
    let target = validate_preview_target_url(raw_target_url)?;
    state
        .workspace_preview_registry
        .create_studio_session(directory, opencode_session_id, target)
        .await
}

async fn discover_preview_target() -> ApiResult<Option<Url>> {
    let client = preview_probe_client()?;
    for candidate in preview_probe_candidates() {
        let Ok(response) = client.get(candidate.clone()).send().await else {
            continue;
        };

        if response.status().is_success() || response.status().is_redirection() {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

fn preview_probe_candidates() -> Vec<Url> {
    PREVIEW_DISCOVERY_PORTS
        .iter()
        .flat_map(|port| {
            PREVIEW_DISCOVERY_HOSTS
                .iter()
                .map(move |host| format!("http://{host}:{port}/"))
        })
        .filter_map(|candidate| Url::parse(&candidate).ok())
        .collect()
}

fn preview_probe_client() -> ApiResult<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(350))
        .timeout(Duration::from_millis(700))
        .build()
        .map_err(|err| AppError::internal(format!("failed to build preview probe client: {err}")))
}

async fn response_from_upstream(upstream: reqwest::Response) -> ApiResult<Response> {
    let status = StatusCode::from_u16(upstream.status().as_u16())
        .map_err(|err| AppError::internal(format!("invalid upstream status code: {err}")))?;

    let mut response_headers = HeaderMap::new();
    copy_safe_response_headers(upstream.headers(), &mut response_headers);
    let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
    *response.status_mut() = status;
    *response.headers_mut() = response_headers;
    Ok(with_preview_frame_headers(response))
}

fn preview_proxy_client() -> ApiResult<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| AppError::internal(format!("failed to build preview proxy client: {err}")))
}

fn with_preview_frame_headers(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::X_FRAME_OPTIONS,
        HeaderValue::from_static("SAMEORIGIN"),
    );
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("frame-ancestors 'self'"),
    );
    response
}

fn copy_safe_response_headers(from: &HeaderMap, to: &mut HeaderMap) {
    for (name, value) in from {
        if should_strip_response_header(name) {
            continue;
        }
        to.append(name, value.clone());
    }
}

fn should_strip_request_header(header_name: &HeaderName) -> bool {
    let key = header_name.as_str().to_ascii_lowercase();
    matches!(
        key.as_str(),
        "accept-encoding"
            | "authorization"
            | "connection"
            | "content-length"
            | "cookie"
            | "host"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn should_strip_response_header(header_name: &HeaderName) -> bool {
    let key = header_name.as_str().to_ascii_lowercase();
    matches!(
        key.as_str(),
        "connection"
            | "content-encoding"
            | "content-length"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "set-cookie"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn is_websocket_handshake_header(header_name: &HeaderName) -> bool {
    let key = header_name.as_str().to_ascii_lowercase();
    key.starts_with("sec-websocket-")
}

fn is_websocket_upgrade_request(headers: &HeaderMap, method: &axum::http::Method) -> bool {
    if method != axum::http::Method::GET {
        return false;
    }

    let has_upgrade = headers
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));
    let has_connection_upgrade = headers
        .get(header::CONNECTION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(',')
                .any(|part| part.trim().eq_ignore_ascii_case("upgrade"))
        });

    has_upgrade && has_connection_upgrade
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_preview_registry::WorkspacePreviewRegistry;

    fn dummy_state() -> Arc<AppState> {
        Arc::new(AppState {
            ui_auth: crate::ui_auth::UiAuth::Disabled,
            ui_cookie_same_site: axum_extra::extract::cookie::SameSite::Strict,
            cors_allowed_origins: Vec::new(),
            cors_allow_all: false,
            opencode: Arc::new(crate::opencode::OpenCodeManager::new(
                "127.0.0.1".to_string(),
                Some(1),
                true,
                None,
            )),
            plugin_runtime: Arc::new(crate::plugin_runtime::PluginRuntime::new()),
            terminal: Arc::new(crate::terminal::TerminalManager::new()),
            attachment_cache: Arc::new(crate::attachment_cache::AttachmentCacheManager::new()),
            session_activity: crate::session_activity::SessionActivityManager::new(),
            directory_session_index:
                crate::directory_session_index::DirectorySessionIndexManager::new(),
            workspace_preview_registry: Arc::new(WorkspacePreviewRegistry::new()),
            settings_path: std::path::PathBuf::from(
                "/tmp/opencode-studio-workspace-preview-test-settings.json",
            ),
            settings: Arc::new(tokio::sync::RwLock::new(
                crate::settings::Settings::default(),
            )),
        })
    }

    #[test]
    fn preview_probe_candidates_include_common_ports_and_hosts() {
        let candidates = preview_probe_candidates();
        let urls = candidates.iter().map(Url::as_str).collect::<Vec<_>>();

        assert!(urls.contains(&"http://127.0.0.1:5173/"));
        assert!(urls.contains(&"http://localhost:3000/"));
        assert!(urls.contains(&"http://127.0.0.1:8080/"));
        assert!(urls.contains(&"http://localhost:4321/"));
    }

    #[tokio::test]
    async fn create_preview_session_endpoint_rejects_non_loopback_target() {
        let err = workspace_preview_sessions_post(
            State(dummy_state()),
            Json(WorkspacePreviewSessionCreateBody {
                directory: Some("/repo".to_string()),
                opencode_session_id: None,
                target_url: "http://example.com:5173".to_string(),
            }),
        )
        .await
        .expect_err("non-loopback target should be rejected");

        assert!(matches!(err, AppError::BadRequest { .. }));
    }

    #[test]
    fn rewrite_html_proxy_root_urls_rewrites_root_absolute_src_and_href() {
        let base = "/api/workspace/preview/s/pv_test/";
        let input = r#"<link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script><img src="/api/workspace/preview/s/pv_test/logo.png"><script src="//cdn.example.com/x.js"></script><a href="https://example.com/">x</a>"#;
        let out = rewrite_html_proxy_root_urls(input, base);

        assert!(out.contains("href=\"/api/workspace/preview/s/pv_test/assets/app.css\""));
        assert!(out.contains("src=\"/api/workspace/preview/s/pv_test/assets/app.js\""));
        assert!(out.contains("src=\"/api/workspace/preview/s/pv_test/logo.png\""));
        assert!(out.contains("src=\"//cdn.example.com/x.js\""));
        assert!(out.contains("href=\"https://example.com/\""));
    }

    #[test]
    fn rewrite_css_proxy_root_urls_rewrites_url_root_paths() {
        let base = "/api/workspace/preview/s/pv_test/";
        let input = r#".a{background:url(/img/a.png)}.b{background:url("/img/b.png")} .c{src:url('/img/c.woff2')} .d{background:url(//cdn.example.com/x.png)} .e{background:url(data:image/png;base64,aaaa)} .f{background:url(/api/workspace/preview/s/pv_test/already.png)}"#;
        let out = rewrite_css_proxy_root_urls(input, base);

        assert!(out.contains("url(/api/workspace/preview/s/pv_test/img/a.png)"));
        assert!(out.contains("url(\"/api/workspace/preview/s/pv_test/img/b.png\")"));
        assert!(out.contains("url('/api/workspace/preview/s/pv_test/img/c.woff2')"));
        assert!(out.contains("url(//cdn.example.com/x.png)"));
        assert!(out.contains("url(data:image/png;base64,aaaa)"));
        assert!(out.contains("url(/api/workspace/preview/s/pv_test/already.png)"));
    }

    #[test]
    fn try_rewrite_location_header_rewrites_root_relative_and_loopback_absolute() {
        let base = "/api/workspace/preview/s/pv_test/";
        let target = Url::parse("http://127.0.0.1:4173/").expect("valid target url");

        assert_eq!(
            try_rewrite_location_header("/assets/app.js", base, &target).as_deref(),
            Some("/api/workspace/preview/s/pv_test/assets/app.js")
        );
        assert_eq!(
            try_rewrite_location_header("http://localhost:4173/assets/app.js?x=1", base, &target)
                .as_deref(),
            Some("/api/workspace/preview/s/pv_test/assets/app.js?x=1")
        );

        assert!(
            try_rewrite_location_header("/api/workspace/preview/s/pv_test/ok", base, &target)
                .is_none()
        );
        assert!(try_rewrite_location_header("https://example.com/", base, &target).is_none());
    }
}
