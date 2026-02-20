use std::collections::VecDeque;
use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Response,
};
use bytes::{BufMut as _, Bytes, BytesMut};
use futures_util::StreamExt;
use tokio::sync::broadcast;

use crate::ApiResult;

// Bound memory used for Last-Event-ID replay.
// Keep this reasonably small because payloads can be large (streaming deltas, tool output, etc).
const HUB_REPLAY_MAX_BYTES: usize = 8 * 1024 * 1024;
const HUB_CHANNEL_CAPACITY: usize = 4096;

const DOWNSTREAM_RECV_TIMEOUT: Duration = Duration::from_secs(25);
const DOWNSTREAM_HEARTBEAT_FRAME: &[u8] = b"event: heartbeat\ndata: {}\n\n";

const UPSTREAM_RETRY_BASE_DELAY: Duration = Duration::from_millis(900);
const UPSTREAM_RETRY_MAX_DELAY: Duration = Duration::from_secs(30);
const UPSTREAM_SETTINGS_REFRESH: Duration = Duration::from_millis(900);

#[derive(Clone, Debug)]
struct HubFrame {
    seq: u64,
    bytes: Bytes,
    /// When true, downstream SSE handlers should close the connection after yielding.
    close_after: bool,
}

#[derive(Debug)]
struct HubBuffer {
    items: VecDeque<HubFrame>,
    bytes: usize,
}

struct GlobalSseHub {
    tx: broadcast::Sender<HubFrame>,
    buffer: Mutex<HubBuffer>,
    next_seq: AtomicU64,
    latest_unbuffered_seq: AtomicU64,
    next_client_id: AtomicU64,
    started: AtomicBool,
    upstream_connected: AtomicBool,
}

impl GlobalSseHub {
    fn new() -> Self {
        let (tx, _) = broadcast::channel(HUB_CHANNEL_CAPACITY);
        Self {
            tx,
            buffer: Mutex::new(HubBuffer {
                items: VecDeque::new(),
                bytes: 0,
            }),
            next_seq: AtomicU64::new(1),
            latest_unbuffered_seq: AtomicU64::new(0),
            next_client_id: AtomicU64::new(1),
            started: AtomicBool::new(false),
            upstream_connected: AtomicBool::new(false),
        }
    }

    fn allocate_client_id(&self) -> u64 {
        self.next_client_id.fetch_add(1, Ordering::Relaxed)
    }

    fn mark_started(&self) -> bool {
        !self.started.swap(true, Ordering::SeqCst)
    }

    fn set_upstream_connected(&self, connected: bool) {
        self.upstream_connected.store(connected, Ordering::SeqCst);
    }

    fn is_upstream_connected(&self) -> bool {
        self.upstream_connected.load(Ordering::SeqCst)
    }

    fn latest_seq(&self) -> u64 {
        self.next_seq.load(Ordering::Relaxed).saturating_sub(1)
    }

    fn oldest_seq(&self) -> Option<u64> {
        let buf = self.buffer.lock().unwrap();
        buf.items.front().map(|evt| evt.seq)
    }

    fn latest_unbuffered_seq(&self) -> u64 {
        self.latest_unbuffered_seq.load(Ordering::Relaxed)
    }

    fn mark_unbuffered_seq(&self, seq: u64) {
        let _ = self.latest_unbuffered_seq.fetch_max(seq, Ordering::SeqCst);
    }

    fn downstream_client_count(&self) -> usize {
        self.tx.receiver_count()
    }

    fn publish_json(&self, payload_json: &str) {
        self.publish_json_inner(payload_json, false, true);
    }

    fn publish_disconnect_and_close(&self, reason: &str) {
        let payload = serde_json::json!({
            "type": "opencode-studio:upstream-disconnected",
            "timestamp": time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000,
            "properties": {
                "reason": reason,
            }
        });
        let encoded = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
        // Keep the downstream connection open (avoid reconnect storms). Clients can
        // still perform best-effort REST reconciliation on their own error handlers.
        self.publish_json_inner(&encoded, false, false);
    }

