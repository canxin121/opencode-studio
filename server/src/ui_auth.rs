use std::sync::Arc;
use std::time::Duration;

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, Method, StatusCode, header},
    middleware,
    response::IntoResponse,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

const UI_COOKIE_NAME: &str = "oc_ui_session";
const UI_SESSION_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const UI_SESSION_CLEANUP_INTERVAL: Duration = Duration::from_secs(10 * 60);
const LOGIN_FAILURE_WINDOW: Duration = Duration::from_secs(10 * 60);
const LOGIN_FAILURE_LIMIT: u32 = 8;
const LOGIN_LOCKOUT_DURATION: Duration = Duration::from_secs(15 * 60);

#[derive(Clone)]
pub(crate) enum UiAuth {
    Disabled,
    Enabled(Arc<UiAuthInner>),
}

pub(crate) struct UiAuthInner {
    password_phc: String,
    sessions: DashMap<String, SessionRecord>,
    login_attempts: DashMap<String, LoginAttemptRecord>,
}

#[derive(Clone, Debug)]
struct SessionRecord {
    last_seen: OffsetDateTime,
}

#[derive(Clone, Debug)]
struct LoginAttemptRecord {
    window_started: OffsetDateTime,
    failures: u32,
    locked_until: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize)]
struct AuthStatusOk {
    authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

#[derive(Debug, Serialize)]
struct AuthStatusLocked {
    authenticated: bool,
    locked: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateSessionBody {
    password: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthErrorBody {
    error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    locked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_seconds: Option<i64>,
}

fn normalize_password(candidate: Option<&str>) -> String {
    candidate.unwrap_or("").trim().to_string()
}

fn is_secure_request(headers: &HeaderMap) -> bool {
    // Treat requests as secure behind reverse proxies when X-Forwarded-Proto includes "https".
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim().eq_ignore_ascii_case("https"))
        .unwrap_or(false)
}

fn normalize_client_key_value(raw: &str) -> Option<String> {
    let mut v = raw.trim().trim_matches('"').trim().to_string();
    if v.starts_with('[') && v.ends_with(']') && v.len() > 2 {
        v = v.trim_start_matches('[').trim_end_matches(']').to_string();
    }
    if v.is_empty() {
        return None;
    }
    if v.len() > 128 {
        v.truncate(128);
    }
    Some(v)
}

fn parse_forwarded_for(raw: &str) -> Option<String> {
    for entry in raw.split(',') {
        for kv in entry.split(';') {
            let part = kv.trim();
            let Some(value) = part.strip_prefix("for=") else {
                continue;
            };
            let mut value = value.trim().trim_matches('"');
            if value.starts_with('[')
                && let Some(end) = value.find(']')
            {
                value = &value[1..end];
            }
            if let Some(normalized) = normalize_client_key_value(value) {
                return Some(normalized);
            }
        }
    }
    None
}

fn login_attempt_key(headers: &HeaderMap) -> String {
    if let Some(v) = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .and_then(normalize_client_key_value)
    {
        return format!("xff:{v}");
    }

    if let Some(v) = headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .and_then(normalize_client_key_value)
    {
        return format!("xri:{v}");
    }

    if let Some(v) = headers
        .get("forwarded")
        .and_then(|v| v.to_str().ok())
        .and_then(parse_forwarded_for)
    {
        return format!("fwd:{v}");
    }

    if let Some(v) = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .and_then(normalize_client_key_value)
    {
        return format!("ua:{v}");
    }

    "anonymous".to_string()
}

fn build_session_cookie(token: &str, secure: bool, same_site: SameSite) -> Cookie<'static> {
    let mut cookie = Cookie::new(UI_COOKIE_NAME, token.to_string());
    cookie.set_path("/");
    cookie.set_http_only(true);
    cookie.set_same_site(same_site);
    // SameSite=None requires Secure cookies in modern browsers.
    cookie.set_secure(secure || matches!(same_site, SameSite::None));

