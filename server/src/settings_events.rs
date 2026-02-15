use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_stream::stream;
use axum::{
    extract::State,
    http::HeaderMap,
    response::{IntoResponse, Response, sse::Event},
};
use serde_json::{Value, json};
use tokio::sync::{Mutex as AsyncMutex, broadcast};

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone)]
struct SequencedSettingsEvent {
    seq: u64,
    payload: String,
}

#[derive(Debug, Default)]
struct SettingsReplayBuffer {
    items: VecDeque<SequencedSettingsEvent>,
    bytes: usize,
}

struct SettingsEventHub {
    tx: broadcast::Sender<SequencedSettingsEvent>,
    buffer: Mutex<SettingsReplayBuffer>,
    next_seq: AtomicU64,
    latest_unbuffered_seq: AtomicU64,
    next_client_id: AtomicU64,
    cached_settings: AsyncMutex<Option<Value>>,
}

const SETTINGS_EVENT_HUB_REPLAY_MAX_EVENTS: usize = 256;
const SETTINGS_EVENT_HUB_REPLAY_MAX_BYTES: usize = 1024 * 1024;

impl SettingsEventHub {
    fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            tx,
            buffer: Mutex::new(SettingsReplayBuffer::default()),
            next_seq: AtomicU64::new(1),
            latest_unbuffered_seq: AtomicU64::new(0),
            next_client_id: AtomicU64::new(1),
            cached_settings: AsyncMutex::new(None),
        }
    }

    fn allocate_client_id(&self) -> u64 {
        self.next_client_id.fetch_add(1, Ordering::Relaxed)
    }

    fn latest_seq(&self) -> u64 {
        self.next_seq.load(Ordering::Relaxed).saturating_sub(1)
    }

    fn latest_unbuffered_seq(&self) -> u64 {
        self.latest_unbuffered_seq.load(Ordering::Relaxed)
    }

    fn oldest_seq(&self) -> Option<u64> {
        let buffer = self.buffer.lock().unwrap();
        buffer.items.front().map(|evt| evt.seq)
    }

    fn mark_unbuffered_seq(&self, seq: u64) {
        let _ = self.latest_unbuffered_seq.fetch_max(seq, Ordering::SeqCst);
    }

    fn push_buffered_event(&self, evt: SequencedSettingsEvent) {
        let bytes = evt.payload.as_bytes().len();

        let mut buffer = self.buffer.lock().unwrap();
        buffer.items.push_back(evt);
        buffer.bytes = buffer.bytes.saturating_add(bytes);

        while buffer.items.len() > SETTINGS_EVENT_HUB_REPLAY_MAX_EVENTS
            || buffer.bytes > SETTINGS_EVENT_HUB_REPLAY_MAX_BYTES
        {
            if let Some(front) = buffer.items.pop_front() {
                buffer.bytes = buffer.bytes.saturating_sub(front.payload.as_bytes().len());
            } else {
                buffer.bytes = 0;
                break;
            }
        }
    }

    fn replay_since_until(&self, since: u64, until: u64) -> Vec<SequencedSettingsEvent> {
        if since >= until {
            return Vec::new();
        }
        let buffer = self.buffer.lock().unwrap();
        buffer
            .items
            .iter()
            .filter(|evt| evt.seq > since && evt.seq <= until)
            .cloned()
            .collect()
    }

    fn should_force_replay(&self, last_event_id: u64, seq_at_subscribe: u64) -> bool {
        // New clients should always receive the latest settings snapshot.
        if last_event_id == 0 {
            return true;
        }

        if last_event_id > seq_at_subscribe {
            return true;
        }

        // If our replay buffer skipped some sequence, force a full snapshot.
        if last_event_id < self.latest_unbuffered_seq() {
            return true;
        }

        // If the client's cursor is older than the earliest replayable event, force a snapshot.
        if let Some(oldest) = self.oldest_seq() {
            if last_event_id.saturating_add(1) < oldest {
                return true;
            }
        }

        false
    }
}

static SETTINGS_EVENT_HUB: LazyLock<SettingsEventHub> = LazyLock::new(SettingsEventHub::new);