    fn publish_json_inner(&self, payload_json: &str, close_after: bool, store: bool) {
        if payload_json.trim().is_empty() {
            return;
        }

        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let bytes = sse_frame(seq, payload_json);
        let frame = HubFrame {
            seq,
            bytes,
            close_after,
        };
        let frame_len = frame.bytes.len();

        if store {
            if frame_len <= HUB_REPLAY_MAX_BYTES {
                let mut buf = self.buffer.lock().unwrap();
                buf.bytes = buf.bytes.saturating_add(frame_len);
                buf.items.push_back(frame.clone());

                // Evict from the front to stay within the byte budget.
                while buf.bytes > HUB_REPLAY_MAX_BYTES && !buf.items.is_empty() {
                    if let Some(front) = buf.items.pop_front() {
                        buf.bytes = buf.bytes.saturating_sub(front.bytes.len());
                    }
                }
            } else {
                self.mark_unbuffered_seq(seq);
                tracing::warn!(
                    target: "opencode_studio.global_sse_hub.downstream",
                    seq,
                    frame_bytes = frame_len,
                    replay_max_bytes = HUB_REPLAY_MAX_BYTES,
                    "Global SSE frame too large for replay buffer; sending live only"
                );
            }
        }

        let _ = self.tx.send(frame);
    }

    fn replay_since_until(&self, last_seq: u64, max_seq_inclusive: u64) -> Vec<HubFrame> {
        let buf = self.buffer.lock().unwrap();
        buf.items
            .iter()
            .filter(|evt| evt.seq > last_seq && evt.seq <= max_seq_inclusive)
            .cloned()
            .collect()
    }

    fn replay_gap_seq(&self, last_seq: u64, max_seq_inclusive: u64) -> Option<u64> {
        if max_seq_inclusive == 0 || last_seq >= max_seq_inclusive {
            return None;
        }

        let latest_unbuffered_seq = self.latest_unbuffered_seq().min(max_seq_inclusive);
        if latest_unbuffered_seq > 0 && last_seq < latest_unbuffered_seq {
            return Some(latest_unbuffered_seq);
        }

        let oldest_seq = self.oldest_seq()?;
        if last_seq.saturating_add(1) < oldest_seq {
            return Some(oldest_seq);
        }

        None
    }
}

static GLOBAL_HUB: LazyLock<GlobalSseHub> = LazyLock::new(GlobalSseHub::new);

// Internal publish helpers used by other server modules.
pub(crate) fn publish_downstream_json(payload_json: &str) {
    GLOBAL_HUB.publish_json(payload_json);
}

pub(crate) fn downstream_client_count() -> usize {
    GLOBAL_HUB.downstream_client_count()
}

fn sse_frame(seq: u64, payload_json: &str) -> Bytes {
    let id = seq.to_string();
    let mut out = BytesMut::with_capacity(4 + id.len() + 7 + payload_json.len() + 2);
    out.put_slice(b"id: ");
    out.put_slice(id.as_bytes());
    out.put_slice(b"\n");
    out.put_slice(b"data: ");
    out.put_slice(payload_json.as_bytes());
    out.put_slice(b"\n\n");
    out.freeze()
}

fn heartbeat_frame() -> Bytes {
    Bytes::from_static(DOWNSTREAM_HEARTBEAT_FRAME)
}

fn replay_gap_frame(seq: u64, requested_last_event_id: u64, seq_at_subscribe: u64) -> Bytes {
    let payload = serde_json::json!({
        "type": "opencode-studio:replay-gap",
        "timestamp": time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000,
        "properties": {
            "scope": "global",
            "requestedLastEventId": requested_last_event_id,
            "seqAtSubscribe": seq_at_subscribe,
            "gapSeq": seq,
        }
    });
    let encoded = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
    // Intentionally emit replay-gap without an SSE id.
    // If we reused an old/new id here, the client-side cursor dedupe path might
    // drop this control frame before app-level reconciliation handlers run.
    let mut out = BytesMut::with_capacity(7 + 11 + encoded.len() + 2);
    out.put_slice(b"event: replay-gap\n");
    out.put_slice(b"data: ");
    out.put_slice(encoded.as_bytes());
    out.put_slice(b"\n\n");
    out.freeze()
}

fn parse_last_event_id(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
}