    // Cookie uses time::Duration / OffsetDateTime.
    cookie.set_expires(
        OffsetDateTime::now_utc() + time::Duration::seconds(UI_SESSION_TTL.as_secs() as i64),
    );
    cookie.set_max_age(time::Duration::seconds(UI_SESSION_TTL.as_secs() as i64));
    cookie
}

fn build_expired_cookie(secure: bool, same_site: SameSite) -> Cookie<'static> {
    let mut cookie = Cookie::new(UI_COOKIE_NAME, "");
    cookie.set_path("/");
    cookie.set_http_only(true);
    cookie.set_same_site(same_site);
    cookie.set_secure(secure || matches!(same_site, SameSite::None));
    cookie.set_expires(OffsetDateTime::UNIX_EPOCH);
    cookie.set_max_age(time::Duration::seconds(0));
    cookie
}

fn is_safe_method(method: &Method) -> bool {
    matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

fn normalize_origin_header_value(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.eq_ignore_ascii_case("null") {
        return None;
    }
    let Ok(url) = url::Url::parse(trimmed) else {
        return None;
    };
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

fn origin_matches_host(origin: &str, host: &str) -> bool {
    let origin_url = match url::Url::parse(origin) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let origin_host = origin_url
        .host_str()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if origin_host.is_empty() {
        return false;
    }
    let host_trimmed = host.trim().to_ascii_lowercase();
    if host_trimmed.is_empty() {
        return false;
    }

    // Accept Host header with or without default port.
    if host_trimmed == origin_host {
        return true;
    }
    if let Some(port) = origin_url.port_or_known_default() {
        let with_port = format!("{}:{}", origin_host, port);
        if host_trimmed == with_port {
            return true;
        }
    }
    false
}

fn is_allowed_origin(headers: &HeaderMap, allowed: &[String]) -> bool {
    let Some(raw_origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Some(origin) = normalize_origin_header_value(raw_origin) else {
        return false;
    };

    if allowed.iter().any(|o| o == &origin) {
        return true;
    }

    // Always allow same-host origins even when no CORS allowlist is set (same-origin UI).
    if let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) {
        return origin_matches_host(&origin, host);
    }

    false
}

fn verify_password(phc: &str, candidate: &str) -> bool {
    let Ok(hash) = PasswordHash::new(phc) else {
        return false;
    };
    Argon2::default()
        .verify_password(candidate.as_bytes(), &hash)
        .is_ok()
}

fn get_token_from_jar(jar: &CookieJar) -> Option<String> {
    jar.get(UI_COOKIE_NAME).map(|c| c.value().to_string())
}

fn get_token_from_authorization(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let trimmed = raw.trim();
    // Authorization: Bearer <token>
    let mut parts = trimmed.split_whitespace();
    let scheme = parts.next().unwrap_or("");
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let token = parts.next().unwrap_or("").trim();
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

fn is_session_valid(inner: &UiAuthInner, token: &str) -> bool {
    let now = OffsetDateTime::now_utc();
    let Some(mut entry) = inner.sessions.get_mut(token) else {
        return false;
    };

    if now - entry.last_seen > time::Duration::seconds(UI_SESSION_TTL.as_secs() as i64) {
        drop(entry);
        inner.sessions.remove(token);
        return false;
    }

    entry.last_seen = now;
    true
}

fn login_failure_window_duration() -> time::Duration {
    time::Duration::seconds(LOGIN_FAILURE_WINDOW.as_secs() as i64)
}

fn login_lockout_duration() -> time::Duration {
    time::Duration::seconds(LOGIN_LOCKOUT_DURATION.as_secs() as i64)
}

fn login_lockout_remaining_seconds(
    inner: &UiAuthInner,
    attempt_key: &str,
    now: OffsetDateTime,
) -> Option<i64> {
    let mut entry = inner.login_attempts.get_mut(attempt_key)?;

    if let Some(locked_until) = entry.locked_until {
        if locked_until > now {
            return Some((locked_until - now).whole_seconds().max(1));
        }

        // Lockout elapsed; reset counters.
        entry.window_started = now;
        entry.failures = 0;
        entry.locked_until = None;
        return None;
    }

    if now - entry.window_started > login_failure_window_duration() {
        entry.window_started = now;
        entry.failures = 0;
    }

    None
}

fn record_failed_login_attempt(
    inner: &UiAuthInner,
    attempt_key: &str,
    now: OffsetDateTime,
) -> Option<i64> {
    let mut entry = inner
        .login_attempts
        .entry(attempt_key.to_string())
        .or_insert(LoginAttemptRecord {
            window_started: now,
            failures: 0,
            locked_until: None,
        });

    if now - entry.window_started > login_failure_window_duration() {
        entry.window_started = now;
        entry.failures = 0;
        entry.locked_until = None;
    }

    entry.failures = entry.failures.saturating_add(1);
    if entry.failures < LOGIN_FAILURE_LIMIT {
        return None;
    }

    let locked_until = now + login_lockout_duration();
    entry.locked_until = Some(locked_until);
    Some((locked_until - now).whole_seconds().max(1))
}

fn clear_failed_login_attempts(inner: &UiAuthInner, attempt_key: &str) {
    inner.login_attempts.remove(attempt_key);
}

async fn cleanup_sessions_task(inner: Arc<UiAuthInner>) {
    let mut ticker = tokio::time::interval(UI_SESSION_CLEANUP_INTERVAL);
    loop {
        ticker.tick().await;
        let now = OffsetDateTime::now_utc();
        let ttl = time::Duration::seconds(UI_SESSION_TTL.as_secs() as i64);
        let login_window = login_failure_window_duration();
        inner
            .sessions
            .retain(|_, record| now - record.last_seen <= ttl);
        inner.login_attempts.retain(|_, record| {
            if let Some(locked_until) = record.locked_until
                && locked_until > now
            {
                return true;
            }

            record.failures > 0 && now - record.window_started <= login_window
        });
    }
}

pub(crate) fn spawn_cleanup_sessions_task_if_enabled(ui_auth: &UiAuth) -> bool {
    match ui_auth {
        UiAuth::Disabled => false,
        UiAuth::Enabled(inner) => {
            tokio::spawn(cleanup_sessions_task(inner.clone()));
            true
        }
    }
}

pub(crate) fn init_ui_auth(ui_password: Option<String>) -> UiAuth {
    let password = normalize_password(ui_password.as_deref());
    if password.is_empty() {
        return UiAuth::Disabled;
    }

    let mut salt_bytes = [0u8; 16];
    getrandom::fill(&mut salt_bytes).expect("init_ui_auth: getrandom failed");
    let salt = SaltString::encode_b64(&salt_bytes).expect("init_ui_auth: encode salt");
    let password_phc = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("hash password")
        .to_string();

    UiAuth::Enabled(Arc::new(UiAuthInner {
        password_phc,
        sessions: DashMap::new(),
        login_attempts: DashMap::new(),
    }))
}

pub(crate) async fn auth_session_status(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    jar: CookieJar,
) -> impl IntoResponse {
    match &state.ui_auth {
        UiAuth::Disabled => Json(AuthStatusOk {
            authenticated: true,
            disabled: Some(true),
            token: None,
        })
        .into_response(),
        UiAuth::Enabled(inner) => {
            let secure = is_secure_request(&headers);

            if let Some(token) = get_token_from_authorization(&headers)
                && is_session_valid(inner, &token)
            {
                return Json(AuthStatusOk {
                    authenticated: true,
                    disabled: None,
                    token: None,
                })
                .into_response();
            }

            if let Some(token) = get_token_from_jar(&jar)
                && is_session_valid(inner, &token)
            {
                return Json(AuthStatusOk {
                    authenticated: true,
                    disabled: None,
                    token: None,
                })
                .into_response();
            }

            let jar = jar.add(build_expired_cookie(secure, state.ui_cookie_same_site));
            (
                StatusCode::UNAUTHORIZED,
                jar,
                Json(AuthStatusLocked {
                    authenticated: false,
                    locked: true,
                }),
            )
                .into_response()
        }
    }
}

pub(crate) async fn auth_session_create(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(body): Json<CreateSessionBody>,
) -> impl IntoResponse {
    let candidate = normalize_password(body.password.as_deref());

    match &state.ui_auth {
        UiAuth::Disabled => (
            StatusCode::BAD_REQUEST,
            Json(AuthErrorBody {
                error: "UI password not configured".to_string(),
                locked: None,
                code: Some("auth_disabled".to_string()),
                retry_after_seconds: None,
            }),
        )
            .into_response(),
        UiAuth::Enabled(inner) => {
            let secure = is_secure_request(&headers);
            let attempt_key = login_attempt_key(&headers);
            let now = OffsetDateTime::now_utc();

            if let Some(retry_after_seconds) =
                login_lockout_remaining_seconds(inner, &attempt_key, now)
            {
                let jar = jar.add(build_expired_cookie(secure, state.ui_cookie_same_site));
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    jar,
                    Json(AuthErrorBody {
                        error: format!(
                            "Too many failed login attempts. Try again in {} seconds",
                            retry_after_seconds
                        ),
                        locked: Some(true),
                        code: Some("auth_rate_limited".to_string()),
                        retry_after_seconds: Some(retry_after_seconds),
                    }),
                )
                    .into_response();
            }

            if !verify_password(&inner.password_phc, &candidate) {
                let jar = jar.add(build_expired_cookie(secure, state.ui_cookie_same_site));
                if let Some(retry_after_seconds) =
                    record_failed_login_attempt(inner, &attempt_key, now)
                {
                    return (
                        StatusCode::TOO_MANY_REQUESTS,
                        jar,
                        Json(AuthErrorBody {
                            error: format!(
                                "Too many failed login attempts. Try again in {} seconds",
                                retry_after_seconds
                            ),
                            locked: Some(true),
                            code: Some("auth_rate_limited".to_string()),
                            retry_after_seconds: Some(retry_after_seconds),
                        }),
                    )
                        .into_response();
                }

                return (
                    StatusCode::UNAUTHORIZED,
                    jar,
                    Json(AuthErrorBody {
                        error: "Invalid password".to_string(),
                        locked: Some(true),
                        code: Some("auth_invalid_password".to_string()),
                        retry_after_seconds: None,
                    }),
                )
                    .into_response();
            }

            clear_failed_login_attempts(inner, &attempt_key);

            if let Some(previous) = get_token_from_jar(&jar) {
                inner.sessions.remove(&previous);
            }

            let token = crate::issue_token();
            inner
                .sessions
                .insert(token.clone(), SessionRecord { last_seen: now });

            let jar = jar.add(build_session_cookie(
                &token,
                secure,
                state.ui_cookie_same_site,
            ));
            (
                StatusCode::OK,
                jar,
                Json(AuthStatusOk {
                    authenticated: true,
                    disabled: None,
                    token: Some(token),
                }),
            )
                .into_response()
        }
    }
}

pub(crate) async fn require_ui_auth(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    jar: CookieJar,
    req: axum::http::Request<axum::body::Body>,
    next: middleware::Next,
) -> impl IntoResponse {
    match &state.ui_auth {
        UiAuth::Disabled => next.run(req).await,
        UiAuth::Enabled(inner) => {
            // Header token (preferred): avoids third-party cookie issues and doesn't
            // require CSRF origin enforcement because the token isn't sent automatically.
            if let Some(token) = get_token_from_authorization(&headers)
                && is_session_valid(inner, &token)
            {
                return next.run(req).await;
            }

            // Cookie token fallback (legacy / same-origin): enforce Origin allowlist for
            // unsafe methods when cookies may be sent cross-site.
            if let Some(token) = get_token_from_jar(&jar)
                && is_session_valid(inner, &token)
            {
                if !is_safe_method(req.method())
                    && (matches!(state.ui_cookie_same_site, SameSite::None)
                        || !state.cors_allowed_origins.is_empty())
                    && !is_allowed_origin(&headers, &state.cors_allowed_origins)
                {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(AuthErrorBody {
                            error: "Request origin not allowed".to_string(),
                            locked: None,
                            code: Some("csrf_origin_forbidden".to_string()),
                            retry_after_seconds: None,
                        }),
                    )
                        .into_response();
                }
                return next.run(req).await;
            }

            let secure = is_secure_request(&headers);
            let jar = jar.add(build_expired_cookie(secure, state.ui_cookie_same_site));
            (
                StatusCode::UNAUTHORIZED,
                jar,
                Json(AuthErrorBody {
                    error: "UI authentication required".to_string(),
                    locked: Some(true),
                    code: Some("auth_required".to_string()),
                    retry_after_seconds: None,
                }),
            )
                .into_response()
        }
    }
}