fn parse_last_event_id(headers: &HeaderMap) -> Option<u64> {
    let header_value = headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim();
    if header_value.is_empty() {
        return None;
    }
    header_value.parse::<u64>().ok()
}

pub(crate) async fn publish_settings_replace(settings: Value) {
    // Cache the latest snapshot for forced replays.
    {
        let mut guard = SETTINGS_EVENT_HUB.cached_settings.lock().await;
        *guard = Some(settings.clone());
    }

    let seq = SETTINGS_EVENT_HUB.next_seq.fetch_add(1, Ordering::SeqCst);
    let payload = serde_json::to_string(&json!({
        "type": "config.settings.replace",
        "seq": seq,
        "ts": now_millis(),
        "properties": {
            "settings": settings,
        }
    }))
    .unwrap_or_else(|_| "{}".to_string());

    // Also publish into the global SSE hub so frontends can use a single connection.
    if crate::global_sse_hub::downstream_client_count() > 0 {
        crate::global_sse_hub::publish_downstream_json(&payload);
    }

    let evt = SequencedSettingsEvent { seq, payload };
    // Settings are usually small, but can grow (e.g. large bookmark arrays).
    // If a single payload exceeds the replay budget, skip buffering it and force
    // reconnecting clients to take a snapshot.
    if evt.payload.as_bytes().len() > SETTINGS_EVENT_HUB_REPLAY_MAX_BYTES {
        SETTINGS_EVENT_HUB.mark_unbuffered_seq(seq);
    } else {
        SETTINGS_EVENT_HUB.push_buffered_event(evt.clone());
    }
    let _ = SETTINGS_EVENT_HUB.tx.send(evt);
}