fn replay_gap_seq_for_subscriber(
    hub: &GlobalSseHub,
    requested_last_event_id: u64,
    last_event_id: u64,
    seq_at_subscribe: u64,
) -> Option<u64> {
    if requested_last_event_id > seq_at_subscribe {
        // Cursor from a previous process/version; force downstream reconciliation.
        return Some(seq_at_subscribe);
    }
    hub.replay_gap_seq(last_event_id, seq_at_subscribe)
}

fn sse_data_json_from_block(block: &str) -> (Option<String>, Option<serde_json::Value>) {
    let mut id: Option<String> = None;
    let mut data_lines: Vec<&str> = Vec::new();

    for line in block.lines() {
        let line = line.trim_end();
        if let Some(rest) = line.strip_prefix("id:") {
            let v = rest.trim();
            if !v.is_empty() {
                id = Some(v.to_string());
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start());
            continue;
        }
    }

    if data_lines.is_empty() {
        return (id, None);
    }
    let text = data_lines.join("\n");
    let parsed = serde_json::from_str::<serde_json::Value>(text.trim()).ok();
    (id, parsed)
}

fn sse_event_payload(raw: &serde_json::Value) -> Option<&serde_json::Value> {
    if raw
        .as_object()
        .and_then(|obj| obj.get("type"))
        .and_then(|v| v.as_str())
        .is_some()
    {
        return Some(raw);
    }
    let payload = raw.get("payload")?;
    if payload
        .as_object()
        .and_then(|obj| obj.get("type"))
        .and_then(|v| v.as_str())
        .is_some()
    {
        return Some(payload);
    }
    None
}

async fn read_activity_policy(
    state: &Arc<crate::AppState>,
) -> (
    crate::opencode_proxy::ActivityFilter,
    crate::opencode_proxy::ActivityDetailPolicy,
) {
    let settings = state.settings.read().await;
    (
        crate::opencode_proxy::activity_filter_from_settings(&settings),
        crate::opencode_proxy::activity_detail_policy_from_settings(&settings),
    )
}

