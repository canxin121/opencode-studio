use std::time::Duration;

use axum::Json;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, OriginalUri, Path, Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode, Uri, header};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::{
    CloseFrame as TungsteniteCloseFrame, Message as TungsteniteMessage,
};
use url::Url;

use crate::workspace_preview_registry::{
    PreviewSessionsResponse, build_proxy_target_url, preview_target_from_record,
    validate_preview_target_url, websocket_target_url,
};
use crate::{ApiResult, AppError, AppState};

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

#[derive(Debug, Deserialize)]
pub(crate) struct WorkspacePreviewSessionsQuery {
    pub(crate) directory: Option<String>,
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
    let target = validate_preview_target_url(&query.target)?;
    let client = preview_proxy_client()?;

    let upstream = client.get(target.clone()).send().await.map_err(|err| {
        AppError::bad_gateway(format!("failed to fetch preview target {target}: {err}"))
    })?;

    response_from_upstream(upstream).await
}

pub(crate) async fn workspace_preview_sessions_get(
    State(state): State<std::sync::Arc<AppState>>,
    Query(query): Query<WorkspacePreviewSessionsQuery>,
) -> ApiResult<Json<PreviewSessionsResponse>> {
    let sessions = match query.directory.as_deref() {
        Some(directory) => {
            state
                .workspace_preview_registry
                .list_by_directory(directory)
                .await
        }
        None => state.workspace_preview_registry.list_all().await,
    };
    Ok(Json(sessions))
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

    proxy_preview_session_http(parts, body, path, target, original_uri).await
}

async fn proxy_preview_session_http(
    parts: axum::http::request::Parts,
    body: Body,
    path: Option<String>,
    target: Url,
    original_uri: Uri,
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

    response_from_upstream(upstream).await
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
        if should_strip_request_header(name) || is_websocket_handshake_header(name) {
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
        "authorization"
            | "connection"
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