pub(crate) async fn config_settings_events(
    State(state): State<std::sync::Arc<crate::AppState>>,
    headers: HeaderMap,
) -> Response {
    let client_id = SETTINGS_EVENT_HUB.allocate_client_id();
    let last_event_id = parse_last_event_id(&headers).unwrap_or(0);

    let mut rx = SETTINGS_EVENT_HUB.tx.subscribe();
    let seq_at_subscribe = SETTINGS_EVENT_HUB.latest_seq();

    let forced_replay = SETTINGS_EVENT_HUB.should_force_replay(last_event_id, seq_at_subscribe);
    let emit_floor_seq = if forced_replay {
        seq_at_subscribe
    } else {
        last_event_id.min(seq_at_subscribe)
    };

    let mut forced_snapshot_event: Option<SequencedSettingsEvent> = None;
    let replay = if forced_replay {
        let cached = { SETTINGS_EVENT_HUB.cached_settings.lock().await.clone() };
        let settings = if let Some(value) = cached {
            value
        } else {
            let current = state.settings.read().await.clone();
            let raw = serde_json::to_value(&current).unwrap_or(serde_json::json!({}));
            crate::config::format_settings_response(&raw)
        };

        let forced_seq = seq_at_subscribe;
        let payload = serde_json::to_string(&json!({
            "type": "config.settings.replace",
            "seq": forced_seq,
            "ts": now_millis(),
            "properties": { "settings": settings }
        }))
        .unwrap_or_else(|_| "{}".to_string());
        forced_snapshot_event = Some(SequencedSettingsEvent {
            seq: forced_seq,
            payload,
        });
        Vec::new()
    } else {
        SETTINGS_EVENT_HUB.replay_since_until(last_event_id, seq_at_subscribe)
    };

    tracing::debug!(
        target: "opencode_studio.settings.sse",
        client_id,
        last_event_id,
        seq_at_subscribe,
        emit_floor_seq,
        replay_len = replay.len(),
        forced_replay,
        latest_seq = SETTINGS_EVENT_HUB.latest_seq(),
        downstream_clients = SETTINGS_EVENT_HUB.tx.receiver_count(),
        "settings SSE client connected"
    );

    let sse_stream = stream! {
        let mut last_emitted_seq = emit_floor_seq;

        if let Some(event) = forced_snapshot_event {
            if event.seq > last_emitted_seq {
                last_emitted_seq = event.seq;
            }
            yield Ok::<Event, std::convert::Infallible>(
                Event::default()
                    .event("patch")
                    .id(event.seq.to_string())
                    .data(event.payload),
            );
        }

        for event in replay {
            if event.seq <= last_emitted_seq {
                continue;
            }
            last_emitted_seq = event.seq;
            yield Ok::<Event, std::convert::Infallible>(
                Event::default()
                    .event("patch")
                    .id(event.seq.to_string())
                    .data(event.payload),
            );
        }

        loop {
            match tokio::time::timeout(Duration::from_secs(25), rx.recv()).await {
                Ok(Ok(event)) => {
                    if event.seq <= last_emitted_seq {
                        continue;
                    }
                    last_emitted_seq = event.seq;
                    yield Ok::<Event, std::convert::Infallible>(
                        Event::default()
                            .event("patch")
                            .id(event.seq.to_string())
                            .data(event.payload),
                    );
                }
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => {
                    tracing::warn!(
                        target: "opencode_studio.settings.sse",
                        client_id,
                        downstream_clients = SETTINGS_EVENT_HUB.tx.receiver_count(),
                        "settings SSE client lagged; closing stream"
                    );
                    break;
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => {
                    tracing::debug!(
                        target: "opencode_studio.settings.sse",
                        client_id,
                        last_emitted_seq,
                        disconnect_reason = "closed",
                        "settings SSE client disconnected"
                    );
                    break;
                }
                Err(_) => {
                    yield Ok::<Event, std::convert::Infallible>(Event::default().event("heartbeat").data("{}"));
                }
            }
        }
    };

    axum::response::sse::Sse::new(sse_stream)
        .keep_alive(
            axum::response::sse::KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("heartbeat"),
        )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_hub_should_force_replay_when_cursor_missing_or_evicted() {
        let hub = SettingsEventHub::new();

        // New client should always be forced to take a snapshot.
        assert!(hub.should_force_replay(0, 0));

        // Fill the buffer beyond max events so the front is evicted.
        for seq in 1..=300u64 {
            hub.push_buffered_event(SequencedSettingsEvent {
                seq,
                payload: format!("{{\"type\":\"config.settings.replace\",\"seq\":{}}}", seq),
            });
        }

        let seq_at_subscribe = 300;
        let oldest = hub.oldest_seq().unwrap_or(0);
        assert!(oldest > 1);

        // Cursor far behind the oldest replayable event must force snapshot.
        assert!(hub.should_force_replay(1, seq_at_subscribe));

        // Cursor at/after oldest should not force (replay is possible).
        assert!(!hub.should_force_replay(oldest, seq_at_subscribe));
    }

    #[test]
    fn settings_hub_should_force_replay_when_unbuffered_seq_detected() {
        let hub = SettingsEventHub::new();
        for seq in 1..=10u64 {
            hub.push_buffered_event(SequencedSettingsEvent {
                seq,
                payload: format!("{{\"type\":\"x\",\"seq\":{}}}", seq),
            });
        }
        hub.mark_unbuffered_seq(7);
        assert!(hub.should_force_replay(3, 10));
        assert!(!hub.should_force_replay(8, 10));
    }

    #[test]
    fn settings_hub_replay_since_until_returns_expected_range() {
        let hub = SettingsEventHub::new();
        for seq in 1..=3u64 {
            hub.push_buffered_event(SequencedSettingsEvent {
                seq,
                payload: format!("{{\"seq\":{}}}", seq),
            });
        }
        let replay = hub.replay_since_until(1, 3);
        assert_eq!(replay.len(), 2);
        assert_eq!(replay[0].seq, 2);
        assert_eq!(replay[1].seq, 3);
    }

    #[tokio::test]
    async fn broadcast_receiver_can_lag_and_return_lagged_error() {
        let (tx, mut rx) = broadcast::channel::<u64>(1);
        let _ = tx.send(1);
        let _ = tx.send(2);
        let _ = tx.send(3);

        match rx.recv().await {
            Err(broadcast::error::RecvError::Lagged(_)) => {}
            other => panic!("expected lagged error, got: {:?}", other),
        }
    }
}