pub(crate) fn start_global_sse_hub_if_needed(state: Arc<crate::AppState>) {
    if !GLOBAL_HUB.mark_started() {
        return;
    }

    tokio::spawn(async move {
        let mut last_upstream_event_id: Option<String> = None;
        let mut attempt: u64 = 0;
        let mut last_disconnect_reason: Option<String> = None;

        // Settings-derived activity policies.
        let (mut filter, mut detail) = read_activity_policy(&state).await;

        loop {
            if state.opencode.is_restarting().await {
                GLOBAL_HUB.set_upstream_connected(false);
                publish_disconnect_once("opencode restarting", &mut last_disconnect_reason);
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }

            let Some(bridge) = state.opencode.bridge().await else {
                GLOBAL_HUB.set_upstream_connected(false);
                publish_disconnect_once("opencode bridge unavailable", &mut last_disconnect_reason);
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            };

            let target = match bridge.build_url("/global/event", None) {
                Ok(url) => url,
                Err(_) => {
                    GLOBAL_HUB.set_upstream_connected(false);
                    publish_disconnect_once("invalid upstream url", &mut last_disconnect_reason);
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };

            let mut req =
                reqwest::Request::new(reqwest::Method::GET, target.parse().expect("valid url"));
            {
                let headers = req.headers_mut();
                headers.insert(
                    reqwest::header::ACCEPT,
                    "text/event-stream".parse().unwrap(),
                );
                headers.insert(reqwest::header::CACHE_CONTROL, "no-cache".parse().unwrap());
                headers.insert(reqwest::header::CONNECTION, "keep-alive".parse().unwrap());
                if let Some(last_id) = last_upstream_event_id.as_deref()
                    && !last_id.trim().is_empty()
                {
                    headers.insert(
                        reqwest::header::HeaderName::from_static("last-event-id"),
                        last_id.parse().unwrap(),
                    );
                }
            }

            let resp = match bridge.sse_client.execute(req).await {
                Ok(resp) => resp,
                Err(_) => {
                    GLOBAL_HUB.set_upstream_connected(false);
                    publish_disconnect_once(
                        "failed to connect to upstream SSE",
                        &mut last_disconnect_reason,
                    );
                    attempt = attempt.saturating_add(1);
                    let delay = backoff_delay(attempt);
                    tokio::time::sleep(delay).await;
                    continue;
                }
            };

            if !resp.status().is_success() {
                GLOBAL_HUB.set_upstream_connected(false);
                publish_disconnect_once(
                    "upstream SSE returned non-2xx",
                    &mut last_disconnect_reason,
                );
                attempt = attempt.saturating_add(1);
                let delay = backoff_delay(attempt);
                tokio::time::sleep(delay).await;
                continue;
            }

            GLOBAL_HUB.set_upstream_connected(true);
            attempt = 0;
            last_disconnect_reason = None;

            tracing::info!(
                target: "opencode_studio.global_sse_hub.upstream",
                last_event_id = last_upstream_event_id.as_deref().unwrap_or(""),
                downstream_clients = GLOBAL_HUB.downstream_client_count(),
                "Connected to OpenCode global SSE"
            );

            let mut upstream = resp.bytes_stream();
            let mut buffer = BytesMut::with_capacity(16 * 1024);
            let mut scan_idx: usize = 0;
            let mut prev_cr = false;

            let start = tokio::time::Instant::now() + UPSTREAM_SETTINGS_REFRESH;
            let mut settings_ticker = tokio::time::interval_at(start, UPSTREAM_SETTINGS_REFRESH);

            loop {
                tokio::select! {
                    _ = settings_ticker.tick() => {
                        let (next_filter, next_detail) = read_activity_policy(&state).await;
                        filter = next_filter;
                        detail = next_detail;
                    }
                    item = upstream.next() => {
                        let Some(item) = item else {
                            break;
                        };
                        let Ok(chunk) = item else {
                            break;
                        };

                        // SSE is UTF-8 text; normalize CRLF and accumulate bytes.
                        push_normalized_sse_chunk(&mut buffer, &chunk, &mut prev_cr);

                        while scan_idx + 1 < buffer.len() {
                            if buffer[scan_idx] != b'\n' || buffer[scan_idx + 1] != b'\n' {
                                scan_idx += 1;
                                continue;
                            }

                            let block = buffer.split_to(scan_idx).freeze();
                            // drop delimiter
                            let _ = buffer.split_to(2);
                            scan_idx = 0;

                            let Ok(block_text) = std::str::from_utf8(&block) else {
                                continue;
                            };
                            let block_text = block_text.trim();
                            if block_text.is_empty() {
                                continue;
                            }

                            let (upstream_id, mut json) = sse_data_json_from_block(block_text);
                            if let Some(id) = upstream_id {
                                last_upstream_event_id = Some(id);
                            }
                            let Some(mut raw) = json.take() else {
                                continue;
                            };

                            if !crate::opencode_proxy::sanitize_sse_event_data(&mut raw, &filter, &detail) {
                                continue;
                            }
                            let payload_json = match serde_json::to_string(&raw) {
                                Ok(v) => v,
                                Err(_) => continue,
                            };
                            GLOBAL_HUB.publish_json(&payload_json);

                            if let Some(payload) = sse_event_payload(&raw)
                                && let Some(event_type) = payload.get("type").and_then(|v| v.as_str())
                            {
                                let ty = event_type.trim().to_ascii_lowercase();
                                let props = payload
                                    .get("properties")
                                    .and_then(|v| v.as_object());

                                let read_session_id = |props: Option<&serde_json::Map<String, serde_json::Value>>| {
                                    props
                                        .and_then(|m| {
                                            m.get("sessionID")
                                                .or_else(|| m.get("sessionId"))
                                                .or_else(|| m.get("session_id"))
                                        })
                                        .and_then(|v| v.as_str())
                                        .map(|v| v.trim().to_string())
                                        .filter(|v| !v.is_empty())
                                };

                                match ty.as_str() {
                                    "session.created" | "session.updated" => {
                                        if let Some(props) = props
                                            && let Some(session) = props.get("session") {
                                                state
                                                    .directory_session_index
                                                    .upsert_summary_from_value(session);
                                            }
                                    }
                                    "session.deleted" => {
                                        if let Some(sid) = read_session_id(props) {
                                            state.directory_session_index.remove_summary(&sid);
                                        }
                                    }
                                    "session.status" => {
                                        if let Some(props) = props {
                                            let sid = read_session_id(Some(props));
                                            let status = props
                                                .get("status")
                                                .and_then(|v| v.get("type"))
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("")
                                                .trim();
                                            if let Some(sid) = sid
                                                && (status == "busy" || status == "retry" || status == "idle") {
                                                    state
                                                        .directory_session_index
                                                        .upsert_runtime_status(&sid, status);
                                                }
                                        }
                                    }
                                    "session.idle" => {
                                        if let Some(sid) = read_session_id(props) {
                                            state.directory_session_index.upsert_runtime_status(&sid, "idle");
                                            state.directory_session_index.upsert_runtime_phase(&sid, "idle");
                                            state.directory_session_index.upsert_runtime_attention(&sid, None);
                                        }
                                    }
                                    "session.error" => {
                                        if let Some(sid) = read_session_id(props) {
                                            state.directory_session_index.upsert_runtime_status(&sid, "idle");
                                            state.directory_session_index.upsert_runtime_phase(&sid, "idle");
                                            state.directory_session_index.upsert_runtime_attention(&sid, None);
                                        }
                                    }
                                    "permission.asked" => {
                                        if let Some(sid) = read_session_id(props) {
                                            state
                                                .directory_session_index
                                                .upsert_runtime_attention(&sid, Some("permission"));
                                        }
                                    }
                                    "question.asked" => {
                                        if let Some(sid) = read_session_id(props) {
                                            state
                                                .directory_session_index
                                                .upsert_runtime_attention(&sid, Some("question"));
                                        }
                                    }
                                    "permission.replied" | "question.replied" | "question.rejected" => {
                                        if let Some(sid) = read_session_id(props) {
                                            state.directory_session_index.upsert_runtime_attention(&sid, None);
                                        }
                                    }
                                    _ => {}
                                }
                            }

                            if let Some(payload) = sse_event_payload(&raw)
                                && let Some((session_id, phase)) = crate::session_activity::derive_session_activity(payload)
                            {
                                state.session_activity.set_phase(&session_id, phase);
                                state
                                    .directory_session_index
                                    .upsert_runtime_phase(&session_id, phase.as_str());

                                let injected = serde_json::json!({
                                    "type": "opencode-studio:session-activity",
                                    "properties": {
                                        "sessionID": session_id,
                                        "phase": phase.as_str(),
                                    }
                                });
                                if let Ok(encoded) = serde_json::to_string(&injected) {
                                    GLOBAL_HUB.publish_json(&encoded);
                                }
                            }
                        }
                    }
                }
            }

            GLOBAL_HUB.set_upstream_connected(false);
            publish_disconnect_once("upstream SSE disconnected", &mut last_disconnect_reason);
            attempt = attempt.saturating_add(1);
            let delay = backoff_delay(attempt);
            tokio::time::sleep(delay).await;
        }
    });
}

fn backoff_delay(attempt: u64) -> Duration {
    if attempt == 0 {
        return UPSTREAM_RETRY_BASE_DELAY;
    }
    let exp = 2u64.saturating_pow(attempt.saturating_sub(1).min(10) as u32);
    let ms = UPSTREAM_RETRY_BASE_DELAY.as_millis() as u64;

    Duration::from_millis(
        ms.saturating_mul(exp)
            .min(UPSTREAM_RETRY_MAX_DELAY.as_millis() as u64),
    )
}

fn publish_disconnect_once(reason: &str, last_reason: &mut Option<String>) {
    if last_reason.as_deref() == Some(reason) {
        return;
    }
    *last_reason = Some(reason.to_string());
    tracing::warn!(
        target: "opencode_studio.global_sse_hub.upstream",
        reason,
        "OpenCode upstream SSE disconnected"
    );
    GLOBAL_HUB.publish_disconnect_and_close(reason);
}

fn push_normalized_sse_chunk(buf: &mut BytesMut, chunk: &[u8], prev_cr: &mut bool) {
    for &b in chunk {
        if *prev_cr {
            // We already emitted a '\n' for the previous '\r'.
            if b == b'\n' {
                *prev_cr = false;
                continue;
            }
            *prev_cr = false;
        }

        if b == b'\r' {
            buf.put_u8(b'\n');
            *prev_cr = true;
        } else {
            buf.put_u8(b);
        }
    }
}

pub(crate) async fn global_event_sse(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    // Ensure the hub is running.
    start_global_sse_hub_if_needed(state.clone());

    // Intentionally do NOT fail fast when the upstream is down.
    // Keeping a 200 SSE connection (with heartbeats) avoids reconnect storms in browsers.

    let client_id = GLOBAL_HUB.allocate_client_id();

    let requested_last_event_id = parse_last_event_id(&headers).unwrap_or(0);
    // Subscribe first, then cap replay to the sequence visible at subscribe time.
    // This avoids replay/live overlap that can reorder duplicate seq values on the client.
    let mut rx = GLOBAL_HUB.tx.subscribe();
    let seq_at_subscribe = GLOBAL_HUB.latest_seq();
    let last_event_id = requested_last_event_id.min(seq_at_subscribe);
    let cursor_ahead = requested_last_event_id > seq_at_subscribe;
    let replay_gap_seq = replay_gap_seq_for_subscriber(
        &GLOBAL_HUB,
        requested_last_event_id,
        last_event_id,
        seq_at_subscribe,
    );
    let forced_replay_gap_frame = replay_gap_seq.map(|seq| {
        (
            seq,
            replay_gap_frame(seq, requested_last_event_id, seq_at_subscribe),
        )
    });
    let replay = if forced_replay_gap_frame.is_some() {
        Vec::new()
    } else {
        GLOBAL_HUB.replay_since_until(last_event_id, seq_at_subscribe)
    };
    let replay_len = replay.len();

    tracing::debug!(
        target: "opencode_studio.global_sse_hub.downstream",
        client_id,
        requested_last_event_id,
        last_event_id,
        seq_at_subscribe,
        replay_len,
        replay_gap_forced = forced_replay_gap_frame.is_some(),
        replay_gap_seq = replay_gap_seq.unwrap_or(0),
        cursor_ahead,
        latest_seq = GLOBAL_HUB.latest_seq(),
        upstream_connected = GLOBAL_HUB.is_upstream_connected(),
        downstream_clients = GLOBAL_HUB.downstream_client_count(),
        "Global SSE client connected"
    );

    if let Some(gap_seq) = replay_gap_seq {
        tracing::warn!(
            target: "opencode_studio.global_sse_hub.downstream",
            client_id,
            requested_last_event_id,
            seq_at_subscribe,
            gap_seq,
            "Global SSE replay-gap forced; client must reconcile"
        );
    }

    let sse_stream = async_stream::stream! {
        let mut last_emitted_seq = last_event_id;

        if let Some((gap_seq, frame)) = forced_replay_gap_frame {
            if gap_seq > last_emitted_seq {
                last_emitted_seq = gap_seq;
            }
            yield Ok::<Bytes, Infallible>(frame);
        }

        for evt in replay {
            if evt.seq <= last_emitted_seq {
                continue;
            }
            last_emitted_seq = evt.seq;
            yield Ok::<Bytes, Infallible>(evt.bytes);
        }

        loop {
            match tokio::time::timeout(DOWNSTREAM_RECV_TIMEOUT, rx.recv()).await {
                Ok(Ok(evt)) => {
                    if evt.seq <= last_emitted_seq {
                        continue;
                    }
                    last_emitted_seq = evt.seq;
                    let close_after = evt.close_after;
                    yield Ok::<Bytes, Infallible>(evt.bytes);
                    if close_after {
                        tracing::debug!(
                            target: "opencode_studio.global_sse_hub.downstream",
                            client_id,
                            disconnect_reason = "close_after",
                            last_emitted_seq,
                            "Global SSE client disconnected"
                        );
                        break;
                    }
                }
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => {
                    // If this client can't keep up, close the stream so the browser reconnects
                    // and performs a best-effort REST reconciliation.
                    tracing::warn!(
                        target: "opencode_studio.global_sse_hub.downstream",
                        client_id,
                        last_emitted_seq,
                        "Global SSE client lagged; closing stream"
                    );
                    break;
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => {
                    tracing::debug!(
                        target: "opencode_studio.global_sse_hub.downstream",
                        client_id,
                        last_emitted_seq,
                        disconnect_reason = "closed",
                        "Global SSE client disconnected"
                    );
                    break;
                }
                Err(_) => {
                    yield Ok::<Bytes, Infallible>(heartbeat_frame());
                }
            }
        }
    };

    let mut out = Response::new(axum::body::Body::from_stream(sse_stream));
    *out.status_mut() = StatusCode::OK;
    let out_headers = out.headers_mut();
    out_headers.insert(
        axum::http::header::CONTENT_TYPE,
        "text/event-stream".parse().unwrap(),
    );
    out_headers.insert(
        axum::http::header::CACHE_CONTROL,
        "no-cache".parse().unwrap(),
    );
    out_headers.insert(
        axum::http::header::CONNECTION,
        "keep-alive".parse().unwrap(),
    );
    out_headers.insert("X-Accel-Buffering", "no".parse().unwrap());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_since_until_caps_at_subscribe_seq() {
        let hub = GlobalSseHub::new();
        hub.publish_json("{\"type\":\"event.a\"}");
        let seq_at_subscribe = hub.latest_seq();

        // Simulate events published after downstream subscription.
        hub.publish_json("{\"type\":\"event.b\"}");

        let replay = hub.replay_since_until(0, seq_at_subscribe);
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].seq, 1);
    }

    #[test]
    fn oversized_frame_is_not_buffered_for_replay() {
        let hub = GlobalSseHub::new();
        let oversized = "x".repeat(HUB_REPLAY_MAX_BYTES + 1024);
        hub.publish_json(&format!(
            "{{\"type\":\"event.big\",\"payload\":\"{}\"}}",
            oversized
        ));

        assert!(hub.replay_since_until(0, hub.latest_seq()).is_empty());
    }

    #[test]
    fn replay_gap_seq_marks_unbuffered_oversized_events() {
        let hub = GlobalSseHub::new();
        hub.publish_json("{\"type\":\"event.small\"}");
        let oversized = "x".repeat(HUB_REPLAY_MAX_BYTES + 1024);
        hub.publish_json(&format!(
            "{{\"type\":\"event.big\",\"payload\":\"{}\"}}",
            oversized
        ));

        assert_eq!(hub.replay_gap_seq(1, hub.latest_seq()), Some(2));
        assert_eq!(hub.replay_gap_seq(2, hub.latest_seq()), None);
    }

    #[test]
    fn replay_gap_for_oversized_without_follow_up_event() {
        let hub = GlobalSseHub::new();
        hub.publish_json("{\"type\":\"event.small\"}");
        let oversized = "x".repeat(HUB_REPLAY_MAX_BYTES + 1024);
        hub.publish_json(&format!(
            "{{\"type\":\"event.big\",\"payload\":\"{}\"}}",
            oversized
        ));

        let seq_at_subscribe = hub.latest_seq();
        let last_event_id = 1_u64.min(seq_at_subscribe);

        assert_eq!(hub.replay_gap_seq(last_event_id, seq_at_subscribe), Some(2));
        assert!(
            hub.replay_since_until(last_event_id, seq_at_subscribe)
                .is_empty()
        );
    }

    #[test]
    fn replay_gap_frame_contains_reconnect_metadata() {
        let frame = replay_gap_frame(7, 3, 9);
        let encoded = String::from_utf8(frame.to_vec()).expect("frame must be utf8");

        assert!(!encoded.contains("id: 7"));
        assert!(encoded.contains("event: replay-gap"));
        assert!(encoded.contains("\"type\":\"opencode-studio:replay-gap\""));
        assert!(encoded.contains("\"requestedLastEventId\":3"));
        assert!(encoded.contains("\"seqAtSubscribe\":9"));
        assert!(encoded.contains("\"gapSeq\":7"));
    }

    #[test]
    fn replay_gap_forces_reconcile_when_requested_cursor_is_ahead() {
        let hub = GlobalSseHub::new();
        hub.publish_json("{\"type\":\"event.a\"}");

        let seq_at_subscribe = hub.latest_seq();
        let requested_last_event_id = seq_at_subscribe + 10;
        let last_event_id = requested_last_event_id.min(seq_at_subscribe);

        assert_eq!(
            replay_gap_seq_for_subscriber(
                &hub,
                requested_last_event_id,
                last_event_id,
                seq_at_subscribe,
            ),
            Some(seq_at_subscribe)
        );
    }
}
